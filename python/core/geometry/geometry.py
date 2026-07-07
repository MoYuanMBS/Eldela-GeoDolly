"""Geometry core area 流程编排入口。

当前权威来源: doc/GeoMCP 技术规范文档.md
"""

from __future__ import annotations

import logging
from typing import Literal

from shapely import get_srid, union_all
from shapely.errors import GEOSException, GeometryTypeError
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Polygon, shape

import python.core.geometry.area_check as area_check
import python.core.geometry.compression as compression
import python.core.geometry.preprocess as preprocess
from python.utils.config_loader import config
from python.utils.models import Geometry, JsonDictType, TransferTypes

event_logger = logging.getLogger("geomcp.event")
warning_logger = logging.getLogger("geomcp.warning")


def warn_geojson_fallback(geometry_type: object, details: str) -> None:
    """记录 GeoJSON 降级原因，日志走 stderr。"""
    warning_logger.warning(
        "geojson_geometry_fallback",
        extra={"geomcp_extra": {
            "status": "fallback",
            "reason": "invalid_or_unsupported_geojson",
            "geometry_type": geometry_type,
            "details": details
        }}
    )


def combine_metric_parts(parts: list[MultiPolygon]) -> MultiPolygon:
    """将同一米制 CRS 下的 polygon parts 合并并标准化。"""
    if not parts:
        raise ValueError("No polygonal geometry parts")
    srids = {int(get_srid(part)) for part in parts}
    if 0 in srids or len(srids) != 1:
        raise ValueError("Geometry parts must use the same projected CRS")
    srid = srids.pop()
    merged = union_all([polygon for multipolygon in parts for polygon in multipolygon.geoms])
    if not isinstance(merged, (Polygon, MultiPolygon)):
        raise ValueError("Combined geometry is not polygonal")
    normalized = compression.normalize_candidate(merged, srid)
    if normalized is None:
        raise ValueError("Unable to normalize polygonal geometry parts")
    return normalized


def geojson_to_metric_multipolygon(
    geojson: JsonDictType,
    target_epsg: int | None = None
) -> tuple[MultiPolygon | None, bool]:
    """按 GeoJSON type 预处理，并返回是否发生需要 bbox fallback 的错误。"""
    geometry_type = geojson.get("type")
    try:
        source_geometry = shape(geojson)
        if target_epsg is None and not source_geometry.is_empty:
            target_epsg = preprocess.get_local_metric_epsg(source_geometry.bounds)
        match geometry_type:
            case "Point" | "MultiPoint":
                return None, False
            case "LineString":
                linestring = source_geometry
                if not isinstance(linestring, LineString):
                    warn_geojson_fallback(geometry_type, "Invalid LineString GeoJSON")
                    return None, True
                return preprocess.expand_linestring_to_polygon(linestring, config.geometry.line_buffer_meter, target_epsg), False
            case "MultiLineString":
                multilinestring = source_geometry
                if not isinstance(multilinestring, MultiLineString):
                    warn_geojson_fallback(geometry_type, "Invalid MultiLineString GeoJSON")
                    return None, True
                return combine_metric_parts([
                    preprocess.expand_linestring_to_polygon(linestring, config.geometry.line_buffer_meter, target_epsg)
                    for linestring in multilinestring.geoms
                ]), False
            case "Polygon":
                polygon = source_geometry
                if not isinstance(polygon, Polygon):
                    warn_geojson_fallback(geometry_type, "Invalid Polygon GeoJSON")
                    return None, True
                return preprocess.polygon_to_crs(polygon, target_epsg), False
            case "MultiPolygon":
                multipolygon = source_geometry
                if not isinstance(multipolygon, MultiPolygon):
                    warn_geojson_fallback(geometry_type, "Invalid MultiPolygon GeoJSON")
                    return None, True
                return preprocess.polygon_to_crs(multipolygon, target_epsg), False
            case "GeometryCollection":
                geometries = geojson.get("geometries")
                if not isinstance(geometries, list):
                    warn_geojson_fallback(geometry_type, "GeometryCollection.geometries must be a list")
                    return None, True
                parts: list[MultiPolygon] = []
                for member in geometries:
                    if not isinstance(member, dict):
                        warn_geojson_fallback(geometry_type, "GeometryCollection member must be a GeoJSON object")
                        return None, True
                    member_geometry, member_error = geojson_to_metric_multipolygon(member, target_epsg)
                    if member_error:
                        return None, True
                    if member_geometry is not None:
                        parts.append(member_geometry)
                return (combine_metric_parts(parts), False) if parts else (None, False)
            case _:
                warn_geojson_fallback(geometry_type, f"Unsupported GeoJSON geometry type: {geometry_type!r}")
                return None, True
    except (AttributeError, GEOSException, GeometryTypeError, TransferTypes.AppError, TypeError, ValueError) as error:
        warn_geojson_fallback(geometry_type, str(error))
        return None, True


