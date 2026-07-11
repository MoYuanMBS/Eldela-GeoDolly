"""Overpass 与 Filter 子系统的对外入口和主流程编排。"""

from __future__ import annotations

import asyncio
import logging

from python.core.filter.output_filter import filter_output, merge_parent_relations
from python.core.filter.overlay_filter import filter_overlay
from python.core.overpass.build_query import build_initial_query
from python.core.filter.filter_rules import FilterRuleContext
from python.core.overpass.maping import TypedOsmMapStore
from python.core.overpass.overpass import request_overpass
from python.core.overpass.parent_relation import build_parent_relation_query, filter_parent_relation_result
from python.core.overpass.query_utils import build_overpass_tag_filters
from python.utils.internal_models.overpass import FilteredOverpassResult, TypedOsmMaps
from python.utils.models import Geometry, JsonDictType, TransferTypes

warning_logger = logging.getLogger("geomcp.warning")


async def fetch_initial_body(
    area: Geometry.BBox | Geometry.AdaptedMultiPolygon,
    tag_filters: tuple[str, ...]
) -> JsonDictType:
    """构建并执行初始 Overpass 轻量抓取。"""
    return await request_overpass(build_initial_query(area, tag_filters))


async def fetch_core_body(core_area: Geometry.BBox | Geometry.AdaptedMultiPolygon, rule_context: FilterRuleContext) -> JsonDictType:
    """执行 Core 初始 Overpass body 抓取。

    Core 查询由上层决定使用 bbox 还是 core polygon；本函数只负责套用 Core
    专用 tag filters，并调用初始 Overpass 轻量抓取。
    """
    return await fetch_initial_body(core_area, build_overpass_tag_filters(rule_context, use_any_tag=True))


async def fetch_bbox_body(
    bbox: Geometry.BBox,
    rule_context: FilterRuleContext
) -> JsonDictType:
    """执行 BBox / context 初始 Overpass body 抓取。

    BBox 查询使用 Base 与当前 experts 的正向 overpass_tags，并叠加
    Internal deny_object_rules。实际 HTTP 请求仍由 `overpass.py` 负责。
    """
    return await fetch_initial_body(bbox, build_overpass_tag_filters(rule_context, use_context_rules=True))


async def fetch_initial_bodies(
    core_area: Geometry.BBox | Geometry.AdaptedMultiPolygon | None,
    bbox: Geometry.BBox,
    rule_context: FilterRuleContext
) -> dict[str, JsonDictType | None]:
    """并行抓取 Core 与 BBox；双侧模式允许返回单侧成功结果。"""

    bbox_task = asyncio.create_task(fetch_bbox_body(bbox, rule_context))
    if core_area is None:
        return {"core": None, "bbox": await bbox_task}

    core_result, bbox_result = await asyncio.gather(
        fetch_core_body(core_area, rule_context),
        bbox_task,
        return_exceptions=True
    )

    if isinstance(core_result, asyncio.CancelledError):
        raise core_result
    if isinstance(bbox_result, asyncio.CancelledError):
        raise bbox_result

    if isinstance(core_result, BaseException):
        core_error: BaseException | None = core_result
        core_body: JsonDictType | None = None
    else:
        core_error = None
        core_body = core_result

    if isinstance(bbox_result, BaseException):
        bbox_error: BaseException | None = bbox_result
        bbox_body: JsonDictType | None = None
    else:
        bbox_error = None
        bbox_body = bbox_result
    if core_error is not None and bbox_error is not None:
        if isinstance(bbox_error, TransferTypes.AppError):
            raise bbox_error
        raise TransferTypes.AppError(code="overpass_query_failed", message="Core and BBox Overpass queries failed", details={"core": str(core_error), "bbox": str(bbox_error)}) from bbox_error

    if core_error is not None:
        warning_logger.warning(
            "overpass_partial_success",
            extra={"geomcp_extra": {"status": "partial", "failed_stage": "core", "reason": getattr(core_error, "code", type(core_error).__name__)}}
        )
    if bbox_error is not None:
        warning_logger.warning(
            "overpass_partial_success",
            extra={"geomcp_extra": {"status": "partial", "failed_stage": "bbox", "reason": getattr(bbox_error, "code", type(bbox_error).__name__)}}
        )

    return {"core": core_body, "bbox": bbox_body}


