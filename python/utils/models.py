"""Shared dataclasses for GeoMCP Python-side payloads.

Current authority source: `doc/GeoMCP 技术规范文档.md`.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Literal

ToolType = Literal["tool_a", "tool_b"]
BasemapType = Literal["osm", "satellite"]
SearchStatus = Literal["needs_confirmation", "no_match"]


@dataclass(slots=True)
class LocationQuery:
    """A single location search item from the AI request."""

    query: str
    country_codes: list[str] | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(slots=True)
class SearchRequest:
    """Top-level search request.

    The protocol reserves a list for future expansion, while the current
    implementation only supports one query item.
    """

    queries: list[LocationQuery]

    def to_dict(self) -> dict[str, object]:
        return {"queries": [query.to_dict() for query in self.queries]}


@dataclass(slots=True)
class Candidate:
    """A normalized candidate item returned from the search stage."""

    index: int
    osm_type: str | None = None
    name: str | None = None
    display_name: str | None = None
    lat: float | None = None
    lon: float | None = None
    category: str | None = None
    type: str | None = None
    importance: float | None = None
    address: dict[str, str] | None = None
    boundingbox: list[float] | None = None
    geojson: dict[str, object] | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(slots=True)
class SearchResponse:
    """Search response forwarded to TypeScript for confirmation handling."""

    status: SearchStatus
    session_id: str
    query: str
    candidates: list[Candidate]
    instruction: str | None = None
    message: str | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(slots=True)
class SelectionRequest:
    """AI confirmation payload for tool routing."""

    session_id: str
    selected_indices: list[int]
    tool: ToolType
    ai_attention_token: str | None = None
    basemap: BasemapType | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(slots=True)
class AppError(Exception):
    """Structured application error placeholder for later pipeline reuse."""

    code: str
    message: str
    details: dict[str, object] = field(default_factory=dict)

    def to_dict(self) -> dict[str, object]:
        return {
            "error": True,
            "code": self.code,
            "message": self.message,
            "details": self.details,
        }
