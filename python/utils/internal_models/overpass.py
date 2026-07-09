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


class CompiledTagRuleSet(StrictModel):
    """编译后便于匹配的 tag 规则集合。"""

    wildcard_keys: set[str] = Field(default_factory=set)
    exact_values_by_key: dict[str, set[str]] = Field(default_factory=dict)


class CompiledOverpassFilterRules(StrictModel):
    """Overpass / Filter 编译后的内部规则集合。"""

    deny_object_rules: CompiledTagRuleSet = Field(default_factory=CompiledTagRuleSet)
    remove_tag_rules: CompiledTagRuleSet = Field(default_factory=CompiledTagRuleSet)


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
