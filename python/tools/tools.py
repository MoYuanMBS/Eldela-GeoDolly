from __future__ import annotations

from python.utils.models import Tools, JsonDictType, TransferTypes

def _analyze_raw_selection(data: Tools.PyToolReq) -> tuple[tuple[float, float, float, float], JsonDictType | None]:
    '''
    提取 bounding box 和 GeoJSON 数据。
    (south, west, north, east)
    '''
    candidate = data.selected_candidate
    bbox = candidate.boundingbox
    if bbox is None:
        raise TransferTypes.AppError("invalid_selection", "Selected candidate is missing a valid bounding box", {"candidate": candidate.to_dict()})
    returned_bbox = (bbox[0], bbox[2], bbox[1], bbox[3])  # 转换为 (min_lat, min_lon, max_lat, max_lon) 格式

    geojson = candidate.geojson
    return returned_bbox, geojson

def tool_a_handler(data: Tools.PyToolReq) -> JsonDictType:
    bbox, geojson = _analyze_raw_selection(data)
    return {"bbox": bbox, "geojson": geojson}