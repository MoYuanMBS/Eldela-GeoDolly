"""Shared models for GeoMCP Python-side payloads."""

from __future__ import annotations

from typing import Literal, Protocol, TypeAlias, cast

from pydantic import BaseModel, ConfigDict, Field

ToolType = Literal["tool_a", "tool_b"]
BasemapType = Literal["osm", "satellite"]
SearchStatus = Literal["needs_confirmation", "no_match"]
type JsonPrimitive = None | bool | int | float | str
type JsonValue = JsonPrimitive | list[JsonValue] | dict[str, JsonValue]
type JsonDict = dict[str, JsonValue]

class StrictModel(BaseModel):
    """bridge 边界默认使用严格校验。"""

    model_config = ConfigDict(strict=True, extra="forbid")

    def to_dict(self) -> JsonDict:
        return cast(JsonDict, self.model_dump(mode="python"))


class NominatimData:
    class LocationQuery(StrictModel):
        """单个地点搜索项。"""

        query: str
        country_codes: list[str] | None = None

    class SearchRequest(StrictModel):
        """顶层搜索请求。"""

        queries: list[NominatimData.LocationQuery] = Field(min_length=1)

    class Candidate(StrictModel):
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

    class SearchResponse(StrictModel):
        """Python 传给 TypeScript 的搜索响应。"""

        status: SearchStatus
        session_id: str
        query: str
        candidates: list[NominatimData.Candidate]
        instruction: str | None = None
        message: str | None = None

    class SelectionRequest(StrictModel):
        """AI 确认候选后的工具路由请求。"""

        session_id: str
        selected_indices: list[int] = Field(min_length=1)
        tool: ToolType
        ai_attention_token: str | None = None
        basemap: BasemapType | None = None


class TransferTypes:
    """桥接层统一使用的结构化数据类型。"""

    Action: TypeAlias = Literal["search_location", "tool_a", "tool_b", "error"]

    class AppError(Exception):
        """桥接层统一使用的结构化异常。"""

        def __init__(self, code: str, message: str, details: JsonValue = None):
            super().__init__(message)
            self.code = code
            self.message = message
            self.details = details

        def to_dict(self) -> JsonDict:
            return {
                "code": self.code,
                "message": self.message,
                "details": self.details,
            }

    class SupportsToDict(Protocol):
        """带 `to_dict()` 的结果对象协议。"""

        def to_dict(self) -> JsonDict: ...

    class ApiRequestData(StrictModel):
        """从 TypeScript 传入 Python 的请求模型。"""

        action: TransferTypes.Action
        data: JsonDict

    class ApiDataResponse(StrictModel):
        """桥接层标准响应模型。"""

        ok: bool
        data: JsonDict | None
        error: JsonDict | None

    Data: TypeAlias = JsonDict | SupportsToDict
