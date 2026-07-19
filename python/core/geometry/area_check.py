"""Geometry 面积计算与面积上限检查。

当前权威来源: doc/GeoMCP 技术规范文档.md
"""

from __future__ import annotations

from pyproj import Geod

from python.utils.internal_models.geometry import MetricPolygon
from python.utils.models import Geometry

GEOD = Geod(ellps="WGS84")


##### 通用面积判断 #####

def area_check(area_m2: float, max_area_m2: float) -> bool:
    """检查已经计算出的面积是否不超过上限。"""
    return area_m2 <= max_area_m2


##### WGS84 面积计算 #####

def bbox_area_m2(bbox: Geometry.BBox) -> float:
    """计算 WGS84 bbox 的椭球面积，bbox 顺序为 (south, west, north, east)。"""
    south, west, north, east = bbox
    lons = [west, east, east, west, west]
    lats = [south, south, north, north, south]
    area_m2, _ = GEOD.polygon_area_perimeter(lons, lats)
    return abs(float(area_m2))


##### 米制面积计算 #####

def metric_bbox_area_m2(bbox: Geometry.BBox) -> float:
    """计算本地米制 CRS bbox 的平面面积，bbox 顺序为 (south, west, north, east)。"""
    south, west, north, east = bbox
    return abs(float((north - south) * (east - west)))


def metric_geometry_area_m2(geometry: MetricPolygon) -> float:
    """计算本地米制 CRS Polygon / MultiPolygon 的平面面积。"""
    if geometry.is_empty:
        return 0.00
    return float(geometry.area)
