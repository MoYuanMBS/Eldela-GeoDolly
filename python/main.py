"""GeoMCP Python CLI entrypoint."""

from __future__ import annotations

import json
import sys
from typing import Any

import httpx

from core.nominatim import search_location


def make_error(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "ok": False,
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
        },
    }


def handle_search_location(payload: dict[str, Any]) -> dict[str, Any]:
    query = str(payload.get("query", "")).strip()
    country_codes = str(payload.get("country_codes", "")).strip()

    if not query:
        return make_error("INVALID_INPUT", "query is required")

    try:
        results = search_location(query, country_codes)
    except httpx.HTTPError as exc:
        return make_error(
            "UPSTREAM_HTTP_ERROR",
            "failed to fetch location candidates from Nominatim",
            {"reason": str(exc)},
        )
    except Exception as exc:  # pragma: no cover - scaffold safety net
        return make_error(
            "INTERNAL_ERROR",
            "unexpected python processing error",
            {"reason": str(exc)},
        )

    return {
        "ok": True,
        "data": {
            "query": query,
            "country_codes": country_codes or None,
            "count": len(results),
            "results": results,
        },
    }


def dispatch(payload: dict[str, Any]) -> dict[str, Any]:
    action = payload.get("action")

    if action == "search_location":
        return handle_search_location(payload)

    return make_error("UNKNOWN_ACTION", f"unsupported action: {action}")


def main() -> int:
    raw = sys.stdin.read().strip()

    if not raw:
        sys.stdout.write(json.dumps(make_error("INVALID_INPUT", "stdin payload is required")))
        return 1

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        sys.stdout.write(
            json.dumps(
                make_error(
                    "INVALID_JSON",
                    "stdin payload must be valid json",
                    {"reason": str(exc)},
                )
            )
        )
        return 1

    response = dispatch(payload)
    sys.stdout.write(json.dumps(response, ensure_ascii=False))
    return 0 if response.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
