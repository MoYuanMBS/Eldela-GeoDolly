"""Overlay 二阶段 relation / way / node skeleton 抓取编排。

本模块只负责把第一阶段选中的 Overlay 对象转换成 geometry 所需的拓扑索引：
relation 提供 members，way 提供 node refs，node 提供坐标。原始 tags 仍留在
`overlay_maps`，这里不执行 Filter、不合并 tags，也不构建 Shapely geometry。
"""

from __future__ import annotations

import asyncio
from typing import Literal

from python.core.overpass.maping import OverlayTopologyStore
from python.core.overpass.overlay_query import (
    build_overlay_node_skel_query,
    build_overlay_relation_skel_query,
    build_overlay_way_skel_query
)
from python.core.overpass.overpass import request_overpass
from python.utils.config_loader import config
from python.utils.internal_models.overpass import OverlayTopology, TypedOsmMaps
from python.utils.models import Geometry


def _chunk_osm_ids(osm_ids: set[int], batch_size: int) -> list[tuple[int, ...]]:
    """稳定排序并拆分 node IDs，避免单条 node Query 过长。"""
    # set 已经完成跨 way/relation 去重；排序保证每次请求的分组和 QL 文本稳定。
    sorted_ids = sorted(osm_ids)
    return [tuple(sorted_ids[index:index + batch_size]) for index in range(0, len(sorted_ids), batch_size)]


async def _fetch_relation_topology(relation_ids: set[int]) -> OverlayTopology:
    """抓取同一递归层的 relation members，并立即校验成 topology。"""
    # relation Query 不带 bbox，因为 out skel 必须完整返回 member list。
    payload = await request_overpass(build_overlay_relation_skel_query(relation_ids))
    return OverlayTopologyStore(payload).topology


async def _fetch_way_topology(way_ids: set[int]) -> OverlayTopology:
    """抓取全部目标/support way 的有序 node refs。"""
    # way Query 也不带 bbox，否则可能无法获得构建线/面所需的完整 node 顺序。
    payload = await request_overpass(build_overlay_way_skel_query(way_ids))
    return OverlayTopologyStore(payload).topology


async def _fetch_node_batch(
    node_ids: tuple[int, ...],
    tile_bbox: Geometry.BBox,
    semaphore: asyncio.Semaphore
) -> OverlayTopology:
    """在并发限制内抓取单批、位于 tile bbox 内的 node coordinates。"""
    # gather 会同时创建多个批次任务，Semaphore 只允许配置数量的请求真正进入网络层。
    async with semaphore:
        payload = await request_overpass(build_overlay_node_skel_query(node_ids, tile_bbox))
    # NodeSkeleton 在这里完成 Pydantic 校验，并把 Overpass lat/lon 转成内部 (lon, lat)。
    return OverlayTopologyStore(payload).topology


def _nested_relation_ids(topology: OverlayTopology) -> set[int]:
    """收集当前已抓 relation 中引用的 child relation IDs。"""
    # role 和原始 member 顺序仍保存在 topology；这里只提取下一层抓取所需的 identity。
    return {
        member.ref
        for members in topology.relation_members_by_id.values()
        for member in members
        if member.type == "relation"
    }


def _relation_member_ids(topology: OverlayTopology, member_type: Literal["node", "way"]) -> set[int]:
    """按成员类型收集 relation member IDs。"""
    # 多个 relation 引用同一 member 时由 set 合并为一个二阶段抓取需求。
    return {
        member.ref
        for members in topology.relation_members_by_id.values()
        for member in members
        if member.type == member_type
    }


