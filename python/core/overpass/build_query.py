"""Overpass Query 构建。"""

from __future__ import annotations

import math
from typing import Sequence

from python.utils.models import Geometry, TransferTypes

# Overpass query 配置模型接入前暂时使用模块常量，后续统一改从 config loader 获取。
OVERPASS_QUERY_TIMEOUT_SECONDS = 60


def _format_number(value: float) -> str:
    """将浮点数转换为稳定且紧凑的 Overpass QL 数字文本。

    使用 12 位有效数字，避免直接序列化浮点数时产生过长的小数，
    同时为 WGS84 查询坐标保留足够精度。

    Args:
        value: 需要写入 Overpass QL 的浮点数。

    Returns:
        不使用科学计数法约束、最多保留 12 位有效数字的字符串。
    """
    return format(value, ".12g")


def _validate_coordinate(lon: float, lat: float) -> None:
    """校验单个 WGS84 经纬度坐标。

    本函数统一使用项目内部的 ``(lon, lat)`` 顺序。它只检查数值是否
    有限以及是否位于 WGS84 合法范围，不负责判断坐标是否组成有效
    bbox、线或 polygon。

    Args:
        lon: 经度，合法范围为 ``[-180, 180]``。
        lat: 纬度，合法范围为 ``[-90, 90]``。

    Raises:
        TransferTypes.AppError: 坐标包含 NaN/Infinity，或超出 WGS84 范围。
    """
    # 内部坐标保持 `(lon, lat)`，只有序列化 Overpass poly 时才转换成 `lat lon`。
    if not math.isfinite(lon) or not math.isfinite(lat):
        raise TransferTypes.AppError(code="invalid_geometry", message="Overpass coordinates must be finite")
    if not -180.00 <= lon <= 180.00 or not -90.00 <= lat <= 90.00:
        raise TransferTypes.AppError(code="invalid_geometry", message="Overpass coordinates are out of WGS84 range")


def _bbox_filter(bbox: Geometry.BBox) -> str:
    """将已经调好顺序的 Overpass bbox 序列化为 bbox filter。

    调用方传入的 bbox 必须已经是 Overpass 要求的
    ``(south, west, north, east)`` 顺序。这里不能再按 Nominatim raw bbox
    或 Shapely bounds 重新换位，只执行坐标范围、有限值和边界顺序校验。

    Args:
        bbox: Overpass WGS84 bbox，格式固定为 ``(south, west, north, east)``。

    Returns:
        可直接拼接到 Overpass element selector 后的 bbox 文本，例如
        ``(43,-80,44,-79)``。

    Raises:
        TransferTypes.AppError: 坐标非法，或 bbox 不满足
            ``south < north``、``west < east``。
    """
    south, west, north, east = bbox
    _validate_coordinate(west, south)
    _validate_coordinate(east, north)
    if south >= north or west >= east:
        raise TransferTypes.AppError(code="invalid_bbox", message="Overpass bbox must be (south, west, north, east) and satisfy south < north, west < east")
    return f"({_format_number(south)},{_format_number(west)},{_format_number(north)},{_format_number(east)})"


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
            _validate_coordinate(lon_float, lat_float)
            # Overpass poly 与项目内部坐标顺序相反，要求 `lat lon`。
            poly_coordinates.extend((_format_number(lat_float), _format_number(lon_float)))

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
        tag_filters: 由 ``filter_rules.py`` 编译好的 Overpass tag filters。

    Returns:
        完整的 Overpass QL 文本，输出格式为 JSON。node 段使用
        ``out body;``，way/relation 段使用 ``out tags;``。

    Raises:
        TransferTypes.AppError: area 无效。
    """
    # BBox 只产生一个空间过滤器；MultiPolygon 的每个 exterior 各产生一个 poly 过滤器。
    spatial_filters = [_bbox_filter(area)] if isinstance(area, tuple) else _core_poly_filters(area)
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
        f'[out:json][timeout:{OVERPASS_QUERY_TIMEOUT_SECONDS}];\n'
        "(\n  " + "\n  ".join(node_statements) + "\n);\n"
        "out body;\n"
        "(\n  " + "\n  ".join(metadata_statements) + "\n);\n"
        "out tags;"
    )
