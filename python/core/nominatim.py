"""Nominatim search helpers.
"""

from __future__ import annotations

import sys
import uuid
from pathlib import Path
from typing import Any, cast

import httpx

if __package__ in (None, ""):
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from python.utils.models import Candidate, JsonDict, LocationQuery, SearchRequest, SearchResponse

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
LOCATION_LIMIT = 30
USER_AGENT = "geomcp/test"
CONFIRMATION_INSTRUCTION = ("Reply with JSON containing session_id, selected_indices, tool, and optional ai_attention_token and basemap.")


def _to_optional_string(value: Any) -> str | None:
    """Convert upstream values into optional non-empty strings."""
    if value is None:
        return None

    text = str(value).strip()
    return text or None


def _to_optional_float(value: Any) -> float | None:
    """Convert upstream numeric-like values into floats when possible."""
    if value in (None, ""):
        return None

    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_address(value: Any) -> dict[str, str] | None:
    """Keep only string-like address fields from the upstream payload."""
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
    """Convert the upstream boundingbox into a list of floats."""
    if not isinstance(value, list):
        return None

    normalized_coordinates: list[float] = []
    for raw_coordinate in value:
        coordinate = _to_optional_float(raw_coordinate)
        if coordinate is None:
            return None
        normalized_coordinates.append(coordinate)

    return normalized_coordinates or None


def _build_candidate(raw_result: dict[str, Any], index: int) -> Candidate:
    """Map one raw Nominatim result into the shared Candidate model."""
    return Candidate(
        index=index,
        osm_type=_to_optional_string(raw_result.get("osm_type")),
        name=_to_optional_string(raw_result.get("name")),
        display_name=_to_optional_string(raw_result.get("display_name")),
        lat=_to_optional_float(raw_result.get("lat")),
        lon=_to_optional_float(raw_result.get("lon")),
        category=_to_optional_string(raw_result.get("class")),
        type=_to_optional_string(raw_result.get("type")),
        importance=_to_optional_float(raw_result.get("importance")),
        address=_normalize_address(raw_result.get("address")),
        boundingbox=_normalize_boundingbox(raw_result.get("boundingbox")),
        geojson=cast(JsonDict, raw_result.get("geojson"))
        if isinstance(raw_result.get("geojson"), dict)
        else None,
    )


def search_location(query: str, country_codes: str = "") -> list[dict[str, Any]]:
    """Fetch raw Nominatim search results for one query string."""
    params = {
        "q": query,
        "format": "jsonv2",
        "limit": LOCATION_LIMIT,
        "addressdetails": 1,
        "polygon_geojson": 1,
    }

    if country_codes:
        params["countrycodes"] = country_codes

    try:
        response = httpx.get(
            NOMINATIM_URL,
            params=params,
            headers={"User-Agent": USER_AGENT},
            timeout=30.0,
        )
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError as error:
        print(f"HTTP error occurred: {error}")
        return []

    if not isinstance(payload, list):
        return []

    return [item for item in payload if isinstance(item, dict)]


def build_search_response(search_request: SearchRequest) -> SearchResponse:
    """Execute one search request and convert the results into SearchResponse."""
    current_query: LocationQuery = search_request.queries[0]
    query_text = current_query.query
    country_codes = ",".join(current_query.country_codes) if current_query.country_codes else ""
    raw_results = search_location(query_text, country_codes)

    candidates = [
        _build_candidate(raw_result, index)
        for index, raw_result in enumerate(raw_results, start=1)
    ]

    if candidates:
        return SearchResponse(
            status="needs_confirmation",
            session_id=uuid.uuid4().hex[:8],
            query=query_text,
            candidates=candidates,
            instruction=CONFIRMATION_INSTRUCTION,
        )

    return SearchResponse(
        status="no_match",
        session_id=uuid.uuid4().hex[:8],
        query=query_text,
        candidates=[],
        message="No results found for the given query and country codes.",
    )


def query_requset(search_request: SearchRequest) -> SearchResponse:
    """Backward-compatible wrapper for the previous misspelled function name."""
    return build_search_response(search_request)


if __name__ == "__main__":
    test_query = "square one"
    test_country_code = "ca"
    raw_results = search_location(test_query, test_country_code)
    example_request = SearchRequest(
        queries=[LocationQuery(query=test_query, country_codes=[test_country_code])]
    )
    search_response = build_search_response(example_request)

    print(raw_results)
    print("#" * 50)
    print(search_response)
