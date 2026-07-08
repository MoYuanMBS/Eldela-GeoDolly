"""Overpass 查询构建与请求。"""

from __future__ import annotations

import math
from typing import Any, Sequence, cast

import httpx

from python.utils.models import Geometry, JsonDictType, TransferTypes

# Overpass 配置模型接入前暂时使用模块常量，后续统一改从 config loader 获取。
OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter"
OVERPASS_USER_AGENT = "geomcp/test"
OVERPASS_TIMEOUT_SECONDS = 60.00
OVERPASS_QUERY_TIMEOUT_SECONDS = 60
# 同时匹配任意 tag key 与非空 value，用于 Core 的全部 tagged objects 查询。
ANY_TAG_FILTER = '[~"."~"."]'


def _format_number(value: float) -> str:
    """将浮点数转换为稳定且紧凑的 Overpass QL 数字文本。

    使用 12 位有效数字，避免直接序列化浮点数时产生过长的小数，
    同时为 WGS84 查询坐标保留足够精度。

    Args:
        value: 需要写入 Overpass QL 的浮点数。

    Returns:
        不使用科学计数法约束、最多保留 12 位有效数字的字符串。
    """
    return format(value, ".12g")


def _validate_coordinate(lon: float, lat: float) -> None:
    """校验单个 WGS84 经纬度坐标。

    本函数统一使用项目内部的 ``(lon, lat)`` 顺序。它只检查数值是否
    有限以及是否位于 WGS84 合法范围，不负责判断坐标是否组成有效
    bbox、线或 polygon。

    Args:
        lon: 经度，合法范围为 ``[-180, 180]``。
        lat: 纬度，合法范围为 ``[-90, 90]``。

    Raises:
        TransferTypes.AppError: 坐标包含 NaN/Infinity，或超出 WGS84 范围。
    """
    # 内部坐标保持 `(lon, lat)`，只有序列化 Overpass poly 时才转换成 `lat lon`。
    if not math.isfinite(lon) or not math.isfinite(lat):
        raise TransferTypes.AppError(code="invalid_geometry", message="Overpass coordinates must be finite")
    if not -180.00 <= lon <= 180.00 or not -90.00 <= lat <= 90.00:
        raise TransferTypes.AppError(code="invalid_geometry", message="Overpass coordinates are out of WGS84 range")


def _bbox_filter(bbox: Geometry.BBox) -> str:
    """将已经调好顺序的 Overpass bbox 序列化为 bbox filter。

    调用方传入的 bbox 必须已经是 Overpass 要求的
    ``(south, west, north, east)`` 顺序。这里不能再按 Nominatim raw bbox
    或 Shapely bounds 重新换位，只执行坐标范围、有限值和边界顺序校验。

    Args:
        bbox: Overpass WGS84 bbox，格式固定为 ``(south, west, north, east)``。

    Returns:
        可直接拼接到 Overpass element selector 后的 bbox 文本，例如
        ``(43,-80,44,-79)``。

    Raises:
        TransferTypes.AppError: 坐标非法，或 bbox 不满足
            ``south < north``、``west < east``。
    """
    south, west, north, east = bbox
    _validate_coordinate(west, south)
    _validate_coordinate(east, north)
    if south >= north or west >= east:
        raise TransferTypes.AppError(code="invalid_bbox", message="Overpass bbox must be (south, west, north, east) and satisfy south < north, west < east")
    return f"({_format_number(south)},{_format_number(west)},{_format_number(north)},{_format_number(east)})"


