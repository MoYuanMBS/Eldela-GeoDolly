"""Overpass raw elements 拆分、一阶段 typed 映射与二阶段 topology 合并。"""

from __future__ import annotations

from pydantic import TypeAdapter, ValidationError

from python.utils.internal_models.overpass import (
    OsmElement,
    OverlayNodeSkeleton,
    OverlayRelationSkeleton,
    OverlaySkeletonElement,
    OverlayTopology,
    OverlayWaySkeleton,
    TypedOsmMaps
)
from python.utils.models import JsonDictType, TransferTypes

_overlay_skeleton_adapter = TypeAdapter(OverlaySkeletonElement)


##### Stage 1 Element Mapping #####

class TypedOsmMapStore:
    """一阶段 typed OSM object store。"""

    def __init__(self, payload: JsonDictType | None = None):
        self.maps = TypedOsmMaps()
        if payload is not None:
            self.add_payload(payload)

    def add_payload(self, payload: JsonDictType) -> None:
        """从 Overpass JSON payload 加入 elements。"""
        elements = payload.get("elements")
        if not isinstance(elements, list):
            raise TransferTypes.AppError(
                code="overpass_invalid_response",
                message="Overpass response must contain an elements list"
            )

        for element in elements:
            self.add_element(element)

    def add_element(self, element: object) -> None:
        """加入单个 OSM element，遇到重复 `(type, id)` 时保留先到对象。"""
        try:
            osm_element = OsmElement.model_validate(element)
        except ValidationError as error:
            raise TransferTypes.AppError(
                code="overpass_invalid_response",
                message="Overpass returned an invalid OSM element",
                details=str(error)
            ) from error

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


##### Stage 2 Topology Mapping #####

class OverlayTopologyStore:
    """二阶段 skeleton 校验、坐标规范化与多批 topology 去重合并。"""

    def __init__(self, payload: JsonDictType | None = None):
        self.to_pology = OverlayTopology()
        if payload is not None:
            self.add_payload(payload)

    def add_payload(self, payload: JsonDictType) -> None:
        """处理单批 Overlay `out skel` 响应。"""
        elements = payload.get("elements")
        if not isinstance(elements, list):
            raise TransferTypes.AppError(
                code="overpass_invalid_response",
                message="Overpass response must contain an elements list"
            )

        for element in elements:
            self.add_element(element)

    def add_element(self, element: object) -> None:
        """使用 Pydantic 校验单个 skeleton，再交给 topology 映射。"""
        try:
            skeleton = _overlay_skeleton_adapter.validate_python(element)
        except ValidationError as error:
            raise TransferTypes.AppError(
                code="overpass_invalid_response",
                message="Overpass returned an invalid Overlay skeleton",
                details=str(error)
            ) from error

        self._add_validated_skeleton(skeleton)

    def _add_validated_skeleton(self, skeleton: OverlaySkeletonElement) -> None:
        """把已验证模型分流到 topology；这里只做坐标转换与 first-wins 去重。"""
        match skeleton:
            case OverlayNodeSkeleton(id=osm_id, lon=lon, lat=lat):
                self.to_pology.node_coordinates_by_id.setdefault(osm_id, (lon, lat))
            case OverlayWaySkeleton(id=osm_id, nodes=node_ids):
                if osm_id not in self.to_pology.way_node_ids_by_id:
                    self.to_pology.way_node_ids_by_id[osm_id] = list(node_ids)
            case OverlayRelationSkeleton(id=osm_id, members=members):
                if osm_id not in self.to_pology.relation_members_by_id:
                    self.to_pology.relation_members_by_id[osm_id] = list(members)

    def merge_stage2(self, incoming_topology: OverlayTopology) -> None:
        """合并另一批 topology；重复 typed identity 保留先到结构。"""
        for osm_id, coordinate in incoming_topology.node_coordinates_by_id.items():
            self.to_pology.node_coordinates_by_id.setdefault(osm_id, coordinate)
        for osm_id, node_ids in incoming_topology.way_node_ids_by_id.items():
            if osm_id not in self.to_pology.way_node_ids_by_id:
                self.to_pology.way_node_ids_by_id[osm_id] = list(node_ids)
        for osm_id, members in incoming_topology.relation_members_by_id.items():
            if osm_id not in self.to_pology.relation_members_by_id:
                self.to_pology.relation_members_by_id[osm_id] = list(members)
