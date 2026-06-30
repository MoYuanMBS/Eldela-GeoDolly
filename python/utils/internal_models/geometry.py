"""Geometry 内部模型。

当前权威来源: doc/GeoMCP 技术规范文档.md
"""

from __future__ import annotations

from typing import Literal, TypeAlias, TypedDict

from shapely.geometry import MultiPolygon, Polygon

from python.utils.models import StrictModel

BBox: TypeAlias = tuple[float, float, float, float]
MetricPolygon: TypeAlias = Polygon | MultiPolygon
CompressionStatus: TypeAlias = Literal["applied", "not_needed", "bbox_fallback", "tool_a_fallback"]
InternalCompressionStatus: TypeAlias = Literal["applied", "not_needed", "degraded"]
CompressionReason: TypeAlias = Literal["passed", "not_needed", "bbox_fallback", "max_node_not_reached", "area_limit_exceeded", "calculation_error"]
Coordinate: TypeAlias = tuple[float, float]


class AdaptedPolygonPart(TypedDict):
    """WGS84 polygon adapter 的单个 part。"""

    exterior: list[Coordinate]
    holes: list[list[Coordinate]]


AdaptedMultiPolygon: TypeAlias = list[AdaptedPolygonPart]


class CompressionResult(StrictModel):
    """Geometry 最终输出。"""

    geometry: AdaptedMultiPolygon | BBox | None
    status: CompressionStatus
