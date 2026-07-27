"""Tool A 道路与交通网络分析 pipeline。"""

from __future__ import annotations

import logging

import python.core.geometry.geometry as geometry
from python.core.filter.filter_rules import FilterRuleContext
from python.core.overpass.filtered_overpass import run_filtered_overpass
from python.tools.tools import build_tool_reply, gis_to_overpass
from python.utils.config_loader import config
from python.utils.models import Tools, TransferTypes

warning_logger = logging.getLogger("geomcp.warning")


async def run_tool_a(data: Tools.PyToolReq) -> Tools.PyToolReply:
    """执行 Tool A bbox 查询；面积超限时降级为纯底图。"""
    boundingbox = data.selected_candidate.boundingbox
    if boundingbox is None:
        raise TransferTypes.AppError(code="invalid_bbox", message="selected candidate bbox is required")

    passed, gis_bbox, bbox_area_m2 = geometry.process_bbox(
        boundingbox,
        config.geometry.tool_a_bbox_expand_meter,
        config.geometry.tool_a_max_area_km2
    )
    if not passed:
        warning_logger.warning("tool_a_basemap_only", extra={"geomcp_extra": {"status": "fallback", "reason": "tool_a_bbox_area_limit_exceeded"}})
        return build_tool_reply(
            data.session_id,
            gis_bbox,
            bbox_area_m2,
            None,
            "The selected area exceeds the Tool A Overpass limit. Only a basemap preview is available; no overlay data was generated.",
            "basemap_only"
        )
    rule_context = FilterRuleContext(experts=sorted(set(data.attention_experts or [])), include_base=True)
    output = await run_filtered_overpass(None, gis_to_overpass(gis_bbox), rule_context)
    return build_tool_reply(data.session_id, gis_bbox, bbox_area_m2, output, "", "tool_a")
