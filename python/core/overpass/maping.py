"""Overpass raw elements 拆分、typed OSM 映射与一阶段去重。"""

from __future__ import annotations

import logging

from pydantic import ValidationError

from python.utils.internal_models.overpass import OsmElement, TypedOsmMaps
from python.utils.models import JsonDictType

warning_logger = logging.getLogger("geomcp.warning")


class TypedOsmMapStore:
    """一阶段 typed OSM object store。"""

    def __init__(self,palyoad: JsonDictType):
        self.maps = TypedOsmMaps()
        self.add_payload(palyoad)

    def add_payload(self, payload: JsonDictType) -> None:
        """从 Overpass JSON payload 加入 elements。"""
        elements = payload.get("elements")
        if not isinstance(elements, list):
            warning_logger.warning(
                "skip_invalid_overpass_payload",
                extra={"geomcp_extra": {"status": "skipped", "reason": "missing_elements_list"}}
            )
            return

        for element in elements:
            self.add_element(element)

    def add_element(self, element: object) -> None:
        """加入单个 OSM element，遇到重复 `(type, id)` 时保留先到对象。"""
        try:
            osm_element = OsmElement.model_validate(element)
        except ValidationError as error:
            warning_logger.warning(
                "skip_invalid_osm_element",
                extra={"geomcp_extra": {"status": "skipped", "reason": "invalid_osm_element", "details": str(error)}}
            )
            return

        element_dict = osm_element.model_dump(exclude_none=True)
        match osm_element.type:
            case "node":
                target_map = self.maps.nodes_by_id
            case "way":
                target_map = self.maps.ways_by_id
            case "relation":
                target_map = self.maps.relations_by_id

        if osm_element.id not in target_map:
            target_map[osm_element.id] = element_dict

    def merge_stage1(self, incoming_maps: TypedOsmMaps) -> None:
        """把另一份一阶段 typed maps 合入当前 store，重复对象跳过。"""
        for element in incoming_maps.nodes_by_id.values():
            self.add_element(element)
        for element in incoming_maps.ways_by_id.values():
            self.add_element(element)
        for element in incoming_maps.relations_by_id.values():
            self.add_element(element)



