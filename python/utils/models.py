"""Shared models for GeoMCP Python-side payloads."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Protocol, TypeAlias, TypedDict, cast

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

################### geometry输出格式 ##############################################
class Geometry:
    BBox: TypeAlias = tuple[float, float, float, float]
    Coordinate: TypeAlias = tuple[float, float]
    CompressionStatus: TypeAlias = Literal["applied", "not_needed", "bbox_fallback", "tool_a_fallback"]

    class AdaptedPolygonPart(TypedDict):
        """WGS84 polygon adapter 的单个 part。"""

        exterior: list[Geometry.Coordinate]
        holes: list[list[Geometry.Coordinate]]

    AdaptedMultiPolygon: TypeAlias = list[AdaptedPolygonPart]

    class CompressionResult(StrictModel):
        """Geometry 最终输出。"""

        geometry: Geometry.AdaptedMultiPolygon | Geometry.BBox | None
        status: Geometry.CompressionStatus

################### NominatimData 所有格式 ##############################################
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

################### Overpass 最终输出格式 ##############################################
class Overpass:
    IdentifiedOverlayFeatureType: TypeAlias = Literal["node", "way", "area", "relation"]
    GeoJsonPosition: TypeAlias = list[float]

    class GeoJsonPoint(TypedDict):
        type: Literal["Point"]
        coordinates: Overpass.GeoJsonPosition

    class GeoJsonLineString(TypedDict):
        type: Literal["LineString"]
        coordinates: list[Overpass.GeoJsonPosition]

    class GeoJsonMultiLineString(TypedDict):
        type: Literal["MultiLineString"]
        coordinates: list[list[Overpass.GeoJsonPosition]]

    class GeoJsonPolygon(TypedDict):
        type: Literal["Polygon"]
        coordinates: list[list[Overpass.GeoJsonPosition]]

    class GeoJsonMultiPolygon(TypedDict):
        type: Literal["MultiPolygon"]
        coordinates: list[list[list[Overpass.GeoJsonPosition]]]

    OverlayGeoJsonGeometry: TypeAlias = GeoJsonPoint | GeoJsonLineString | GeoJsonMultiLineString | GeoJsonPolygon | GeoJsonMultiPolygon

    class IdentifiedRelationMember(TypedDict):
        type: Literal["node", "way", "relation"]
        ref: int
        role: str

    @dataclass(frozen=True, slots=True)
    class IdentifiedOverlayFeature:
        """完成 canonical ID 分配、可直接进入最终输出的 Feature。"""

        type: Literal["Feature"] = field(init=False, default="Feature")
        feature_id: str
        osm_id: list[int]
        feature_type: Overpass.IdentifiedOverlayFeatureType
        properties: dict[str, list[str]]
        geometry: Overpass.OverlayGeoJsonGeometry | None
        members: list[Overpass.IdentifiedRelationMember] | None = None

    class AiOutputRecord(StrictModel):
        """Python AI Output 的最终单条记录。"""

        osm_id: int
        tags: dict[str, str]

    class AiOutputGroups(StrictModel):
        """按 OSM primitive 分组的 Python AI Output。"""

        node: list[Overpass.AiOutputRecord] = Field(default_factory=list)
        way: list[Overpass.AiOutputRecord] = Field(default_factory=list)
        relation: list[Overpass.AiOutputRecord] = Field(default_factory=list)

    class FilteredOverpassResult(StrictModel):
        """Overpass / Filter 完整流程的两路最终输出。"""

        ai_output: Overpass.AiOutputGroups
        overlay_output: dict[Overpass.IdentifiedOverlayFeatureType, list[Overpass.IdentifiedOverlayFeature]]

############################### 传输层统一数据类型 ##############################################

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


################################ Tools 输入输出模型 ##############################################
class Tools:
    """ToolA/B输入输出模型。"""

    class PyToolReq(StrictModel):
        """AI 确认候选后的选定地点级信息"""

        session_id: str
        selected_candidate: NominatimData.LocSearchCandidate
        attention_experts: list[str] | None = None

    class PyToolResult(StrictModel):
        """Tool A/B pipeline 交给 TypeScript 的最终结果。"""

        bbox: Geometry.BBox
        output: Overpass.FilteredOverpassResult | None
        recommended_viewport_area_factor: float
        info: str
        effective_query_mode: Literal["tool_a", "tool_b", "basemap_only"]

    class PyToolReply(StrictModel):
        """带 session 标识的 Tool A/B Bridge data。"""

        session_id: str
        result: Tools.PyToolResult

        def to_dict(self) -> JsonDictType:
            return cast(JsonDictType, self.model_dump(mode="json"))
