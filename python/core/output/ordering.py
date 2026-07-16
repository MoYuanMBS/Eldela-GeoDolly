"""Overlay Features 的空间排序与 relation 非空间稳定排序。"""

from __future__ import annotations

from typing import cast

from shapely import to_wkb
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon

import python.utils.internal_models.overpass as overpass


def _representative_point(feature: overpass.MergedOverlayFeature) -> Point:
    """按派生类型计算最终 geometry 的空间排序代表点。"""
    match feature.feature_type:
        case "node":
            return cast(Point, feature.geometry)
        case "way":
            geometry = cast(LineString | MultiLineString, feature.geometry)
            return geometry.interpolate(0.5, normalized=True)
        case "area":
            geometry = cast(Polygon | MultiPolygon, feature.geometry)
            return geometry.representative_point()


def _geometry_token(geometry: overpass.OverlayGeometry) -> bytes:
    """生成不依赖 OSM ID 的规范完整 geometry 排序 token。"""
    return cast(bytes, to_wkb(geometry.normalize(), byte_order=1))


def _ordering_key(feature: overpass.MergedOverlayFeature) -> tuple[float, float, bytes]:
    """按北到南、西到东与完整 geometry token 生成类型内部排序键。"""
    representative_point = _representative_point(feature)
    return (
        -representative_point.y,
        representative_point.x,
        _geometry_token(feature.geometry)
    )


def order_features_in_space(
    features: list[overpass.MergedOverlayFeature]
) -> dict[overpass.OverlayFeatureType, list[overpass.MergedOverlayFeature]]:
    """分别返回 node / way / area 的空间排序结果，不建立跨类型顺序。"""
    grouped_features: dict[overpass.OverlayFeatureType, list[overpass.MergedOverlayFeature]] = {
        "node": [],
        "way": [],
        "area": []
    }
    for feature in features:
        grouped_features[feature.feature_type].append(feature)

    return {
        feature_type: sorted(group, key=_ordering_key)
        for feature_type, group in grouped_features.items()
    }


def order_relations_by_osm_id(
    relations_by_id: overpass.OsmElementMap
) -> overpass.OsmElementMap:
    """按 OSM ID 升序返回新的 relation mapping，不参与 Ordering in Space。"""
    return {
        osm_id: relations_by_id[osm_id]
        for osm_id in sorted(relations_by_id)
    }