async def run_filtered_overpass(
    core_area: Geometry.BBox | Geometry.AdaptedMultiPolygon | None,
    bbox: Geometry.BBox,
    rule_context: FilterRuleContext
) -> FilteredOverpassResult:
    """执行第一阶段 Overpass、Parent 反查、typed mapping 与双层 Filter。"""
    initial_bodies = await fetch_initial_bodies(core_area, bbox, rule_context)
    core_maps = TypedOsmMapStore(initial_bodies["core"]).maps if initial_bodies["core"] else TypedOsmMaps()
    bbox_maps = TypedOsmMapStore(initial_bodies["bbox"]).maps if initial_bodies["bbox"] else TypedOsmMaps()

    parent_maps = TypedOsmMaps()
    parent_query = build_parent_relation_query(core_maps, rule_context)
    if parent_query:
        try:
            parent_payload = await request_overpass(parent_query)
            parent_maps = filter_parent_relation_result(TypedOsmMapStore(parent_payload).maps, rule_context)
        except TransferTypes.AppError as error:
            warning_logger.warning(
                "skip_parent_relation_query",
                extra={"geomcp_extra": {"status": "partial", "reason": error.code}}
            )

    combined_store = TypedOsmMapStore()
    combined_store.merge_stage1(core_maps)
    combined_store.merge_stage1(bbox_maps)
    combined_maps = combined_store.maps
    overlay_maps = filter_overlay(combined_maps, rule_context)
    output_maps = merge_parent_relations(filter_output(combined_maps, rule_context), parent_maps)

    return FilteredOverpassResult.model_construct(
        combined_maps=combined_maps,
        overlay_maps=overlay_maps,
        output_maps=output_maps
    )






#####################################测试调试用#########################################################
if __name__ == "__main__":

    from python.core.geometry.geometry import process_geometry, process_bbox
    from python.core.nominatim import query_request
    from python.utils.models import NominatimData
    import time

    test_query = "Square one"
    test_country_code = "CA"
    example_request = NominatimData.LocSearchQueryReq(queries=[NominatimData.LocSearchQuery(query=test_query, country_codes=[test_country_code])])
    req = query_request(example_request)
    candidate = req.candidates[0]
    gemo = candidate.geojson
    bbox = candidate.boundingbox
    print(f'place_id: {candidate.index}, name: {candidate.name}, address: {candidate.address}')

    from pathlib import Path
    import json
    import os
    import python.core.overpass.build_query as build_query

    file_path = Path(__file__).parent.parent.parent.parent.parent / "test" / "test_output.json"

    if bbox and gemo :
        start_time = time.time()
        geometry_result = process_geometry(gemo, bbox)
        result, final_bbox = process_bbox(bbox, 30.00, 120.00)
        end_time = time.time()
        print(f"Geometry processing time: {end_time - start_time:.2f} seconds")

        print(f"Final bbox: {final_bbox}") 
        print(f"Geometry result: {geometry_result.geometry}") 

        if final_bbox and geometry_result.geometry:
            rule_context = FilterRuleContext(experts=["example_expert"], include_base=True)

            a = build_query.build_initial_query(final_bbox, build_overpass_tag_filters(rule_context, use_any_tag=True))
            print(f"Overpass query: {a}")
            b = build_query.build_initial_query(geometry_result.geometry, build_overpass_tag_filters(rule_context, use_any_tag=True))
            print(f"Overpass query: {b}")
            tokens = b.split()
            print(len(tokens))
            start_time = time.time()
            result = asyncio.run(run_filtered_overpass(geometry_result.geometry, final_bbox, rule_context))
            

            # result = asyncio.run(fetch_initial_bodies(geometry_result.geometry, final_bbox, rule_context))
            
            # result =  asyncio.run(fetch_bbox_body(final_bbox, rule_context))

            end_time = time.time()
            print(f"Overpass fetch time: {end_time - start_time:.2f} seconds")
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(result.model_dump(mode="json"),f,indent=2,ensure_ascii=False,)
                f.flush()
                size_bytes = os.fstat(f.fileno()).st_size
                size_mb = size_bytes / (1024 * 1024)
                print(f"文件大小: {size_mb:.2f} MB")
            print(f"Result written to {file_path} ({size_mb:.2f} MB)")

            pass
