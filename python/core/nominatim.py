"""Nominatim 搜索辅助函数。"""

from __future__ import annotations

from typing import Any, Literal, cast

import httpx

from python.utils.config_loader import config
from python.utils.models import JsonDictType, NominatimData, TransferTypes
from python.utils.session_id import generate_session_id

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

##### 上游字段规范化 #####

def _to_optional_string(value: Any) -> str | None:
    """把上游值转换为可选的非空字符串。"""
    if value is None:
        return None

    text = str(value).strip()
    return text or None


def _to_optional_float(value: Any) -> float | None:
    """尽量把上游的数字类值转换为浮点数。"""
    if value in (None, ""):
        return None

    try:
        return float(value)
    except (TypeError, ValueError):
        return None

def _normalize_osm_type(raw_type: Any) -> Literal["node", "way", "relation"] | None:
    """把上游 osm_type 转换为严格的枚举值。"""
    if not isinstance(raw_type, str):
        return None

    normalized = raw_type.strip().lower()
    if normalized in ("node", "way", "relation"):
        return normalized  # type: ignore

    return None

def _normalize_address(value: Any) -> dict[str, str] | None:
    """只保留上游 payload 中可转为字符串的地址字段。"""
    if not isinstance(value, dict):
        return None

    normalized_address: dict[str, str] = {}
    for raw_key, raw_value in value.items():
        key = _to_optional_string(raw_key)
        item = _to_optional_string(raw_value)
        if key and item:
            normalized_address[key] = item

    return normalized_address or None


def _normalize_boundingbox(value: Any) -> list[float] | None:
    """把上游 boundingbox 转换为浮点数列表。"""
    if not isinstance(value, list):
        return None

    normalized_coordinates: list[float] = []
    for raw_coordinate in value:
        coordinate = _to_optional_float(raw_coordinate)
        if coordinate is None:
            return None
        normalized_coordinates.append(coordinate)

    return normalized_coordinates or None


##### Candidate 构建 #####

def _build_candidate(raw_result: dict[str, Any], index: int) -> NominatimData.LocSearchCandidate:
    """把单条原始 Nominatim 结果映射为共享的 Candidate 模型。"""
    return NominatimData.LocSearchCandidate(
        index=index,
        osm_type=_normalize_osm_type(raw_result.get("osm_type")),
        name=_to_optional_string(raw_result.get("name")),
        display_name=_to_optional_string(raw_result.get("display_name")),
        lat=_to_optional_float(raw_result.get("lat")),
        lon=_to_optional_float(raw_result.get("lon")),
        category=_to_optional_string(raw_result.get("class")),
        type=_to_optional_string(raw_result.get("type")),
        importance=_to_optional_float(raw_result.get("importance")),
        address=_normalize_address(raw_result.get("address")),
        boundingbox=_normalize_boundingbox(raw_result.get("boundingbox")),
        geojson=cast(JsonDictType, raw_result.get("geojson"))
        if isinstance(raw_result.get("geojson"), dict)
        else None,
    )


##### Nominatim 请求 #####

def search_location(query: str, country_codes: str = "") -> list[dict[str, Any]]:
    """根据单条查询文本拉取原始 Nominatim 搜索结果。"""
    # 从配置中读取 Nominatim 相关参数，构造请求并获取结果
    nom = config.nominatim
    
    params = {
        "q": query,
        "format": "jsonv2",
        "limit": nom.location_limit,
        "addressdetails": 1,
        "polygon_geojson": 1,
    }

    if country_codes:
        params["countrycodes"] = country_codes

    try:
        response = httpx.get(
            NOMINATIM_URL,
            params=params,
            headers={"User-Agent": nom.user_agent},
            timeout=nom.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError as error:
        raise TransferTypes.AppError("HTTP_ERROR","failed to fetch location candidates from Nominatim",str(error))
    if not isinstance(payload, list):
        return []
    return [item for item in payload if isinstance(item, dict)]


##### 搜索请求编排 #####

def query_request(search_request: NominatimData.LocSearchQueryReq) -> NominatimData.LocSearchReply:
    """执行一次搜索请求，并把结果转换为 SearchResponse。"""
    current_query: NominatimData.LocSearchQuery = search_request.queries[0]
    query_text = current_query.query
    country_codes = ",".join(current_query.country_codes) if current_query.country_codes else ""
    raw_results = search_location(query_text, country_codes)

    candidates = [_build_candidate(raw_result, index)for index, raw_result in enumerate(raw_results, start=1)]
    # no-match 与 needs-confirmation 共用同一生成点，避免两个分支的 ID 格式发生漂移。
    session_id = generate_session_id()

    if candidates:
        return NominatimData.LocSearchReply(
            status="needs_confirmation",
            session_id=session_id,
            query=query_text,
            candidates=candidates,
        )

    return NominatimData.LocSearchReply(
        status="no_match",
        session_id=session_id,
        query=query_text,
        candidates=[],
        message="No results found for the given query and country codes.",
    )

if __name__ == "__main__":
    test_query = "square one"
    test_country_code = "CA"
    raw_results = search_location(test_query, test_country_code)
    example_request = NominatimData.LocSearchQueryReq(queries=[NominatimData.LocSearchQuery(query=test_query, country_codes=[test_country_code])])
    search_response = query_request(example_request)

    print(raw_results)
    print("#" * 50)
    print(search_response)
