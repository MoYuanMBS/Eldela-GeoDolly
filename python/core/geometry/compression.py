"""Geometry node compression。

负责 coverage_simplify、node budget 和 compression metadata。
当前权威来源: doc/GeoMCP 技术规范文档.md
"""

from __future__ import annotations

import logging
from math import exp, floor, log, sqrt

from shapely import coverage_simplify, get_srid, set_srid
from shapely.errors import GEOSException
from shapely.geometry import MultiPolygon, Polygon

from python.utils.config_loader import config
from python.utils.internal_models.geometry import CompressionReason, InternalCompressionStatus

TOLERANCE_AREA_ALPHA = 2.50
TOLERANCE_NODE_ALPHA = 3.50
NODE_BUDGET_BETA = 0.40
NODE_BUDGET_AREA_WEIGHT = 0.30
TOLERANCE_AREA_WEIGHT = 0.75
NODE_SMOOTHING_FACTOR = 2.00
AREA_SMOOTHING_FACTOR = 3.00
RETRY_TOLERANCE_FACTOR = 1.25
BASE_NODE_RATE = 0.50

event_logger = logging.getLogger("geomcp.event")
warning_logger = logging.getLogger("geomcp.warning")


def log_compression_result(
    status: InternalCompressionStatus,
    reason: CompressionReason,
    raw_bbox_area_m2: float,
    tolerance_meter: float | None,
    current_max_node: int | None,
    node_count_before: int,
    node_count_after: int
) -> None:
    """记录 compression 已有结果，不额外计算 audit 数据。"""
    logger = warning_logger.warning if status == "degraded" else event_logger.info
    logger(
        "core area MultiPolygon calculate",
        extra={"geomcp_extra": {
            "status": status,
            "algorithm": "coverage_simplify",
            "raw_bbox_area_m2": round(raw_bbox_area_m2, 2),
            "tolerance_m": tolerance_meter,
            "current_max_node": current_max_node,
            "reason": reason,
            "nodes": {
                "before": node_count_before,
                "after": node_count_after
            }
        }}
    )


def count_exterior_nodes(multipolygon: MultiPolygon) -> int:
    """统计全部 exterior open-ring 节点，不统计 holes 与闭合重复点。"""
    return sum(max(0, len(polygon.exterior.coords) - 1) for polygon in multipolygon.geoms)


def predict_compression_parameters(bbox_area_m2: float, original_node: int) -> tuple[float, int]:
    """根据 Nominatim bbox 面积与原节点数预测 tolerance 和 node budget。"""
    geometry_config = config.geometry
    start_node = geometry_config.max_node * BASE_NODE_RATE
    area_ratio = sqrt(max(0.00, bbox_area_m2)) / geometry_config.max_tolerance_meter
    node_ratio = original_node / start_node

    area_log = max(0.00, log(area_ratio)) if area_ratio > 0.00 else 0.00
    node_log = max(0.00, log(node_ratio)) if node_ratio > 0.00 else 0.00
    area_pressure = 1.00 - exp(-area_log / AREA_SMOOTHING_FACTOR)
    node_pressure = 1.00 - exp(-node_log / NODE_SMOOTHING_FACTOR)

    tolerance_driver = node_pressure ** TOLERANCE_NODE_ALPHA * (
        (1.00 - TOLERANCE_AREA_WEIGHT) + TOLERANCE_AREA_WEIGHT * area_pressure ** TOLERANCE_AREA_ALPHA
    )
    node_driver = node_pressure ** NODE_BUDGET_BETA * (
        (1.00 - NODE_BUDGET_AREA_WEIGHT) + NODE_BUDGET_AREA_WEIGHT * area_pressure
    )

    tolerance = round(
        geometry_config.base_tolerance_meter
        + (geometry_config.max_tolerance_meter - geometry_config.base_tolerance_meter) * tolerance_driver,
        2
    )
    node_budget = floor(start_node + (geometry_config.max_node - start_node) * node_driver)
    return tolerance, node_budget


def normalize_candidate(candidate: Polygon | MultiPolygon, srid: int) -> MultiPolygon | None:
    """将合法 polygonal candidate 标准化为带原 SRID 的 MultiPolygon。"""
    if candidate.is_empty or not candidate.is_valid:
        return None
    if isinstance(candidate, Polygon):
        normalized = MultiPolygon([candidate])
    elif isinstance(candidate, MultiPolygon):
        normalized = candidate
    else:
        return None
    return set_srid(normalized, srid)


def compress_geometry(metric_multipolygon: MultiPolygon, bbox_area_m2: float) -> tuple[MultiPolygon | None, InternalCompressionStatus]:
    """压缩米制 MultiPolygon；失败时返回 None，不执行反投影或序列化。"""
    geometry_config = config.geometry
    original_node = count_exterior_nodes(metric_multipolygon)
    srid = int(get_srid(metric_multipolygon))
    if metric_multipolygon.is_empty or not metric_multipolygon.is_valid:
        log_compression_result("degraded", "calculation_error", bbox_area_m2, None, None, original_node, 0)
        return None, "degraded"
    start_node = geometry_config.max_node * BASE_NODE_RATE

    if original_node <= start_node:
        log_compression_result("not_needed", "not_needed", bbox_area_m2, None, None, original_node, original_node)
        return metric_multipolygon, "not_needed"

    tolerance, node_budget = predict_compression_parameters(bbox_area_m2, original_node)

    def try_candidate(current_tolerance: float, current_node_budget: int) -> tuple[MultiPolygon | None, CompressionReason | None]:
        try:
            simplified_parts = coverage_simplify(list(metric_multipolygon.geoms), current_tolerance)
        except (GEOSException, ValueError):
            return None, "calculation_error"
        simplified_polygons = [part for part in simplified_parts if isinstance(part, Polygon)]
        if len(simplified_polygons) != len(metric_multipolygon.geoms):
            return None, "calculation_error"
        simplified = MultiPolygon(simplified_polygons)
        candidate = normalize_candidate(simplified, srid)
        if candidate is None:
            return None, "calculation_error"
        if count_exterior_nodes(candidate) > current_node_budget:
            return None, "max_node_not_reached"
        return candidate, None

    candidate: MultiPolygon | None = None
    failure_reason: CompressionReason = "max_node_not_reached"
    for attempt in range(geometry_config.max_retry + 1):
        if attempt == geometry_config.max_retry:
            tolerance = geometry_config.max_tolerance_meter
            node_budget = geometry_config.max_node
        elif attempt > 0:
            tolerance = round(min(tolerance * RETRY_TOLERANCE_FACTOR, geometry_config.max_tolerance_meter), 2)
            node_budget = floor(node_budget + (geometry_config.max_node - node_budget) * 0.50)
        candidate, current_failure_reason = try_candidate(tolerance, node_budget)
        if candidate is not None:
            break
        if current_failure_reason is not None:
            failure_reason = current_failure_reason

    if candidate is not None:
        log_compression_result("applied", "passed", bbox_area_m2, tolerance, node_budget, original_node, count_exterior_nodes(candidate))
        return candidate, "applied"

    log_compression_result("degraded", failure_reason, bbox_area_m2, tolerance, node_budget, original_node, 0)
    return None, "degraded"
