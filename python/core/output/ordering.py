"""Overlay Features 的空间排序、canonical ID 与 relation 非空间稳定排序。"""

from __future__ import annotations

from typing import cast

from shapely import to_wkb
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon

import python.utils.internal_models.overpass as overpass
import python.utils.internal_models.static as static_models
from python.utils.config_loader import config
from python.utils.models import TransferTypes


##### Spatial Ordering #####

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


##### Feature ID Encoding #####

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


##### GeoJSON Serialization #####

def _geojson_position(coordinate: tuple[float, ...]) -> overpass.GeoJsonPosition:
    """把 Shapely coordinate 转成 JSON 可序列化的 `[lon, lat]`。"""
    return [float(coordinate[0]), float(coordinate[1])]


def _polygon_coordinates(geometry: Polygon) -> list[list[overpass.GeoJsonPosition]]:
    """保留 Polygon exterior / interiors 的原始 ring 顺序。"""
    return [
        [_geojson_position(coordinate) for coordinate in ring.coords]
        for ring in (geometry.exterior, *geometry.interiors)
    ]


def _to_geojson_geometry(geometry: overpass.OverlayGeometry) -> overpass.OverlayGeoJsonGeometry:
    """在 ID 生成边界把已排序 Shapely geometry 转成最终 GeoJSON。"""
    if isinstance(geometry, Point):
        return {"type": "Point", "coordinates": _geojson_position(geometry.coords[0])}
    if isinstance(geometry, LineString):
        return {"type": "LineString", "coordinates": [_geojson_position(coordinate) for coordinate in geometry.coords]}
    if isinstance(geometry, MultiLineString):
        return {
            "type": "MultiLineString",
            "coordinates": [
                [_geojson_position(coordinate) for coordinate in line.coords]
                for line in geometry.geoms
            ]
        }
    if isinstance(geometry, Polygon):
        return {"type": "Polygon", "coordinates": _polygon_coordinates(geometry)}
    return {
        "type": "MultiPolygon",
        "coordinates": [_polygon_coordinates(polygon) for polygon in geometry.geoms]
    }


##### Shared ID Allocation #####

def _collect_reserved_refs(features: list[overpass.MergedOverlayFeature]) -> set[str]:
    """从聚合 properties 收集非空 ref，避免 canonical ID 与原始标识冲突。"""
    reserved_refs: set[str] = set()
    for feature in features:
        for ref in feature.properties.get("ref", []):
            normalized_ref = ref.strip().upper()
            if normalized_ref:
                reserved_refs.add(normalized_ref)
    return reserved_refs


def _next_available_feature_id(
    candidate_index: int,
    used_ids: set[str],
    scheme: static_models.FeatureIdScheme,
    alphabet_pool: str
) -> tuple[str, int]:
    """跳过同命名空间的保留 ref 和已用 ID，并返回下一个候选序号。"""
    while True:
        feature_id = _feature_id_candidate(candidate_index, scheme, alphabet_pool)
        candidate_index += 1
        if feature_id not in used_ids:
            used_ids.add(feature_id)
            return feature_id, candidate_index


##### Spatial Feature IDs #####

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
        feature_id, candidate_index = _next_available_feature_id(
            candidate_index, used_ids, scheme, alphabet_pool
        )
        identified_features.append(overpass.IdentifiedOverlayFeature(
            feature_id=feature_id,
            osm_id=list(feature.osm_id),
            feature_type=feature.feature_type,
            properties={key: list(values) for key, values in feature.properties.items()},
            geometry=_to_geojson_geometry(feature.geometry)
        ))
    return identified_features


##### Relation Feature IDs #####

def order_relations_by_osm_id(
    relations_by_id: overpass.OsmElementMap
) -> overpass.OsmElementMap:
    """按 OSM ID 升序返回新的 relation mapping，不参与 Ordering in Space。"""
    return {
        osm_id: relations_by_id[osm_id]
        for osm_id in sorted(relations_by_id)
    }


def _generate_relation_feature_ids(
    relations_by_id: overpass.OsmElementMap,
    topology: overpass.OverlayTopology,
    scheme: static_models.FeatureIdScheme,
    alphabet_pool: str
) -> list[overpass.IdentifiedOverlayFeature]:
    """按 OSM ID 排序，为 Overlay relation 生成非空间 canonical ID。"""
    relation_inputs: list[tuple[int, dict[str, list[str]], list[overpass.IdentifiedRelationMember]]] = []
    reserved_refs: set[str] = set()

    # 先收齐整个 relation 命名空间的 ref，再分配任何 ID，避免与较晚 relation 的 ref 冲突。
    for osm_id, element in order_relations_by_osm_id(relations_by_id).items():
        tags = cast(dict[str, str], element["tags"])
        properties = {key: [value] for key, value in tags.items()}
        for ref in properties.get("ref", []):
            normalized_ref = ref.strip().upper()
            if normalized_ref:
                reserved_refs.add(normalized_ref)

        members = topology.relation_members_by_id.get(osm_id)
        if members is None:
            raise TransferTypes.AppError(
                code="overpass_invalid_response",
                message="Overlay relation members are missing",
                details={"osm_type": "relation", "osm_id": osm_id}
            )
        relation_inputs.append((osm_id, properties, [
            {"type": member.type, "ref": member.ref, "role": member.role}
            for member in members
        ]))

    # relation 不参与空间排序；这里严格沿用上一步保存的 osm_id 升序。
    identified_relations: list[overpass.IdentifiedOverlayFeature] = []
    candidate_index = 1
    for osm_id, properties, members in relation_inputs:
        feature_id, candidate_index = _next_available_feature_id(
            candidate_index, reserved_refs, scheme, alphabet_pool
        )
        identified_relations.append(overpass.IdentifiedOverlayFeature(
            feature_id=feature_id,
            osm_id=[osm_id],
            feature_type="relation",
            properties=properties,
            geometry=None,
            members=members
        ))
    return identified_relations


##### Public ID Generation #####

def generate_feature_ids(
    ordered_features: dict[overpass.OverlayFeatureType, list[overpass.MergedOverlayFeature]],
    relations_by_id: overpass.OsmElementMap,
    topology: overpass.OverlayTopology
) -> dict[overpass.IdentifiedOverlayFeatureType, list[overpass.IdentifiedOverlayFeature]]:
    """按四种独立命名空间生成 canonical ID，relation 只按 OSM ID 排序。"""
    return {
        "node": _generate_namespace_feature_ids(
            ordered_features["node"], config.feature_id.id_scheme.node, config.feature_id.alphabet_pool
        ),
        "way": _generate_namespace_feature_ids(
            ordered_features["way"], config.feature_id.id_scheme.way, config.feature_id.alphabet_pool
        ),
        "area": _generate_namespace_feature_ids(
            ordered_features["area"], config.feature_id.id_scheme.area, config.feature_id.alphabet_pool
        ),
        "relation": _generate_relation_feature_ids(
            relations_by_id, topology, config.feature_id.id_scheme.relation, config.feature_id.alphabet_pool
        )
    }
