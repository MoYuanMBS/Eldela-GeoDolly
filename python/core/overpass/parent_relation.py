"""Parent relation 反查流程。"""

import logging

from python.core.filter.filter import filter_include_tags, filter_output_tags
from python.core.filter.filter_rules import FilterRuleContext, build_overpass_tag_filters
from python.utils.config_loader import config
from python.utils.internal_models.overpass import TypedOsmMaps
from python.utils.models import TransferTypes

warning_logger = logging.getLogger("geomcp.warning")


def filter_parent_relation(osm_maps: TypedOsmMaps, rule_context: FilterRuleContext) -> TypedOsmMaps:
    """从 Core typed maps 中筛选需要反查 parent relation 的 seeds。"""
    seed_rules = rule_context.parent_relation_rules
    selected_maps = TypedOsmMaps()
    typed_maps = (
        (osm_maps.nodes_by_id, selected_maps.nodes_by_id),
        (osm_maps.ways_by_id, selected_maps.ways_by_id),
        (osm_maps.relations_by_id, selected_maps.relations_by_id)
    )
    for elements, selected_elements in typed_maps:
        for osm_id, element in elements.items():
            tags = element.get("tags")
            if not isinstance(tags, dict) or not tags:
                warning_logger.warning(
                    "skip_osm_element_without_tags",
                    extra={"geomcp_extra": {"status": "skipped", "reason": "missing_or_empty_tags", "filter_stage": "parent_relation", "osm_type": element.get("type"), "osm_id": osm_id}}
                )
                continue
            if filter_include_tags(tags, seed_rules) is not None:
                selected_elements[osm_id] = element
    return selected_maps


def filter_parent_relation_result(parent_maps: TypedOsmMaps, rule_context: FilterRuleContext) -> TypedOsmMaps:
    """验证并清洗反查返回的 parent relation tags。"""
    seed_rules = rule_context.output_remove_tag_rules
    selected_relations = {}
    for osm_id, element in parent_maps.relations_by_id.items():
        tags = element.get("tags")
        if not isinstance(tags, dict) or not tags:
            warning_logger.warning(
                "skip_osm_element_without_tags",
                extra={"geomcp_extra": {"status": "skipped", "reason": "missing_or_empty_tags", "filter_stage": "parent_relation_result", "osm_type": element.get("type"), "osm_id": osm_id}}
            )
            continue
        if filter_include_tags(tags, seed_rules) is None:
            continue
        filtered_tags = filter_output_tags(tags, rule_context.output_remove_tag_rules)
        if filtered_tags is None:
            continue
        selected_element = element.copy()
        selected_element["tags"] = filtered_tags
        selected_relations[osm_id] = selected_element
    return TypedOsmMaps.model_construct(nodes_by_id={}, ways_by_id={}, relations_by_id=selected_relations)


def build_parent_relation_query(osm_maps: TypedOsmMaps, rule_context: FilterRuleContext) -> str | None:
    """构建单次、固定向上递归深度的 parent relation tags 查询。"""
    if config.overpass.relation_parent_depth == 0:
        return None
    seed_maps = filter_parent_relation(osm_maps, rule_context)
    seed_groups = (
        ("node", "parent_nodes", "bn", seed_maps.nodes_by_id),
        ("way", "parent_ways", "bw", seed_maps.ways_by_id),
        ("rel", "parent_relations", "br", seed_maps.relations_by_id)
    )
    seed_statements: list[str] = []
    first_level_statements: list[str] = []
    deny_filter = build_overpass_tag_filters(rule_context)[0]

    for element_type, set_name, recurse_type, elements in seed_groups:
        if not elements:
            continue
        osm_ids = sorted(elements)
        if any(not isinstance(osm_id, int) or isinstance(osm_id, bool) or osm_id <= 0 for osm_id in osm_ids):
            raise TransferTypes.AppError(code="overpass_invalid_query", message="parent relation seed IDs must be positive integers")
        seed_statements.append(f'{element_type}(id:{",".join(str(osm_id) for osm_id in osm_ids)})->.{set_name};')
        first_level_statements.append(f"rel({recurse_type}.{set_name}){deny_filter};")

    if not seed_statements:
        return None

    parent_level_statements = ["(\n  " + "\n  ".join(first_level_statements) + "\n)->.parent_level_1;"]
    for level in range(2, config.overpass.relation_parent_depth + 1):
        parent_level_statements.append(f"rel(br.parent_level_{level - 1}){deny_filter}->.parent_level_{level};")
    output_sets = "\n  ".join(f".parent_level_{level};" for level in range(1, config.overpass.relation_parent_depth + 1))

    return (
        f'[out:json][timeout:{config.overpass.timeout_seconds}];\n'
        + "\n".join(seed_statements)
        + "\n"
        + "\n".join(parent_level_statements)
        + "\n(\n  "
        + output_sets
        + "\n);\nout tags;"
    )
