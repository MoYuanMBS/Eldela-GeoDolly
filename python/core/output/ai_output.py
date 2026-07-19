"""AI Output tag 翻译与最终记录组装。"""

from __future__ import annotations

import logging
from typing import Literal, cast

from python.core.filter.filter_rules import FilterRuleContext
import python.utils.internal_models.overpass as overpass

warning_logger = logging.getLogger("geomcp.warning")


##### Tag Translation #####

def _apply_replacement(key: str, value: str, replacement: overpass.TagAnnotationReplacement) -> tuple[str, str]:
    """None 表示保留原 key/value。"""
    target_key, target_value = replacement
    return (
        key if target_key is None else target_key,
        value if target_value is None else target_value
    )


def _translate_tag(key: str, value: str, annotations: overpass.TagAnnotationRules) -> tuple[str, str]:
    """只按原 tag 匹配；简单 wildcard/exact 可组合，其他情况 exact 优先。"""
    wildcard_replacement = annotations.get((key, "*"))
    exact_replacement = annotations.get((key, value))

    if exact_replacement:
        if (
            wildcard_replacement
            and wildcard_replacement[0] is not None
            and wildcard_replacement[1] is None
            and exact_replacement[0] is None
            and exact_replacement[1] is not None
        ):
            return cast(str, wildcard_replacement[0]), cast(str, exact_replacement[1])
        return _apply_replacement(key, value, exact_replacement)
    if wildcard_replacement:
        return _apply_replacement(key, value, wildcard_replacement)
    return key, value


def _translate_tags(
    tags: dict[str, str],
    annotations: overpass.TagAnnotationRules,
    osm_id: int
) -> dict[str, str]:
    """翻译一条记录；目标 key 冲突时 warning 并保留先写入的结果。"""
    translated_tags: dict[str, str] = {}
    for key, value in tags.items():
        target_key, target_value = _translate_tag(key, value, annotations)
        if target_key in translated_tags:
            warning_logger.warning(
                "skip_conflicting_translated_tag",
                extra={"geomcp_extra": {
                    "status": "skipped",
                    "reason": "target_key_conflict",
                    "osm_id": osm_id,
                    "source_key": key,
                    "target_key": target_key
                }}
            )
            continue
        translated_tags[target_key] = target_value
    return translated_tags


##### AI Output Records #####

def _build_records(
    elements: overpass.OsmElementMap,
    annotations: overpass.TagAnnotationRules,
) -> list[overpass.AiOutputRecord]:
    """把一组内部 OSM mapping 释放为最终列表记录。"""
    return [
        overpass.AiOutputRecord(
            osm_id=osm_id,
            tags=_translate_tags(cast(dict[str, str], element["tags"]), annotations, osm_id)
        )
        for osm_id, element in elements.items()
    ]


def build_ai_output_records(output_maps: overpass.TypedOsmMaps, rule_context: FilterRuleContext) -> overpass.AiOutputGroups:
    """翻译 tags，并按 OSM primitive 生成三组最终 AI Output records。"""
    annotations = rule_context.tag_annotations
    return overpass.AiOutputGroups.model_validate({
        "node": _build_records(output_maps.nodes_by_id, annotations),
        "way": _build_records(output_maps.ways_by_id, annotations),
        "relation": _build_records(output_maps.relations_by_id, annotations)
    })
