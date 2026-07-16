"""Overlay Features 的空间排序、canonical ID 与 relation 非空间稳定排序。"""

from __future__ import annotations

from typing import cast

from shapely import to_wkb
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon

import python.utils.internal_models.overpass as overpass
import python.utils.internal_models.static as static_models
from python.utils.config_loader import config


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


def _bijective_alpha(index: int, alphabet_pool: str) -> str:
    """把从 1 开始的序号编码为按配置字母池递增的双射字符串。"""
    base = len(alphabet_pool)
    characters: list[str] = []
    while index > 0:
        index, remainder = divmod(index - 1, base)
        characters.append(alphabet_pool[remainder])
    return "".join(reversed(characters))


def _feature_id_candidate(
    index: int,
    scheme: static_models.FeatureIdScheme,
    alphabet_pool: str
) -> str:
    """按命名空间候选序号生成尚未检查保留 ref 的 canonical ID。"""
    if scheme.mode == "global":
        alpha = alphabet_pool[0]
        num = index
    elif scheme.mode == "grouped":
        group_size = cast(int, scheme.group)
        alpha_index, num_index = divmod(index - 1, group_size)
        alpha = _bijective_alpha(alpha_index + 1, alphabet_pool)
        num = num_index + 1
    else:
        alpha_index, num_index = divmod(index - 1, len(alphabet_pool))
        alpha = alphabet_pool[num_index]
        num = alpha_index + 1
    return scheme.template.replace("{alpha}", alpha).replace("{num}", str(num))


def _collect_reserved_refs(features: list[overpass.MergedOverlayFeature]) -> set[str]:
    """收集同类型全部来源的非空 ref，避免 canonical ID 与原始标识冲突。"""
    reserved_refs: set[str] = set()
    for feature in features:
        for source in feature.sources:
            ref = source.tags.get("ref")
            if ref is None:
                continue
            normalized_ref = ref.strip().upper()
            if normalized_ref:
                reserved_refs.add(normalized_ref)
    return reserved_refs


def _generate_namespace_feature_ids(
    features: list[overpass.MergedOverlayFeature],
    scheme: static_models.FeatureIdScheme,
    alphabet_pool: str
) -> list[overpass.IdentifiedOverlayFeature]:
    """为一个已排序类型命名空间依次分配唯一且不占用 ref 的 ID。"""
    used_ids = _collect_reserved_refs(features)
    identified_features: list[overpass.IdentifiedOverlayFeature] = []
    candidate_index = 1

    for feature in features:
        while True:
            feature_id = _feature_id_candidate(candidate_index, scheme, alphabet_pool)
            candidate_index += 1
            if feature_id not in used_ids:
                used_ids.add(feature_id)
                break
        identified_features.append(overpass.IdentifiedOverlayFeature(
            feature_id=feature_id,
            feature_type=feature.feature_type,
            sources=feature.sources,
            geometry=feature.geometry
        ))
    return identified_features


def generate_feature_ids(
    ordered_features: dict[overpass.OverlayFeatureType, list[overpass.MergedOverlayFeature]]
) -> dict[overpass.OverlayFeatureType, list[overpass.IdentifiedOverlayFeature]]:
    """按 node / way / area 独立命名空间为已排序 Features 生成 canonical ID。"""
    return {
        "node": _generate_namespace_feature_ids(
            ordered_features["node"], config.feature_id.id_scheme.node, config.feature_id.alphabet_pool
        ),
        "way": _generate_namespace_feature_ids(
            ordered_features["way"], config.feature_id.id_scheme.way, config.feature_id.alphabet_pool
        ),
        "area": _generate_namespace_feature_ids(
            ordered_features["area"], config.feature_id.id_scheme.area, config.feature_id.alphabet_pool
        )
    }


def order_relations_by_osm_id(
    relations_by_id: overpass.OsmElementMap
) -> overpass.OsmElementMap:
    """按 OSM ID 升序返回新的 relation mapping，不参与 Ordering in Space。"""
    return {
        osm_id: relations_by_id[osm_id]
        for osm_id in sorted(relations_by_id)
    }
