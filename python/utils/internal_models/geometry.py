"""Geometry 内部模型。

当前权威来源: doc/GeoMCP 技术规范文档.md
"""

from __future__ import annotations

from typing import Literal, TypeAlias

from shapely.geometry import MultiPolygon, Polygon

MetricPolygon: TypeAlias = Polygon | MultiPolygon
InternalCompressionStatus: TypeAlias = Literal["applied", "not_needed", "degraded"]
CompressionReason: TypeAlias = Literal["passed", "not_needed", "bbox_fallback", "max_node_not_reached", "area_limit_exceeded", "calculation_error"]
