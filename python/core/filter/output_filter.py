"""AI Output Entity Selector 与 Tag Accepted-Values Filter。"""

import logging

from python.core.filter.filter import filter_output_tags
from python.core.filter.filter_rules import FilterRuleContext
from python.core.overpass.maping import TypedOsmMapStore
from python.utils.internal_models.overpass import OsmElementMap, TypedOsmMaps, ResolvedOverlayObject

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


def append_missing_elements(
    output_maps: TypedOsmMaps,
    resolved_objects: list[ResolvedOverlayObject],
    rule_context: FilterRuleContext
) -> TypedOsmMaps:
    """原地补入最终 geometry 来源中 AI Output 缺少且重新通过 Filter 的对象。"""

    def add_filtered_element(elements: OsmElementMap, element_type: str, osm_id: int, tags: dict[str, str]) -> None:
        filtered_tags = filter_output_tags(tags, rule_context.output_remove_tag_rules)
        if filtered_tags is not None:
            elements[osm_id] = {"type": element_type, "id": osm_id, "tags": filtered_tags}

    for resolved_object in resolved_objects:
        match resolved_object.feature_type:
            case "node":
                if resolved_object.osm_id not in output_maps.nodes_by_id:
                    add_filtered_element(output_maps.nodes_by_id, "node", resolved_object.osm_id, resolved_object.tags)
            case "way":
                if resolved_object.osm_id not in output_maps.ways_by_id:
                    add_filtered_element(output_maps.ways_by_id, "way", resolved_object.osm_id, resolved_object.tags)
            case "area":
                if resolved_object.osm_id not in output_maps.ways_by_id:
                    add_filtered_element(output_maps.ways_by_id, "way", resolved_object.osm_id, resolved_object.tags)

    return output_maps
