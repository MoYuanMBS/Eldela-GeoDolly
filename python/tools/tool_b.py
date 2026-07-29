"""Tool B 区域与设施分析 pipeline。"""

from __future__ import annotations

import logging

import python.core.geometry.geometry as geometry
from python.core.filter.filter_rules import FilterRuleContext
from python.core.overpass.filtered_overpass import run_filtered_overpass
from python.tools.tools import build_tool_reply, gis_to_overpass
from python.utils.config_loader import config
from python.utils.models import Tools, TransferTypes

warning_logger = logging.getLogger("geomcp.warning")


async def run_tool_b(data: Tools.PyToolReq) -> Tools.PyToolReply:
    """执行 Tool B core + context 查询，并按面积依次降级。"""
    candidate = data.selected_candidate
    boundingbox = candidate.boundingbox
    if boundingbox is None:
        raise TransferTypes.AppError(code="invalid_bbox", message="selected candidate bbox is required")

    core_result = geometry.process_geometry(candidate.geojson, boundingbox)
    context_area_passed, context_bbox, context_bbox_area_m2 = geometry.process_bbox(
        boundingbox,
        config.geometry.tool_b_bbox_expand_meter,
        config.geometry.tool_b_max_area_km2
    )

    fallback_reasons: list[str] = []
    if core_result.status == "tool_a_fallback":
        fallback_reasons.append("core_area_limit_exceeded")
    if not context_area_passed:
        fallback_reasons.append("tool_b_context_bbox_area_limit_exceeded")

    if fallback_reasons:
        warning_logger.warning("tool_b_query_mode_fallback",extra={"geomcp_extra": {"status": "fallback", "target_mode": "tool_a", "reasons": fallback_reasons}})

        context_area_passed, context_bbox, context_bbox_area_m2 = geometry.process_bbox(
            boundingbox,
            config.geometry.tool_a_bbox_expand_meter,
            config.geometry.tool_a_max_area_km2
        )
        if not context_area_passed:
            warning_logger.warning("tool_b_basemap_only", extra={"geomcp_extra": {"status": "fallback", "reason": "tool_a_context_bbox_area_limit_exceeded"}})
            return build_tool_reply(
                data.session_id,
                context_bbox,
                context_bbox_area_m2,
                None,
                "The selected area exceeds both Tool B and Tool A Overpass limits. Only a basemap preview is available; no overlay data was generated.",
                "basemap_only"
            )

        rule_context = FilterRuleContext(experts=sorted(set(data.attention_experts or [])), include_base=True)
        output = await run_filtered_overpass(None, gis_to_overpass(context_bbox), rule_context)
        return build_tool_reply(
            data.session_id,
            context_bbox,
            context_bbox_area_m2,
            output,
            "Tool B area limits were exceeded. The query was downgraded to Tool A mode without a core geometry.",
            "tool_a"
        )

    core_area = core_result.geometry
    if core_area is None:
        raise TransferTypes.AppError(code="invalid_geometry_result", message="Tool B geometry processing returned an incomplete result")

    rule_context = FilterRuleContext(experts=sorted(set(data.attention_experts or [])), include_base=True)
    output = await run_filtered_overpass(core_area, gis_to_overpass(context_bbox), rule_context)
    return build_tool_reply(data.session_id, context_bbox, context_bbox_area_m2, output, "", "tool_b")

if __name__ == "__main__":
    import asyncio
    from pathlib import Path
    from python.core.nominatim import query_request
    from python.utils.models import NominatimData

    location = "Square One"
    country = "CA"
    filename = "test_python_output.json"
    path =  Path(__file__).parent.parent.parent/"test" / filename
    print(path)

    example_request = NominatimData.LocSearchQueryReq(queries=[NominatimData.LocSearchQuery(query=location, country_codes=[country])])
    search_request = query_request(example_request)
    result = asyncio.run(run_tool_b(Tools.PyToolReq(session_id=search_request.session_id, selected_candidate=search_request.candidates[0], attention_experts=[])))

    with open(path, "w", encoding="utf-8") as f:
        f.write(result.model_dump_json(indent=4))

    print(f"Tool B output written to {path}")
        