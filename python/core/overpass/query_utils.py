"""Overpass Query 公共片段、构建bbox filter 和 tag selector 等。"""

from __future__ import annotations

import json
import math
from pathlib import Path
import re
import sys

if __package__ in (None, ""):
    sys.path.append(str(Path(__file__).resolve().parents[3]))

from python.core.filter.filter_rules import FilterRuleContext
from python.utils.internal_models.overpass import OverpassFilterRule
from python.utils.models import Geometry, TransferTypes

ANY_TAG_FILTER = '[~"."~"."]'


def format_number(value: float) -> str:
    """将浮点数转换为稳定且紧凑的 Overpass QL 数字文本。"""
    return format(value, ".12g")


def validate_coordinate(lon: float, lat: float) -> None:
    """校验单个 WGS84 经纬度坐标，内部顺序固定为 `(lon, lat)`。"""
    if not math.isfinite(lon) or not math.isfinite(lat):
        raise TransferTypes.AppError(code="invalid_geometry", message="Overpass coordinates must be finite")
    if not -180.00 <= lon <= 180.00 or not -90.00 <= lat <= 90.00:
        raise TransferTypes.AppError(code="invalid_geometry", message="Overpass coordinates are out of WGS84 range")


def build_bbox_filter(bbox: Geometry.BBox) -> str:
    """校验并序列化 `(south, west, north, east)` Overpass bbox filter。"""
    south, west, north, east = bbox
    validate_coordinate(west, south)
    validate_coordinate(east, north)
    if south >= north or west >= east:
        raise TransferTypes.AppError(code="invalid_bbox", message="Overpass bbox must be (south, west, north, east) and satisfy south < north, west < east")
    return f"({format_number(south)},{format_number(west)},{format_number(north)},{format_number(east)})"


def _quote_ql_string(value: str) -> str:
    """把 tag key/value 安全写成 Overpass QL 双引号字符串。"""
    return json.dumps(value, ensure_ascii=False)


def _group_exact_rules(exact_rules: set[tuple[str, str]]) -> dict[str, set[str]]:
    """按 key 聚合 exact rules，便于生成 Overpass regex selector。"""
    grouped_rules: dict[str, set[str]] = {}
    for key, value in exact_rules:
        grouped_rules.setdefault(key, set()).add(value)
    return grouped_rules


def _build_exact_value_regex(values: set[str]) -> str:
    """把同 key 的多个 value 压缩成 Overpass regex。"""
    escaped_values = [re.escape(value) for value in sorted(values)]
    return f"^({'|'.join(escaped_values)})$"


def _build_deny_filter_fragment(overpass_rules: OverpassFilterRule) -> str:
    """把 deny_object_rules 编译成可追加到 selector 的负向 filters。"""
    filters: list[str] = []
    for key in sorted(overpass_rules.deny_wildcard_keys):
        filters.append(f'[!{_quote_ql_string(key)}]')
    for key, values in sorted(_group_exact_rules(overpass_rules.deny_exact_rules).items()):
        if len(values) == 1:
            value = next(iter(values))
            filters.append(f'[{_quote_ql_string(key)}!={_quote_ql_string(value)}]')
        else:
            filters.append(f'[{_quote_ql_string(key)}!~{_quote_ql_string(_build_exact_value_regex(values))}]')
    return "".join(filters)


def _build_positive_filter_fragments(overpass_rules: OverpassFilterRule) -> tuple[str, ...]:
    """把正向 rules 编译成 selector filter 片段。"""
    filters: list[str] = []
    for key in sorted(overpass_rules.include_wildcard_keys):
        filters.append(f'[{_quote_ql_string(key)}]')
    for key, values in sorted(_group_exact_rules(overpass_rules.include_exact_rules).items()):
        if len(values) == 1:
            value = next(iter(values))
            filters.append(f'[{_quote_ql_string(key)}={_quote_ql_string(value)}]')
        else:
            filters.append(f'[{_quote_ql_string(key)}~{_quote_ql_string(_build_exact_value_regex(values))}]')
    return tuple(filters)


def build_overpass_tag_filters(rule_context: FilterRuleContext, use_any_tag: bool = False, use_context_rules: bool = False) -> tuple[str, ...]:
    """构建 Overpass selector tag filters；deny_object_rules 强制追加。"""
    overpass_rules = rule_context.context_overpass_rules if use_context_rules else rule_context.deny_object_rules
    deny_filter = _build_deny_filter_fragment(overpass_rules)

    if use_any_tag:
        return (ANY_TAG_FILTER + deny_filter,)
    if not use_context_rules:
        return (deny_filter,)

    positive_filters = _build_positive_filter_fragments(overpass_rules)
    if not positive_filters:
        raise TransferTypes.AppError(code="overpass_invalid_query", message="context Overpass query requires at least one positive tag filter")
    return tuple(f"{positive_filter}{deny_filter}" for positive_filter in positive_filters)


if __name__ == "__main__":
    base_context = FilterRuleContext()
    expert_context = FilterRuleContext(experts=["example_expert"])

    print("Core tag filters:")
    print(build_overpass_tag_filters(base_context, use_any_tag=True))

    print("\nBBox tag filters with base only:")
    print(build_overpass_tag_filters(base_context, use_context_rules=True))

    print("\nBBox tag filters with base + example_expert:")
    print(build_overpass_tag_filters(expert_context, use_context_rules=True))

    print("\nParent relation tag filters:")
    print(build_overpass_tag_filters(expert_context))