def _add_known_node_coordinates(
    topology_store: OverlayTopologyStore,
    required_node_ids: set[int],
    known_maps: TypedOsmMaps
) -> None:
    """复用第一阶段已有 node body，并通过 skeleton model 统一校验和转换。"""
    # 第一阶段 node 使用 out body，通常已经带坐标；先复用可以显著减少二阶段 node 请求。
    for osm_id in sorted(required_node_ids):
        element = known_maps.nodes_by_id.get(osm_id)
        if element is None:
            continue
        lat = element.get("lat")
        lon = element.get("lon")
        if lat is None or lon is None:
            # 已知对象没有完整坐标时不在这里猜测，留给后面的 bbox node Query 补抓。
            continue
        # 只取 skeleton 所需字段，不把第一阶段 tags 写入 OverlayTopology。
        topology_store.add_element({"type": "node", "id": osm_id, "lat": lat, "lon": lon})


async def fetch_overlay_topology(
    overlay_maps: TypedOsmMaps,
    tile_bbox: Geometry.BBox,
    known_maps: TypedOsmMaps | None = None
) -> OverlayTopology:
    """按 relation → way → node 顺序抓取并合并 Overlay topology。

    `overlay_maps` 决定哪些带 tags 的对象是 Overlay 目标；`known_maps` 可传入
    第一阶段 combined maps，用于复用已下载的 node 坐标。返回值只包含 members、
    node refs 与 `(lon, lat)` 坐标，供后续 geometry builder 使用。
    """
    topology_store = OverlayTopologyStore()

    # 第一段：展开 Overlay 选中的 relation。
    # level=0 表示根 relation 自身；配置 depth=0 仍会抓根 members，但不继续抓 child relation。
    pending_relation_ids = set(overlay_maps.relations_by_id)
    fetched_relation_ids: set[int] = set()
    relation_level = 0
    relation_depth = config.overpass.relation_member_depth
    while pending_relation_ids and (relation_depth == "all" or relation_level <= relation_depth):
        # fetched 集合同时负责 relation 环和多个 parent 引用同一 child 时的去重。
        current_relation_ids = pending_relation_ids - fetched_relation_ids
        if not current_relation_ids:
            break
        relation_topology = await _fetch_relation_topology(current_relation_ids)
        # 每一层都立即并入总 topology，后续才能一次汇总所有终端 way/node member。
        topology_store.merge_stage2(relation_topology)
        fetched_relation_ids.update(current_relation_ids)
        pending_relation_ids = _nested_relation_ids(relation_topology) - fetched_relation_ids
        relation_level += 1

    # 第二段：直接命中的 way 和 relation 展开得到的 support way 使用同一个去重集合。
    required_way_ids = set(overlay_maps.ways_by_id)
    required_way_ids.update(_relation_member_ids(topology_store.topology, "way"))
    if required_way_ids:
        topology_store.merge_stage2(await _fetch_way_topology(required_way_ids))

    # 第三段：node 需求来自三处——直接命中的 node、relation 的直接 node member、全部 way refs。
    required_node_ids = set(overlay_maps.nodes_by_id)
    required_node_ids.update(_relation_member_ids(topology_store.topology, "node"))
    for node_ids in topology_store.topology.way_node_ids_by_id.values():
        required_node_ids.update(node_ids)

    # known_maps 通常传 combined maps；未传时至少复用 overlay target node 自己的一阶段坐标。
    available_maps = overlay_maps if known_maps is None else known_maps
    _add_known_node_coordinates(topology_store, required_node_ids, available_maps)
    # 只有仍缺坐标的 node 才进入网络批次，避免重复下载第一阶段已经拥有的 body。
    missing_node_ids = required_node_ids - topology_store.topology.node_coordinates_by_id.keys()
    node_batches = _chunk_osm_ids(missing_node_ids, config.overpass.overlay_node_batch_size)
    if node_batches:
        semaphore = asyncio.Semaphore(config.overpass.overlay_node_concurrency)
        node_topologies = await asyncio.gather(*(
            _fetch_node_batch(node_batch, tile_bbox, semaphore)
            for node_batch in node_batches
        ))
        # gather 按传入批次顺序返回；逐批 first-wins 合并可保持稳定结果。
        for node_topology in node_topologies:
            topology_store.merge_stage2(node_topology)

    # 此时仍是 topology，不包含 tags、geometry 或 feature_id。
    return topology_store.topology