def bbox_core_result(
    bbox: Geometry.BBox,
    bbox_area_m2: float,
    status: Literal["not_needed", "bbox_fallback"]
) -> Geometry.CompressionResult:
    """按 core area 上限检查 bbox；面积超限交给 tools 降级。"""
    max_core_area_m2 = config.geometry.max_core_area_km2 * 1_000_000.00
    if area_check.area_check(bbox_area_m2, max_core_area_m2):
        if status == "bbox_fallback":
            warning_logger.warning(
                "geometry_bbox_fallback",
                extra={"geomcp_extra": {"status": "bbox_fallback"}}
            )
        return Geometry.CompressionResult(geometry=bbox, status=status)
    warning_logger.warning(
        "geometry_tool_a_fallback",
        extra={"geomcp_extra": {"status": "tool_a_fallback", "reason": "area_limit_exceeded"}}
    )
    return Geometry.CompressionResult(geometry=None, status="tool_a_fallback")


def process_geometry(geojson: JsonDictType | None, boundingbox: list[float] | None) -> Geometry.CompressionResult:
    """处理 tools 分发的 GeoJSON 与 Nominatim boundingbox。"""
    if boundingbox is None:
        raise TransferTypes.AppError(code="invalid_bbox", message="bbox is required")
    try:
        if len(boundingbox) != 4:
            raise TransferTypes.AppError(code="invalid_bbox", message="bbox must have 4 coordinates")   
        south, north, west, east = boundingbox
        bbox: Geometry.BBox = (south, west, north, east)
        raw_bbox_area_m2 = area_check.bbox_area_m2(bbox)
    except Exception as error:
        raise TransferTypes.AppError(code="invalid_bbox", message="bbox area calculation failed", details=str(error)) from error

    geometry_type = geojson.get("type") if geojson is not None else None
    metric_multipolygon, geojson_error = geojson_to_metric_multipolygon(geojson) if geojson else (None, False)
    if metric_multipolygon is None:
        bbox_status: Literal["not_needed", "bbox_fallback"] = "bbox_fallback" if geojson_error else "not_needed"
        return bbox_core_result(bbox, raw_bbox_area_m2, bbox_status)

    try:
        compressed_geometry, compression_status = compression.compress_geometry(metric_multipolygon, raw_bbox_area_m2)
    except Exception as error:
        warn_geojson_fallback(geometry_type, f"geometry compression failed: {error}")
        return bbox_core_result(bbox, raw_bbox_area_m2, "bbox_fallback")

    if compression_status == "degraded" or not isinstance(compressed_geometry, MultiPolygon):
        return bbox_core_result(bbox, raw_bbox_area_m2, "bbox_fallback")

    try:
        area_passed, adapted_geometry = preprocess.convert_polygon_to_adupt(compressed_geometry)
    except Exception as error:
        warn_geojson_fallback(geometry_type, f"geometry adapter failed: {error}")
        return bbox_core_result(bbox, raw_bbox_area_m2, "bbox_fallback")

    if not area_passed:
        event_logger.info(
            "core area MultiPolygon calculate",
            extra={"geomcp_extra": {
                "status": "degraded",
                "algorithm": "coverage_simplify",
                "reason": "area_limit_exceeded"
            }}
        )
        return bbox_core_result(bbox, raw_bbox_area_m2, "bbox_fallback")

    return Geometry.CompressionResult(geometry=adapted_geometry, status=compression_status)


