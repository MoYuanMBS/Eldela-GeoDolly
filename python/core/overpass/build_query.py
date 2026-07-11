"""Overpass Query 构建。"""

from __future__ import annotations

from typing import Sequence

from python.core.overpass.query_utils import build_bbox_filter, format_number, validate_coordinate
from python.utils.config_loader import config
from python.utils.models import Geometry, TransferTypes


def _core_poly_filters(core_geometry: Geometry.AdaptedMultiPolygon) -> list[str]:
    """将 WGS84 core geometry 转换为 Overpass ``poly`` filters。

    ``Geometry.AdaptedMultiPolygon`` 中的坐标使用 ``(lon, lat)``，
    Overpass poly 字符串要求 ``lat lon``，因此序列化时必须交换顺序。
    MultiPolygon 的每个 part 独立生成一个 poly filter，后续由 union
    合并查询结果。当前第一版只读取 exterior，不把 holes 写入查询。

    Args:
        core_geometry: Geometry 模块输出的 WGS84 MultiPolygon adapter。

    Returns:
        每个 Polygon part 对应的 Overpass poly filter 字符串列表。

    Raises:
        TransferTypes.AppError: core 为空、exterior 少于三个坐标、坐标结构
            错误、坐标不是数值，或坐标超出 WGS84 范围。
    """
    if not core_geometry:
        raise TransferTypes.AppError(code="invalid_geometry", message="Overpass core geometry is empty")

    poly_filters: list[str] = []
    for part in core_geometry:
        # 第一版每个 Polygon part 独立生成 poly filter，holes 暂不传给 Overpass。
        exterior = part.get("exterior")
        if not isinstance(exterior, list) or len(exterior) < 3:
            raise TransferTypes.AppError(code="invalid_geometry", message="Overpass core polygon exterior requires at least 3 coordinates")

        poly_coordinates: list[str] = []
        for coordinate in exterior:
            if not isinstance(coordinate, (list, tuple)) or len(coordinate) != 2:
                raise TransferTypes.AppError(code="invalid_geometry", message="Invalid Overpass core polygon coordinate")
            lon, lat = coordinate
            if not isinstance(lon, (int, float)) or isinstance(lon, bool) or not isinstance(lat, (int, float)) or isinstance(lat, bool):
                raise TransferTypes.AppError(code="invalid_geometry", message="Overpass core polygon coordinates must be numbers")
            lon_float, lat_float = float(lon), float(lat)
            validate_coordinate(lon_float, lat_float)
            # Overpass poly 与项目内部坐标顺序相反，要求 `lat lon`。
            poly_coordinates.extend((format_number(lat_float), format_number(lon_float)))

        poly_text = " ".join(poly_coordinates)
        poly_filters.append(f'(poly:"{poly_text}")')
    return poly_filters


def build_initial_query(
    area: Geometry.BBox | Geometry.AdaptedMultiPolygon,
    tag_filters: Sequence[str]
) -> str:
    """构建 bbox/core 通用的一阶段轻量查询。

    bbox 会生成一个空间 filter；core MultiPolygon 会为每个 exterior
    生成一个 poly filter。空间 filters 与 tag filters 做笛卡尔组合，
    每个组合分别生成 node、way、relation statement。第一阶段只让
    node 使用 ``out body`` 获取坐标，way/relation 使用 ``out tags``
    获取筛选所需 tags，不在这里抓 refs、members 或无 tag support 对象。

    Args:
        area: WGS84 bbox，或 Geometry 模块输出的 WGS84 core geometry。
        tag_filters: 由 ``query_utils.py`` 编译好的 Overpass tag filters。

    Returns:
        完整的 Overpass QL 文本，输出格式为 JSON。node 段使用
        ``out body;``，way/relation 段使用 ``out tags;``。

    Raises:
        TransferTypes.AppError: area 无效。
    """
    # BBox 只产生一个空间过滤器；MultiPolygon 的每个 exterior 各产生一个 poly 过滤器。
    spatial_filters = [build_bbox_filter(area)] if isinstance(area, tuple) else _core_poly_filters(area)
    normalized_tag_filters = tuple(tag_filters)
    if not normalized_tag_filters:
        raise TransferTypes.AppError(code="overpass_invalid_query", message="initial Overpass query requires tag filters")
    # 每个 tag filter 都生成独立 statement，再由 union 合并，因此多个 tag filter 是 OR 语义。
    node_statements = [
        f"node{tag_filter}{spatial_filter};"
        for spatial_filter in spatial_filters
        for tag_filter in normalized_tag_filters
    ]
    metadata_statements = [
        f"{element_type}{tag_filter}{spatial_filter};"
        for spatial_filter in spatial_filters
        for tag_filter in normalized_tag_filters
        for element_type in ("way", "rel")
    ]
    return (
        f'[out:json][timeout:{config.overpass.timeout_seconds:g}];\n'
        "(\n  " + "\n  ".join(node_statements) + "\n);\n"
        "out body;\n"
        "(\n  " + "\n  ".join(metadata_statements) + "\n);\n"
        "out tags;"
    )
