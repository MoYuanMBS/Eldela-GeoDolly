"""Overlay 二阶段 skel Query 构建。"""

from collections.abc import Iterable
from typing import Literal

from python.core.overpass.query_utils import build_bbox_filter
from python.utils.config_loader import config
from python.utils.models import Geometry, TransferTypes


def _normalize_osm_ids(osm_ids: Iterable[int]) -> tuple[int, ...]:
    """去重并稳定排序 OSM IDs。"""
    normalized_ids = tuple(sorted(set(osm_ids)))
    if not normalized_ids:
        raise TransferTypes.AppError(code="overpass_invalid_query", message="Overlay skel query requires at least one OSM ID")
    if any(not isinstance(osm_id, int) or isinstance(osm_id, bool) or osm_id <= 0 for osm_id in normalized_ids):
        raise TransferTypes.AppError(code="overpass_invalid_query", message="Overlay skel query IDs must be positive integers")
    return normalized_ids


def _build_overlay_skel_query(
    element_type: Literal["node", "way", "rel"],
    osm_ids: Iterable[int],
    bbox: Geometry.BBox | None = None
) -> str:
    """构建单一 OSM 类型的二阶段 out skel Query。"""
    normalized_ids = _normalize_osm_ids(osm_ids)
    id_text = ",".join(str(osm_id) for osm_id in normalized_ids)
    bbox_filter = build_bbox_filter(bbox) if bbox is not None else ""
    return (
        f'[out:json][timeout:{config.overpass.timeout_seconds:g}];\n'
        f'{element_type}(id:{id_text}){bbox_filter};\n'
        "out skel;"
    )


def build_overlay_relation_skel_query(relation_ids: Iterable[int]) -> str:
    """构建 Overlay relation members 的 out skel Query。"""
    return _build_overlay_skel_query("rel", relation_ids)


def build_overlay_way_skel_query(way_ids: Iterable[int]) -> str:
    """构建 Overlay way node refs 的 out skel Query。"""
    return _build_overlay_skel_query("way", way_ids)


def build_overlay_node_skel_query(node_ids: Iterable[int], bbox: Geometry.BBox) -> str:
    """构建 tile bbox 内 Overlay node coordinates 的 out skel Query。"""
    return _build_overlay_skel_query("node", node_ids, bbox)
