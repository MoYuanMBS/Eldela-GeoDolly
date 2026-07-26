"""Overpass / Filter 子系统内部模型。

当前权威来源: doc/GeoMCP 技术规范文档.md
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Annotated, Any, Literal, TypeAlias

from pydantic import Field
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon

from python.utils.models import StrictModel


##### 基础类型 #####

TagRuleMap: TypeAlias = dict[str, list[str]]
OsmElementMap: TypeAlias = dict[int, dict[str, Any]]
OsmId: TypeAlias = Annotated[int, Field(gt=0)]
Latitude: TypeAlias = Annotated[float, Field(ge=-90, le=90)]
Longitude: TypeAlias = Annotated[float, Field(ge=-180, le=180)]


##### Overpass Query #####

class OsmRelationMember(StrictModel):
    """Overpass relation member，保留原始顺序、类型、引用与 role。"""

    type: Literal["node", "way", "relation"]
    ref: OsmId
    role: str


class OsmElement(StrictModel):
    """Overpass 返回的单个 OSM element 内部校验模型。"""

    type: Literal["node", "way", "relation"]
    id: int
    tags: dict[str, str] | None = None
    lat: float | None = None
    lon: float | None = None
    nodes: list[int] | None = None
    members: list[OsmRelationMember] | None = None


##### Element Mapping / Merge #####

class TypedOsmMaps(StrictModel):
    """按 OSM 原始类型拆分并去重后的 typed OSM 映射。"""

    nodes_by_id: OsmElementMap = Field(default_factory=dict)
    ways_by_id: OsmElementMap = Field(default_factory=dict)
    relations_by_id: OsmElementMap = Field(default_factory=dict)


##### Secondary Overpass #####

OverlayCoordinate: TypeAlias = tuple[float, float]


class OverlayNodeSkeleton(StrictModel):
    """Overlay 二阶段 node `out skel` 原始结构。"""

    type: Literal["node"]
    id: OsmId
    lat: Latitude
    lon: Longitude


class OverlayWaySkeleton(StrictModel):
    """Overlay 二阶段 way `out skel` 原始结构。"""

    type: Literal["way"]
    id: OsmId
    nodes: list[OsmId]


class OverlayRelationSkeleton(StrictModel):
    """Overlay 二阶段 relation `out skel` 原始结构。"""

    type: Literal["relation"]
    id: OsmId
    members: list[OsmRelationMember]


OverlaySkeletonElement: TypeAlias = Annotated[
    OverlayNodeSkeleton | OverlayWaySkeleton | OverlayRelationSkeleton,
    Field(discriminator="type")
]


class OverlayTopology(StrictModel):
    """二阶段 skeleton 规范化后的拓扑索引，不保存或合并 tags。"""

    node_coordinates_by_id: dict[int, OverlayCoordinate] = Field(default_factory=dict)
    way_node_ids_by_id: dict[int, list[int]] = Field(default_factory=dict)
    relation_members_by_id: dict[int, list[OsmRelationMember]] = Field(default_factory=dict)


##### Load Filter #####


class InternalFilterRulesConfig(StrictModel):
    """`internal_rules.json` 的内部负向规则配置。"""

    deny_object_rules: TagRuleMap = Field(default_factory=dict)
    remove_tag_rules: TagRuleMap = Field(default_factory=dict)


##### Filter #####

TagAnnotationReplacement: TypeAlias = tuple[str | None, str | None]
TagAnnotationRules: TypeAlias = dict[tuple[str, str], TagAnnotationReplacement]


class TagFilterRule(StrictModel):
    """Filter 侧使用的轻量 tag 规则集合。"""

    wildcard_keys: set[str] = Field(default_factory=set)
    values_by_key: dict[str, set[str]] = Field(default_factory=dict)
    remove_tag_key_patterns: list[re.Pattern[str]] = Field(default_factory=list)
    drop_if_only_tags: dict[str, set[str]] = Field(default_factory=dict)


class OverpassFilterRule(StrictModel):
    """Overpass selector 使用的平铺 include / deny 规则集合。"""

    include_wildcard_keys: set[str] = Field(default_factory=set)
    include_exact_rules: set[tuple[str, str]] = Field(default_factory=set)
    deny_wildcard_keys: set[str] = Field(default_factory=set)
    deny_exact_rules: set[tuple[str, str]] = Field(default_factory=set)


##### Overlay #####

OverlayGeometry: TypeAlias = Point | LineString | MultiLineString | Polygon | MultiPolygon
OverlayFeatureType: TypeAlias = Literal["node", "way", "area"]


@dataclass(frozen=True, slots=True)
class ResolvedOverlayObject:
    """完成 topology 解引用和 bbox 裁切、尚未排序的 Overlay 空间对象。"""

    feature_type: OverlayFeatureType
    osm_id: int
    tags: dict[str, str]
    geometry: OverlayGeometry


@dataclass(frozen=True, slots=True)
class MergedOverlayFeature:
    """同派生类型、同完整 geometry 合并后的待排序空间 Feature。"""

    feature_type: OverlayFeatureType
    osm_id: list[int]
    properties: dict[str, list[str]]
    geometry: OverlayGeometry