if __name__ == "__main__":
    import sys
    from python.main import GeomcpJsonFormatter
    from python.core.nominatim import query_request
    from python.utils.models import NominatimData

    log_handler = logging.StreamHandler(sys.stderr)
    log_handler.setFormatter(GeomcpJsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[log_handler], force=True)

    class CompressionTableHandler(logging.Handler):
        """收集 compression 结构化日志，供调试表格输出。"""

        def __init__(self) -> None:
            super().__init__(logging.INFO)
            self.scene = ""
            self.rows: list[list[str]] = []

        def emit(self, record: logging.LogRecord) -> None:
            detail = getattr(record, "geomcp_extra", None)
            if record.getMessage() != "core area MultiPolygon calculate" or not isinstance(detail, dict):
                return
            if "raw_bbox_area_m2" not in detail or "nodes" not in detail:
                return
            nodes = detail["nodes"]
            if not isinstance(nodes, dict):
                return
            raw_bbox_area = detail["raw_bbox_area_m2"]
            if not isinstance(raw_bbox_area, (int, float)):
                return
            tolerance = detail.get("tolerance_m")
            current_max_node = detail.get("current_max_node")
            self.rows.append([
                self.scene,
                f"{float(raw_bbox_area):.2f}",
                str(nodes.get("before", "-")),
                str(nodes.get("after", "-")),
                f"{float(tolerance):.2f}" if isinstance(tolerance, (int, float)) else "-",
                "-" if current_max_node is None else str(current_max_node)
            ])

    table_handler = CompressionTableHandler()
    logging.getLogger("geomcp.event").addHandler(table_handler)
    logging.getLogger("geomcp.warning").addHandler(table_handler)

    test_query = "Billy Bishop Toronto City Airport"
    test_country_code = "CA"
    querry_list = ["Billy Bishop Toronto City Airport",
                   "Pearson International Airport",
                   "square one",
                   "Disney California Adventure Park",
                   "Disneyland Park",
                   "Disneyland Paris",
                   "Disneyland Resort",
                   "Disneyland Resort Paris",
                   "O'Hare International Airport",
                   "John F. Kennedy International Airport",
                   "Los Angeles International Airport",
                   "Cleveland Works",
                   "Walt Disney World",
                   "Yellowstone National Park",
                   "Hong Kong International Airport",
                   "Heathrow Airport",
                   "Central Park, Manhattan"
                   ]
    coubntry_list = ["CA","CA","CA","US","US","FR","FR","FR","US","US","US","US","US","US","HK","GB","US"]
    for query, country in zip(querry_list, coubntry_list):
        table_handler.scene = query
        example_request = NominatimData.LocSearchQueryReq(queries=[NominatimData.LocSearchQuery(query=query, country_codes=[country])])
        result = query_request(example_request)
        candidate = result.candidates[0] if result.candidates else None
        if candidate:
            output = process_geometry(candidate.geojson, candidate.boundingbox)

    headers = ["scene", "bbox_area", "original_node", "compressed_node", "current_tolerance", "current_max_node"]
    table_rows = [headers, *table_handler.rows]
    column_widths = [max(len(row[index]) for row in table_rows) for index in range(len(headers))]
    print()
    for row_index, row in enumerate(table_rows):
        print("  ".join(value.ljust(column_widths[index]) for index, value in enumerate(row)))
        if row_index == 0:
            print("  ".join("-" * width for width in column_widths))


    example_request = NominatimData.LocSearchQueryReq(queries=[NominatimData.LocSearchQuery(query=test_query, country_codes=[test_country_code])])
    result = query_request(example_request)
    candidate = result.candidates[0] if result.candidates else None
    print(f"{result.session_id}, {result.status}")
    if candidate:

        output = process_geometry(candidate.geojson, candidate.boundingbox)
        print('#' * 40)
        print(output)
