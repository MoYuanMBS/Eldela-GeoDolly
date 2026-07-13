"""Overlay targets 与 topology 到 Shapely geometry 的构建流程。

本模块只生成最终可排序的空间对象：不执行 Ordering in Space、不生成
feature_id，也不序列化 GeoJSON。relation 和 support node/way 不会在这里
自动升级为 Overlay Feature。
"""

from __future__ import annotations

import logging

from shapely import make_valid
from shapely.errors import GEOSException
from shapely.geometry import GeometryCollection, LineString, MultiLineString, MultiPolygon, Point, Polygon, box
from shapely.geometry.base import BaseGeometry

import python.utils.internal_models.overpass as overpass_models
from python.utils.models import Geometry

warning_logger = logging.getLogger("geomcp.warning")


def _warn_geometry_skip(osm_type: str, osm_id: int, reason: str) -> None:
    """统一记录单个 Overlay 对象无法生成 geometry 的 warning。"""
    warning_logger.warning(
        "skip_overlay_geometry",
        extra={"geomcp_extra": {
            "status": "skipped",
            "reason": reason,
            "filter_stage": "overlay_geometry",
            "osm_type": osm_type,
            "osm_id": osm_id
        }}
    )


def has_area_semantics(tags: dict[str, str]) -> bool:
    """判断 tags 是否明确表示面积；`area=no` 优先否定其他面积暗示。"""
    area_value = tags.get("area")
    if area_value == "no":
        return False
    if area_value == "yes":
        return True
    building_value = tags.get("building")
    return building_value is not None and building_value != "no"


def is_closed_way(node_ids: list[int]) -> bool:
    """判断 way refs 是否具有 OSM closed way 的首尾闭合结构。"""
    return len(node_ids) >= 4 and node_ids[0] == node_ids[-1]


def is_area_way(node_ids: list[int], tags: dict[str, str]) -> bool:
    """先判断面积语义，再要求 way 结构闭合，避免只凭闭合状态生成 Polygon。"""
    return has_area_semantics(tags) and is_closed_way(node_ids)


def _coordinate_parts(
    node_ids: list[int],
    coordinates_by_id: dict[int, overpass_models.OverlayCoordinate]
) -> tuple[list[list[overpass_models.OverlayCoordinate]], bool]:
    """按缺失 node 切断 way，禁止跨缺口连接不存在的线段。"""
    coordinate_parts: list[list[overpass_models.OverlayCoordinate]] = []
    current_part: list[overpass_models.OverlayCoordinate] = []
    has_missing_coordinate = False
    for node_id in node_ids:
        coordinate = coordinates_by_id.get(node_id)
        if coordinate is None:
            has_missing_coordinate = True
            if current_part:
                coordinate_parts.append(current_part)
                current_part = []
            continue
        current_part.append(coordinate)
    if current_part:
        coordinate_parts.append(current_part)
    return coordinate_parts, has_missing_coordinate


def _collect_lines(geometry: BaseGeometry) -> list[LineString]:
    """从裁切结果中递归提取有效线段，丢弃仅接触 bbox 产生的点。"""
    if isinstance(geometry, LineString):
        return [geometry] if not geometry.is_empty and geometry.length > 0 else []
    if isinstance(geometry, (MultiLineString, GeometryCollection)):
        return [line for part in geometry.geoms for line in _collect_lines(part)]
    return []


def _collect_polygons(geometry: BaseGeometry) -> list[Polygon]:
    """从 make_valid / bbox intersection 结果中递归提取有效面积部分。"""
    if isinstance(geometry, Polygon):
        return [geometry] if not geometry.is_empty and geometry.area > 0 else []
    if isinstance(geometry, (MultiPolygon, GeometryCollection)):
        return [polygon for part in geometry.geoms for polygon in _collect_polygons(part)]
    return []


def _normalize_clipped_geometry(
    geometry: BaseGeometry,
    bbox_geometry: Polygon,
    geometry_kind: str
) -> overpass_models.OverlayGeometry | None:
    """裁切到 tile bbox，并收敛为允许进入 Ordering 的 geometry 类型。"""
    # 这里由 Shapely 计算真实的 bbox 交点；不能用人工构造的 bbox 点代替原始边界。
    clipped_geometry = geometry.intersection(bbox_geometry)
    if clipped_geometry.is_empty:
        return None
    if geometry_kind == "point":
        return clipped_geometry if isinstance(clipped_geometry, Point) else None
    if geometry_kind == "line":
        lines = _collect_lines(clipped_geometry)
        if len(lines) == 1:
            return lines[0]
        return MultiLineString(lines) if lines else None
    polygons = _collect_polygons(clipped_geometry)
    if len(polygons) == 1:
        return polygons[0]
    return MultiPolygon(polygons) if polygons else None


