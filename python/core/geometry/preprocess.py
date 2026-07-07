"""Geometry 预处理。

负责 GeoJSON 转 Shapely、CRS 正反投影、line buffer 和 MultiPolygon 标准化。
当前权威来源: doc/GeoMCP 技术规范文档.md
"""

from __future__ import annotations

import logging

from shapely import get_srid, set_srid
from pyproj import CRS, Transformer
from shapely.geometry import LineString, MultiPolygon, Polygon, box
from shapely.ops import transform

from python.utils.models import Geometry, TransferTypes
from python.utils.config_loader import config
import python.core.geometry.area_check as areaChecker

warning_logger = logging.getLogger("geomcp.warning")


def get_local_metric_epsg(bounds: tuple[float, float, float, float]) -> int:
    """根据 WGS84 geometry bounds 的中心点选择本地 UTM EPSG。"""
    min_lon, min_lat, max_lon, max_lat = bounds
    center_lat = (min_lat + max_lat) / 2
    center_lon = (min_lon + max_lon) / 2
    utm_zone = min(60, max(1, int((center_lon + 180) // 6) + 1))
    return 32600 + utm_zone if center_lat >= 0 else 32700 + utm_zone


def bbox_to_crs(bbox: Geometry.BBox) -> Polygon:
    """将 WGS84 bbox 投影为带本地 UTM SRID 的 Shapely Polygon。"""
    south, west, north, east = bbox
    epsg = get_local_metric_epsg((west, south, east, north))
    to_metric = Transformer.from_crs(4326, epsg, always_xy=True)
    return set_srid(transform(to_metric.transform, box(west, south, east, north)), epsg)

def crs_to_overpass_bbox(crs_bbox: Polygon) -> Geometry.BBox:
    """将带 SRID 的米制 CRS Polygon 反投影为 Overpass WGS84 bbox。"""
    epsg = get_srid(crs_bbox)
    if epsg == 0:
        raise TransferTypes.AppError(code="invalid_geometry", message="crs_bbox must have a valid SRID")
    to_wgs84 = Transformer.from_crs(epsg, 4326, always_xy=True)
    min_lon, min_lat, max_lon, max_lat = transform(to_wgs84.transform, crs_bbox).bounds
    return (min_lat, min_lon, max_lat, max_lon)

def project_and_expand_bbox(crs_bbox: Polygon, expand_meter: float, max_area: float) -> tuple[bool, Geometry.BBox|None]:
    """扩展crs bbox 并投影为 Overpass WGS84 bbox, 并检测面积"""
    epsg = int(get_srid(crs_bbox))
    if epsg == 0:
        raise TransferTypes.AppError(code="invalid_geometry", message="crs_bbox must have a valid SRID")
    min_x, min_y, max_x, max_y = crs_bbox.bounds
    metric_bbox = set_srid(box(min_x, min_y, max_x, max_y), epsg)
    expanded_metric_bbox = metric_bbox if expand_meter <= 0 else set_srid(
        box(min_x - expand_meter, min_y - expand_meter, max_x + expand_meter, max_y + expand_meter),
        epsg
    )
    if areaChecker.area_check(areaChecker.metric_geometry_area_m2(expanded_metric_bbox), max_area):
        return (True, crs_to_overpass_bbox(expanded_metric_bbox))
    if areaChecker.area_check(areaChecker.metric_geometry_area_m2(metric_bbox), max_area):
        warning_logger.warning(
            "bbox_expand_fallback",
            extra={"geomcp_extra": {"status": "fallback", "reason": "expanded_bbox_area_limit_exceeded"}}
        )
        return (True, crs_to_overpass_bbox(metric_bbox))
    return (False, None)

def expand_linestring_to_polygon(linestring: LineString, expand_meter: float, target_epsg: int | None = None) -> MultiPolygon:
    """将 WGS84 LineString 投影并按米扩展为本地 CRS MultiPolygon。"""
    epsg = target_epsg if target_epsg is not None else get_local_metric_epsg(linestring.bounds)
    to_metric = Transformer.from_crs(4326, epsg, always_xy=True)
    metric_linestring = set_srid(transform(to_metric.transform, linestring), epsg)
    buffered_polygon = metric_linestring.buffer(expand_meter, cap_style="square", join_style="mitre")
    return set_srid(MultiPolygon([buffered_polygon]), epsg)

def polygon_to_crs(polygon: Polygon | MultiPolygon, target_epsg: int | None = None) -> MultiPolygon:
    """将 WGS84 Polygon / MultiPolygon 标准化为本地米制 CRS MultiPolygon。"""
    if polygon.is_empty or not polygon.is_valid:
        raise TransferTypes.AppError(code="invalid_geometry", message="polygon is empty or invalid")

    multipolygon = MultiPolygon([polygon]) if isinstance(polygon, Polygon) else polygon
    epsg = target_epsg if target_epsg is not None else get_local_metric_epsg(multipolygon.bounds)
    to_metric = Transformer.from_crs(4326, epsg, always_xy=True)
    metric_multipolygon = set_srid(transform(to_metric.transform, multipolygon), epsg)
    if not metric_multipolygon.is_valid:
        raise TransferTypes.AppError(code="invalid_geometry", message="projected polygon is invalid")
    return metric_multipolygon

def convert_polygon_to_adupt(polygon: MultiPolygon) -> tuple[bool, Geometry.AdaptedMultiPolygon | None]:
    """检查米制面积，通过后反投影并转换为 WGS84 adapter polygon parts。"""
    max_area_m2 = config.geometry.max_core_area_km2 * 1_000_000.00
    if not areaChecker.area_check(areaChecker.metric_geometry_area_m2(polygon), max_area_m2):
        return False, None

    epsg = int(get_srid(polygon))
    if epsg == 0:
        raise TransferTypes.AppError(code="invalid_geometry", message="polygon must have a valid SRID")
    source_crs = CRS.from_epsg(epsg)
    if not source_crs.is_projected:
        raise TransferTypes.AppError(code="invalid_geometry", message="polygon must use a projected metric CRS")

    to_wgs84 = Transformer.from_crs(source_crs, 4326, always_xy=True)
    wgs84_polygon = transform(to_wgs84.transform, polygon)
    adapted_parts: Geometry.AdaptedMultiPolygon = []
    for polygon_part in wgs84_polygon.geoms:
        exterior = [(float(lon), float(lat)) for lon, lat in list(polygon_part.exterior.coords)[:-1]]
        holes = [
            [(float(lon), float(lat)) for lon, lat in list(interior.coords)[:-1]]
            for interior in polygon_part.interiors
        ]
        adapted_part: Geometry.AdaptedPolygonPart = {"exterior": exterior, "holes": holes}
        adapted_parts.append(adapted_part)
    return True, adapted_parts
