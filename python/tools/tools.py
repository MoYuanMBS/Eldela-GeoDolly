"""Tool A/B 共用的边界转换与最终结果构建。"""

from __future__ import annotations

from typing import Literal

import python.core.scale_rate as scale_rate
from python.utils.models import Geometry, Overpass, Tools


def gis_to_overpass(gis_bbox: Geometry.BBox) -> Geometry.BBox:
    """将标准 GIS bbox 转换为 Overpass bbox 顺序。"""
    west, south, east, north = gis_bbox
    return (south, west, north, east)


def build_tool_reply(
    session_id: str,
    bbox: Geometry.BBox,
    bbox_area_m2: float,
    output: Overpass.FilteredOverpassResult | None,
    info: str,
    effective_query_mode: Literal["tool_a", "tool_b", "basemap_only"]
) -> Tools.PyToolReply:
    """装配 Tool A/B 最终 Bridge data，并统一计算视口面积倍率。"""
    overlay_output = output.overlay_output if output else None
    return Tools.PyToolReply(
        session_id=session_id,
        result=Tools.PyToolResult(
            bbox=bbox,
            output=output,
            recommended_viewport_area_factor=scale_rate.calculate_recommended_viewport_area_factor(bbox_area_m2, overlay_output),
            info=info,
            effective_query_mode=effective_query_mode
        )
    )