def _core_poly_filters(core_geometry: Geometry.AdaptedMultiPolygon) -> list[str]:
    """将 WGS84 core geometry 转换为 Overpass ``poly`` filters。

    ``Geometry.AdaptedMultiPolygon`` 中的坐标使用 ``(lon, lat)``，
    Overpass poly 字符串要求 ``lat lon``，因此序列化时必须交换顺序。
    MultiPolygon 的每个 part 独立生成一个 poly filter，后续由 union
    合并查询结果。当前第一版只读取 exterior，不把 holes 写入查询。

    Args:
        core_geometry: Geometry 模块输出的 WGS84 MultiPolygon adapter。

    Returns:
        每个 Polygon part 对应的 Overpass poly filter 字符串列表。

    Raises:
        TransferTypes.AppError: core 为空、exterior 少于三个坐标、坐标结构
            错误、坐标不是数值，或坐标超出 WGS84 范围。
    """
    if not core_geometry:
        raise TransferTypes.AppError(code="invalid_geometry", message="Overpass core geometry is empty")

    poly_filters: list[str] = []
    for part in core_geometry:
        # 第一版每个 Polygon part 独立生成 poly filter，holes 暂不传给 Overpass。
        exterior = part.get("exterior")
        if not isinstance(exterior, list) or len(exterior) < 3:
            raise TransferTypes.AppError(code="invalid_geometry", message="Overpass core polygon exterior requires at least 3 coordinates")

        poly_coordinates: list[str] = []
        for coordinate in exterior:
            if not isinstance(coordinate, (list, tuple)) or len(coordinate) != 2:
                raise TransferTypes.AppError(code="invalid_geometry", message="Invalid Overpass core polygon coordinate")
            lon, lat = coordinate
            if not isinstance(lon, (int, float)) or isinstance(lon, bool) or not isinstance(lat, (int, float)) or isinstance(lat, bool):
                raise TransferTypes.AppError(code="invalid_geometry", message="Overpass core polygon coordinates must be numbers")
            lon_float, lat_float = float(lon), float(lat)
            _validate_coordinate(lon_float, lat_float)
            # Overpass poly 与项目内部坐标顺序相反，要求 `lat lon`。
            poly_coordinates.extend((_format_number(lat_float), _format_number(lon_float)))

        poly_text = " ".join(poly_coordinates)
        poly_filters.append(f'(poly:"{poly_text}")')
    return poly_filters


def _normalize_tag_filters(tag_filters: Sequence[str] | None) -> tuple[str, ...]:
    """临时占位：接收由 Filter 模块提供的 Overpass tag filters。

    tag filter 的合并、规范化和合法性校验后续会放到 ``filter.py`` 中
    与 tag 规则编译一起完成；Overpass 查询模块只消费已经编译好的
    ``[...]`` 片段。当前函数只是保留调用位置，避免在这里提前固化
    filter 语义。

    Args:
        tag_filters: 已编译的 tag filter 序列；``None`` 表示使用 Core
            默认的全部 tagged objects 查询。

    Returns:
        不可变 tag filter 元组。除 ``None`` 默认值外，当前不做校验或改写。
    """
    if tag_filters is None:
        return (ANY_TAG_FILTER,)
    return tuple(tag_filters)


def build_out_body_query(
    area: Geometry.BBox | Geometry.AdaptedMultiPolygon,
    tag_filters: Sequence[str] | None = None
) -> str:
    """构建 bbox/core 通用的一阶段 ``out body`` 查询。

    bbox 会生成一个空间 filter；core MultiPolygon 会为每个 exterior
    生成一个 poly filter。空间 filters 与 tag filters 做笛卡尔组合，
    每个组合生成独立的 ``nwr`` statement，最后放入 union。查询只获取
    tagged node、way、relation 的 body，不递归补抓无 tag support 对象。

    Args:
        area: WGS84 bbox，或 Geometry 模块输出的 WGS84 core geometry。
        tag_filters: 已编译的 Overpass tag filters。传入 ``None`` 时匹配
            任意带非空 tag 的 node、way、relation。

    Returns:
        完整的 Overpass QL 文本，输出格式为 JSON，末尾固定使用
        ``out body;``。

    Raises:
        TransferTypes.AppError: area 无效。
    """
    # BBox 只产生一个空间过滤器；MultiPolygon 的每个 exterior 各产生一个 poly 过滤器。
    spatial_filters = [_bbox_filter(area)] if isinstance(area, tuple) else _core_poly_filters(area)
    normalized_tag_filters = _normalize_tag_filters(tag_filters)
    # 每个 tag filter 都生成独立 statement，再由 union 合并，因此多个 tag filter 是 OR 语义。
    statements = [
        f"nwr{tag_filter}{spatial_filter};"
        for spatial_filter in spatial_filters
        for tag_filter in normalized_tag_filters
    ]
    return f'[out:json][timeout:{OVERPASS_QUERY_TIMEOUT_SECONDS}];\n(\n  ' + "\n  ".join(statements) + "\n);\nout body;"


