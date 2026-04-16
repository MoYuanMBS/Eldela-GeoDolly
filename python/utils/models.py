"""Shared dataclasses for GeoMCP Python-side payloads.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal, Protocol, TypeAlias, TypeGuard, TypedDict, cast

ToolType = Literal["tool_a", "tool_b"]
BasemapType = Literal["osm", "satellite"]
SearchStatus = Literal["needs_confirmation", "no_match"]
JsonValue: TypeAlias = (
    None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]
)
JsonDict: TypeAlias = dict[str, JsonValue]

def is_list_of_str(value: Any) -> TypeGuard[list[str]]:
    return isinstance(value, list) and all(isinstance(x, str) for x in value)

class NominatimData:
    @dataclass(slots=True)
    class LocationQuery:
        """单个地点搜索项。"""

        query: str
        country_codes: list[str] | None = None

        def to_dict(self) -> JsonDict:
            return cast(JsonDict, asdict(self))


    @dataclass(slots=True)
    class SearchRequest:
        """顶层搜索请求。"""

        queries: list[NominatimData.LocationQuery]

        def to_dict(self) -> JsonDict:
            return {"queries": [query.to_dict() for query in self.queries]}


    @dataclass(slots=True)
    class Candidate:
        """搜索阶段产出的标准候选项。"""

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
        geojson: JsonDict | None = None  # Python 内部保留；TS 回给 AI 时要屏蔽

        def to_dict(self) -> JsonDict:
            return cast(JsonDict, asdict(self))


    @dataclass(slots=True)
    class SearchResponse:
        """Python 传给 TypeScript 的搜索响应。"""

        status: SearchStatus
        session_id: str
        query: str
        candidates: list[NominatimData.Candidate]
        instruction: str | None = None
        message: str | None = None

        def to_dict(self) -> JsonDict:
            return cast(JsonDict, asdict(self))


    @dataclass(slots=True)
    class SelectionRequest:
        """AI 确认候选后的工具路由请求。"""

        session_id: str
        selected_indices: list[int]
        tool: ToolType
        ai_attention_token: str | None = None
        basemap: BasemapType | None = None

        def to_dict(self) -> JsonDict:
            return cast(JsonDict, asdict(self))


class TransferTypes:
    """桥接层统一使用的结构化数据类型。"""

    @dataclass(slots=True)
    class AppError(Exception):
        """桥接层统一使用的结构化异常。"""

        code: str
        message: str
        details: JsonValue = None

        def to_dict(self) -> JsonDict:
            return {
                "code": self.code,
                "message": self.message,
                "details": self.details,
            }

    class SupportsToDict(Protocol):
        """带 `to_dict()` 的结果对象协议。"""

        def to_dict(self) -> JsonDict: ...

    Data: TypeAlias = JsonDict | SupportsToDict
    Action: TypeAlias = Literal["search_location", "tool_a", "tool_b",'error']

    class ApiDataResponse(TypedDict):
        """桥接层互传数据结构。"""
        ok: bool
        data: JsonDict | None
        error: JsonDict | None
    
    class ApiRequestData(TypedDict):
        """从 TypeScript 传入 Python 的数据结构。"""
        action: TransferTypes.Action
        data: JsonDict | None
######################################
