"""Overlay Entity Selector 与 Overlay 过滤流程。"""

from dataclasses import replace
import logging

from python.core.filter.filter import filter_include_tags, filter_overlay_tags
from python.core.filter.filter_rules import FilterRuleContext
from python.utils.internal_models.overpass import OsmElementMap, TagFilterRule, TypedOsmMaps
from python.utils.models import Overpass

warning_logger = logging.getLogger("geomcp.warning")


def _filter_element_map(elements: OsmElementMap, rules: TagFilterRule) -> OsmElementMap:
    """选择命中 Overlay 正向规则的完整 OSM 对象。"""
    selected_elements: OsmElementMap = {}
    for osm_id, element in elements.items():
        tags = element.get("tags")
        if not isinstance(tags, dict) or not tags:
            warning_logger.warning("skip_osm_element_without_tags",extra={"geomcp_extra": {"status": "skipped", "reason": "missing_or_empty_tags", "filter_stage": "overlay", "osm_type": element.get("type"), "osm_id": osm_id}})
            continue
        if filter_include_tags(tags, rules):
            selected_elements[osm_id] = element
    return selected_elements


def filter_overlay(osm_maps: TypedOsmMaps, rule_context: FilterRuleContext) -> TypedOsmMaps:
    """按 Overlay rules 筛选 typed OSM maps，不修改或复制对象内容。"""
    rules = rule_context.overlay_rules
    return TypedOsmMaps.model_construct(
        nodes_by_id=_filter_element_map(osm_maps.nodes_by_id, rules),
        ways_by_id=_filter_element_map(osm_maps.ways_by_id, rules),
        relations_by_id=_filter_element_map(osm_maps.relations_by_id, rules)
    )


def filter_tags_for_overlay(
    identified_features: dict[Overpass.IdentifiedOverlayFeatureType, list[Overpass.IdentifiedOverlayFeature]],
    rule_context: FilterRuleContext
) -> dict[Overpass.IdentifiedOverlayFeatureType, list[Overpass.IdentifiedOverlayFeature]]:
    """对最终 Overlay properties 输出副本执行不含 drop 的 tag 清理。"""
    rules = rule_context.output_remove_tag_rules
    return {
        feature_type: [
            replace(feature, properties=filter_overlay_tags(feature.properties, rules) or {})
            for feature in features
        ]
        for feature_type, features in identified_features.items()
    }