def _status_error(response: httpx.Response) -> TransferTypes.AppError:
    """将非成功 HTTP 响应转换为 GeoMCP Overpass 错误。

    当前阶段不在本函数内执行重试，只根据最终 HTTP status 建立稳定
    错误码。后续加入 retry/backoff 时，仍可复用这里的状态映射。

    Args:
        response: 已完成但 HTTP status 不属于成功范围的响应。

    Returns:
        包含项目错误码、简洁消息、HTTP status 和 endpoint 的 AppError。
        调用方负责 ``raise`` 返回的异常。
    """
    details = {"http_status": response.status_code, "endpoint": str(response.request.url)}
    if response.status_code == 400:
        return TransferTypes.AppError(code=f"overpass_invalid_query_{response.status_code}", message="Overpass rejected the query", details=details)
    if response.status_code == 429:
        return TransferTypes.AppError(code=f"overpass_rate_limited_{response.status_code}", message="Overpass rate limit exceeded", details=details)
    if response.status_code >= 500:
        return TransferTypes.AppError(code=f"overpass_server_error_{response.status_code}", message="Overpass service is unavailable", details=details)
    return TransferTypes.AppError(code=f"overpass_query_failed_{response.status_code}", message="Overpass request failed", details=details)


async def request_overpass(query: str) -> JsonDictType:
    """异步发送 Overpass QL 并校验 JSON 响应外壳。

    请求使用 POST 的 ``data`` 表单字段提交 QL，以支持较长的 poly 查询。
    client 的创建与关闭由本函数内部负责，避免把 Overpass HTTP 细节暴露给
    外部流程。成功响应必须是 JSON object，且包含 ``elements`` list。
    Overpass 即使返回 2xx，也可能通过 ``remark`` 表示运行期错误，
    因此必须单独检查。

    Args:
        query: 完整且非空的 Overpass QL。

    Returns:
        已通过基础结构校验的原始 Overpass JSON 字典。

    Raises:
        TransferTypes.AppError: 查询为空、连接失败、请求超时、HTTP 状态
            错误、响应不是合法 JSON、缺少 ``elements``，或包含运行期
            ``remark``。
    """
    if not query.strip():
        raise TransferTypes.AppError(code="overpass_invalid_query", message="Overpass query is empty")

    # Overpass 请求模块内部管理 client 生命周期，对外只暴露 query -> JSON 的爬取能力。
    request_client = httpx.AsyncClient(
        headers={"User-Agent": OVERPASS_USER_AGENT},
        timeout=OVERPASS_TIMEOUT_SECONDS
    )
    try:
        # 使用 POST 避免较长的 poly / tag 查询受到 URL 长度限制。
        response = await request_client.post(OVERPASS_ENDPOINT, data={"data": query})
    except httpx.TimeoutException as error:
        raise TransferTypes.AppError(code="overpass_timeout", message="Overpass request timed out", details={"endpoint": OVERPASS_ENDPOINT}) from error
    except httpx.TransportError as error:
        raise TransferTypes.AppError(code="overpass_connection_error", message="Failed to connect to Overpass", details={"endpoint": OVERPASS_ENDPOINT}) from error
    finally:
        await request_client.aclose()

    if not response.is_success:
        raise _status_error(response)

    try:
        payload: Any = response.json()
    except ValueError as error:
        raise TransferTypes.AppError(code="overpass_invalid_response", message="Overpass returned invalid JSON") from error
    # Overpass 可能用 2xx + remark 表示运行期失败，必须优先于普通响应结构处理。
    if isinstance(payload, dict) and payload.get("remark"):
        raise TransferTypes.AppError(code="overpass_query_failed", message="Overpass returned a runtime error", details=str(payload["remark"]))
    if not isinstance(payload, dict) or not isinstance(payload.get("elements"), list):
        raise TransferTypes.AppError(code="overpass_invalid_response", message="Overpass response must contain an elements list")
    return cast(JsonDictType, payload)


async def fetch_out_body(
    area: Geometry.BBox | Geometry.AdaptedMultiPolygon,
    tag_filters: Sequence[str] | None = None
) -> JsonDictType:
    """构建并执行 bbox/core 通用的一阶段 ``out body`` 查询。

    这是当前一阶段抓取的便捷入口，只组合
    ``build_out_body_query`` 与 ``request_overpass``。它不负责
    Internal deny 规则编译、typed OSM 映射、Entity Selector、
    relation 递归或二阶段 geometry/support 抓取。

    Args:
        area: WGS84 bbox，或 Geometry 模块输出的 WGS84 core geometry。
        tag_filters: 已编译的 tag filters；``None`` 表示抓取所有 tagged
            node、way、relation。

    Returns:
        包含原始 ``elements`` 的 Overpass JSON 字典。

    Raises:
        TransferTypes.AppError: 查询构建失败，或 Overpass 请求/响应失败。
    """
    return await request_overpass(build_out_body_query(area, tag_filters))