def _build_node_object(
    osm_id: int,
    tags: dict[str, str],
    topology: overpass_models.OverlayTopology,
    bbox_geometry: Polygon
) -> overpass_models.ResolvedOverlayObject | None:
    """把直接选中的 Overlay node 构建为 bbox 内 Point。"""
    coordinate = topology.node_coordinates_by_id.get(osm_id)
    if coordinate is None:
        _warn_geometry_skip("node", osm_id, "missing_node_coordinate")
        return None
    geometry = _normalize_clipped_geometry(Point(coordinate), bbox_geometry, "point")
    if geometry is None:
        _warn_geometry_skip("node", osm_id, "empty_after_bbox_clip")
        return None
    return overpass_models.ResolvedOverlayObject(osm_type="node", osm_id=osm_id, tags=dict(tags), geometry=geometry)


def _build_way_object(
    osm_id: int,
    tags: dict[str, str],
    topology: overpass_models.OverlayTopology,
    bbox_geometry: Polygon
) -> overpass_models.ResolvedOverlayObject | None:
    """解引用 way node refs，构建并裁切 LineString 或 Polygon。"""
    node_ids = topology.way_node_ids_by_id.get(osm_id)
    if node_ids is None:
        _warn_geometry_skip("way", osm_id, "missing_way_node_refs")
        return None

    area_semantics = has_area_semantics(tags)
    closed_way = is_closed_way(node_ids)
    # 有面积语义却没有闭合 refs 的数据无法构造可靠面，也不能悄悄降级成渲染线。
    if area_semantics and not closed_way:
        _warn_geometry_skip("way", osm_id, "open_area_way")
        return None

    coordinate_parts, has_missing_coordinate = _coordinate_parts(node_ids, topology.node_coordinates_by_id)
    try:
        if area_semantics and closed_way:
            # bbox 外节点应由上游 completion Query 补齐；这里仍缺点时绝不猜测或强行闭合。
            if has_missing_coordinate or len(coordinate_parts) != 1 or len(coordinate_parts[0]) < 4:
                _warn_geometry_skip("way", osm_id, "incomplete_polygon_coordinates")
                return None
            # 先用完整原始边界构造 Polygon，再裁切，Shapely 才能得到正确的 bbox 边界交点。
            polygon = Polygon(coordinate_parts[0])
            geometry = _normalize_clipped_geometry(make_valid(polygon), bbox_geometry, "polygon")
        else:
            # 普通线可以在缺失坐标处分段；跨缺口连接会制造 OSM 中不存在的线段。
            lines = [LineString(part) for part in coordinate_parts if len(part) >= 2]
            lines = [line for line in lines if line.length > 0]
            if not lines:
                _warn_geometry_skip("way", osm_id, "insufficient_line_coordinates")
                return None
            line_geometry: LineString | MultiLineString = lines[0] if len(lines) == 1 else MultiLineString(lines)
            geometry = _normalize_clipped_geometry(line_geometry, bbox_geometry, "line")
    except GEOSException:
        _warn_geometry_skip("way", osm_id, "shapely_geometry_error")
        return None

    if geometry is None:
        _warn_geometry_skip("way", osm_id, "empty_after_bbox_clip")
        return None
    return overpass_models.ResolvedOverlayObject(osm_type="way", osm_id=osm_id, tags=dict(tags), geometry=geometry)


def build_overlay_geometries(
    overlay_maps: overpass_models.TypedOsmMaps,
    topology: overpass_models.OverlayTopology,
    tile_bbox: Geometry.BBox
) -> list[overpass_models.ResolvedOverlayObject]:
    """为直接选中的 Overlay node/way 构建最终 bbox 内 Shapely geometry。"""
    south, west, north, east = tile_bbox
    bbox_geometry = box(west, south, east, north)
    resolved_objects: list[overpass_models.ResolvedOverlayObject] = []

    # relation 不生成 Feature；support 对象也不会因为出现在 topology 中自动升级。
    for osm_id, element in sorted(overlay_maps.nodes_by_id.items()):
        tags = element.get("tags")
        if not isinstance(tags, dict):
            _warn_geometry_skip("node", osm_id, "missing_tags")
            continue
        resolved_object = _build_node_object(osm_id, tags, topology, bbox_geometry)
        if resolved_object is not None:
            resolved_objects.append(resolved_object)

    for osm_id, element in sorted(overlay_maps.ways_by_id.items()):
        tags = element.get("tags")
        if not isinstance(tags, dict):
            _warn_geometry_skip("way", osm_id, "missing_tags")
            continue
        resolved_object = _build_way_object(osm_id, tags, topology, bbox_geometry)
        if resolved_object is not None:
            resolved_objects.append(resolved_object)

    return resolved_objects
