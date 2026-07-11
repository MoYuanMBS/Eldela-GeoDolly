"""Overpass / Filter 子系统内部模型。

当前权威来源: doc/GeoMCP 技术规范文档.md
"""

from __future__ import annotations

from typing import Any, Literal, TypeAlias

from pydantic import Field

from python.utils.models import StrictModel


TagRuleMap: TypeAlias = dict[str, list[str]]
OsmElementMap: TypeAlias = dict[int, dict[str, Any]]


class InternalFilterRulesConfig(StrictModel):
    """`internal_rules.json` 的内部负向规则配置。"""

    deny_object_rules: TagRuleMap = Field(default_factory=dict)
    remove_tag_rules: TagRuleMap = Field(default_factory=dict)


class TagFilterRule(StrictModel):
    """Filter 侧使用的轻量 tag 规则集合。"""

    wildcard_keys: set[str] = Field(default_factory=set)
    values_by_key: dict[str, set[str]] = Field(default_factory=dict)
    drop_if_only_tags: dict[str, set[str]] = Field(default_factory=dict)


class OverpassFilterRule(StrictModel):
    """Overpass selector 使用的平铺 include / deny 规则集合。"""

    include_wildcard_keys: set[str] = Field(default_factory=set)
    include_exact_rules: set[tuple[str, str]] = Field(default_factory=set)
    deny_wildcard_keys: set[str] = Field(default_factory=set)
    deny_exact_rules: set[tuple[str, str]] = Field(default_factory=set)


class OsmElement(StrictModel):
    """Overpass 返回的单个 OSM element 内部校验模型。"""

    type: Literal["node", "way", "relation"]
    id: int
    tags: dict[str, str] | None = None
    lat: float | None = None
    lon: float | None = None
    nodes: list[int] | None = None
    members: list[dict[str, Any]] | None = None


class TypedOsmMaps(StrictModel):
    """按 OSM 原始类型拆分并去重后的 typed OSM 映射。"""

    nodes_by_id: OsmElementMap = Field(default_factory=dict)
    ways_by_id: OsmElementMap = Field(default_factory=dict)
    relations_by_id: OsmElementMap = Field(default_factory=dict)


class FilteredOverpassResult(StrictModel):
    """Overpass / Filter 第一阶段可运行流程结果。"""

    combined_maps: TypedOsmMaps
    overlay_maps: TypedOsmMaps
    output_maps: TypedOsmMaps
