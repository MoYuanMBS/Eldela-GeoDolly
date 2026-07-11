"""AI Output Entity Selector 与 Tag Accepted-Values Filter。"""

import logging

from python.core.overpass.filter import filter_output_tags
from python.core.overpass.filter_rules import FilterRuleContext
from python.core.overpass.maping import TypedOsmMapStore
from python.utils.internal_models.overpass import OsmElementMap, TypedOsmMaps

warning_logger = logging.getLogger("geomcp.warning")


def _filter_output_element_map(elements: OsmElementMap, rule_context: FilterRuleContext) -> OsmElementMap:
    """清洗同一 OSM 类型的普通 AI Output 对象。"""
    selected_elements: OsmElementMap = {}
    for osm_id, element in elements.items():
        tags = element.get("tags")
        if not isinstance(tags, dict) or not tags:
            warning_logger.warning(
                "skip_osm_element_without_tags",
                extra={"geomcp_extra": {"status": "skipped", "reason": "missing_or_empty_tags", "filter_stage": "output", "osm_type": element.get("type"), "osm_id": osm_id}}
            )
            continue
        filtered_tags = filter_output_tags(tags, rule_context.output_remove_tag_rules)
        if filtered_tags is None:
            continue
        selected_element = element.copy()
        selected_element["tags"] = filtered_tags
        selected_elements[osm_id] = selected_element
    return selected_elements


def filter_output(osm_maps: TypedOsmMaps, rule_context: FilterRuleContext) -> TypedOsmMaps:
    """清洗普通 AI Output 对象并删除无有效信息的对象。"""
    return TypedOsmMaps.model_construct(
        nodes_by_id=_filter_output_element_map(osm_maps.nodes_by_id, rule_context),
        ways_by_id=_filter_output_element_map(osm_maps.ways_by_id, rule_context),
        relations_by_id=_filter_output_element_map(osm_maps.relations_by_id, rule_context)
    )


def merge_parent_relations(output_maps: TypedOsmMaps, parent_maps: TypedOsmMaps) -> TypedOsmMaps:
    """使用 typed mapping 将 Parent relations 合入 AI Output 并去重。"""
    merged_store = TypedOsmMapStore()
    merged_store.maps = TypedOsmMaps.model_construct(
        nodes_by_id=dict(output_maps.nodes_by_id),
        ways_by_id=dict(output_maps.ways_by_id),
        relations_by_id=dict(output_maps.relations_by_id)
    )
    merged_store.merge_stage1(parent_maps)
    return merged_store.maps
