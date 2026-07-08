"""Overpass 与 Filter 子系统的对外入口和主流程编排。"""

from __future__ import annotations

import asyncio

from python.core.overpass.filter_rules import build_bbox_tag_filters, build_core_tag_filters
from python.core.overpass.overpass import fetch_out_body
from python.utils.models import Geometry, JsonDictType


async def fetch_core_body(core_area: Geometry.BBox | Geometry.AdaptedMultiPolygon) -> JsonDictType:
    """执行 Core 初始 Overpass body 抓取。

    Core 查询由上层决定使用 bbox 还是 core polygon；本函数只负责套用 Core
    专用 tag filters，并调用通用 Overpass `out body` 抓取。
    """
    return await fetch_out_body(core_area, build_core_tag_filters())


async def fetch_bbox_body(
    bbox: Geometry.BBox,
    experts: list[str] | None = None,
    include_base: bool = True
) -> JsonDictType:
    """执行 BBox / context 初始 Overpass body 抓取。

    BBox 查询使用 Base 与当前 experts 的正向 overpass_tags，并叠加
    Internal deny_object_rules。实际 HTTP 请求仍由 `overpass.py` 负责。
    """
    return await fetch_out_body(bbox, build_bbox_tag_filters(experts=experts, include_base=include_base))


async def fetch_initial_bodies(
    core_area: Geometry.BBox | Geometry.AdaptedMultiPolygon | None,
    bbox: Geometry.BBox,
    experts: list[str] | None = None,
    include_base: bool = True
) -> dict[str, JsonDictType | None]:
    """并行执行可用的 Core 与 BBox / context 初始 Overpass body 抓取。"""

    bbox_task = asyncio.create_task(fetch_bbox_body(bbox, experts=experts, include_base=include_base))
    if core_area is None:
        return {"core": None, "bbox": await bbox_task}

    core_body, bbox_body = await asyncio.gather(
        fetch_core_body(core_area),
        bbox_task,
    )
    return {"core": core_body, "bbox": bbox_body}

if __name__ == "__main__":

    from python.core.geometry.geometry import process_geometry, process_bbox
    from python.core.nominatim import query_request
    from python.utils.models import NominatimData
    import python.core.geometry.preprocess as preprocess
    import time

    test_query = "Disneyland Paris"
    test_country_code = "fr"
    example_request = NominatimData.LocSearchQueryReq(queries=[NominatimData.LocSearchQuery(query=test_query, country_codes=[test_country_code])])
    req = query_request(example_request)
    candidate = req.candidates[0]
    gemo = candidate.geojson
    bbox = candidate.boundingbox
    print(f'place_id: {candidate.index}, name: {candidate.name}, address: {candidate.address}')

    from pathlib import Path
    import json
    import os
    import python.core.overpass.overpass as overpass

    file_path = Path(__file__).parent.parent.parent.parent / "test" / "test_output.json"

    if bbox and gemo :
        start_time = time.time()
        geometry_result = process_geometry(gemo, bbox)
        result, final_bbox = process_bbox(bbox, 30.00, 120.00)
        end_time = time.time()
        print(f"Geometry processing time: {end_time - start_time:.2f} seconds")

        print(f"Final bbox: {final_bbox}") 
        print(f"Geometry result: {geometry_result.geometry}") 

        if final_bbox and geometry_result.geometry:

            a = overpass.build_out_body_query(final_bbox,None)
            print(f"Overpass query: {a}")
            b = overpass.build_out_body_query(geometry_result.geometry,None)
            print(f"Overpass query: {b}")
            tokens = b.split()
            print(len(tokens))
            start_time = time.time()
            result = asyncio.run(fetch_initial_bodies(geometry_result.geometry, final_bbox, experts=["example_expert"], include_base=True))
            
            # result =  asyncio.run(fetch_bbox_body(final_bbox, experts=["example_expert"], include_base=True))

            end_time = time.time()
            print(f"Overpass fetch time: {end_time - start_time:.2f} seconds")
            with open(file_path, "w") as f:
                json.dump(result, f, indent=2)
                f.flush()
                size_bytes = os.fstat(f.fileno()).st_size
                size_mb = size_bytes / (1024 * 1024)
                print(f"文件大小: {size_mb:.2f} MB")
            print(f"Result written to {file_path} ({size_mb:.2f} MB)")

            pass