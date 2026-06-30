"""Shared models for GeoMCP Python-side payloads."""

from __future__ import annotations

from typing import Literal, Protocol, TypeAlias, cast

from pydantic import BaseModel, ConfigDict, Field

ToolType = Literal["tool_a", "tool_b"]
BasemapType = Literal["osm", "satellite"]
LocSearchStatusType = Literal["needs_confirmation", "no_match"]
type JsonPrimitiveType = None | bool | int | float | str
type JsonValueType = JsonPrimitiveType | list[JsonValueType] | dict[str, JsonValueType]
type JsonDictType = dict[str, JsonValueType]

class StrictModel(BaseModel):
    """bridge 边界默认使用严格校验。"""

    model_config = ConfigDict(strict=True, extra="forbid")

    def to_dict(self) -> JsonDictType:
        return cast(JsonDictType, self.model_dump(mode="python"))


class NominatimData:
    class LocSearchQuery(StrictModel):
        """单个地点搜索项。"""

        query: str
        country_codes: list[str] | None = None

    class LocSearchQueryReq(StrictModel):
        """顶层搜索请求。"""

        queries: list[NominatimData.LocSearchQuery] = Field(min_length=1)

    class LocSearchCandidate(StrictModel):
        """搜索阶段产出的标准候选项。"""

        index: int
        osm_type: Literal["node", "way", "relation"] | None = None
        name: str | None = None
        display_name: str | None = None
        lat: float | None = None
        lon: float | None = None
        category: str | None = None
        type: str | None = None
        importance: float | None = None
        address: dict[str, str] | None = None
        boundingbox: list[float] | None = None
        geojson: JsonDictType | None = None  # Python 内部保留；TS 回给 AI 时要屏蔽

    class LocSearchReply(StrictModel):
        """Python 传给 TypeScript 的搜索响应。"""

        status: LocSearchStatusType
        session_id: str
        query: str
        candidates: list[NominatimData.LocSearchCandidate]
        message: str | None = None

class TransferTypes:
    """桥接层统一使用的结构化数据类型。"""

    Action: TypeAlias = Literal["search_location", "tool_a", "tool_b", "error"]

    class AppError(Exception):
        """桥接层统一使用的结构化异常。"""

        def __init__(self, code: str, message: str, details: JsonValueType = None):
            super().__init__(message)
            self.code = code
            self.message = message
            self.details = details

        def to_dict(self) -> JsonDictType:
            return {
                "code": self.code,
                "message": self.message,
                "details": self.details,
            }

    class SupportsToDict(Protocol):
        """带 `to_dict()` 的结果对象协议。"""

        def to_dict(self) -> JsonDictType: ...

    class BridgeRequest(StrictModel):
        """从 TypeScript 传入 Python 的请求模型。"""

        action: TransferTypes.Action
        data: JsonDictType

    class BridgeResponse(StrictModel):
        """桥接层标准响应模型。"""

        ok: bool
        data: JsonDictType | None
        error: JsonDictType | None

    BridgeData: TypeAlias = JsonDictType | SupportsToDict

class Tools:
    """ToolA/B输入输出模型。"""
    class PyToolReq(StrictModel):
        """AI 确认候选后的选定地点级信息"""
        session_id: str
        selected_candidate: NominatimData.LocSearchCandidate
        attention_experts: list[str] | None = None
        basemap: BasemapType | None = None
