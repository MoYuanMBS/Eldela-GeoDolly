"""Overlay 二阶段 relation / way / node skeleton 抓取编排。

本模块只负责把第一阶段选中的 Overlay 对象转换成 geometry 所需的拓扑索引：
relation 提供 members，way 提供 node refs，node 提供坐标。原始 tags 仍留在
`overlay_maps`，这里不执行 Filter、不合并 tags，也不构建 Shapely geometry。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from typing import Literal

from python.core.output.overlay_geometry import is_area_way
from python.core.overpass.maping import OverlayTopologyStore
import python.core.overpass.overlay_query as overlay_query
from python.core.overpass.overpass import request_overpass
from python.utils.config_loader import config
from python.utils.internal_models.overpass import OverlayTopology, TypedOsmMaps
from python.utils.models import Geometry

warning_logger = logging.getLogger("geomcp.warning")


def _chunk_osm_ids(osm_ids: set[int], batch_size: int) -> list[tuple[int, ...]]:
    """稳定排序并拆分 node IDs，避免单条 node Query 过长。"""
    # set 已经完成跨 way/relation 去重；排序保证每次请求的分组和 QL 文本稳定。
    sorted_ids = sorted(osm_ids)
    return [tuple(sorted_ids[index:index + batch_size]) for index in range(0, len(sorted_ids), batch_size)]


async def _fetch_relation_topology(relation_ids: set[int]) -> OverlayTopology:
    """抓取同一递归层的 relation members，并立即校验成 topology。"""
    # relation Query 不带 bbox，因为 out skel 必须完整返回 member list。
    return await _fetch_skel_topology_batches(relation_ids, overlay_query.build_overlay_relation_skel_query)


async def _fetch_way_topology(way_ids: set[int]) -> OverlayTopology:
    """抓取全部目标/support way 的有序 node refs。"""
    # way Query 也不带 bbox，否则可能无法获得构建线/面所需的完整 node 顺序。
    return await _fetch_skel_topology_batches(way_ids, overlay_query.build_overlay_way_skel_query)


async def _fetch_skel_topology_batches(
    osm_ids: set[int],
    build_query: Callable[[tuple[int, ...]], str]
) -> OverlayTopology:
    """按统一 ID 上限抓取二阶段 skeleton，并合并为 topology。"""
    topology_store = OverlayTopologyStore()
    batches = _chunk_osm_ids(osm_ids, config.overpass.overlay_skel_id_batch_size)
    semaphore = asyncio.Semaphore(config.overpass.overlay_skel_concurrency)
    start_lock = asyncio.Lock()
    next_start_at = [0.0]

    async def fetch_batch(osm_id_batch: tuple[int, ...]) -> OverlayTopology:
        """在并发上限和全局启动间隔内抓取单个 skel batch。"""
        async with semaphore:
            async with start_lock:
                loop = asyncio.get_running_loop()
                wait_seconds = next_start_at[0] - loop.time()
                if wait_seconds > 0:
                    await asyncio.sleep(wait_seconds)
                next_start_at[0] = loop.time() + config.overpass.overlay_skel_batch_delay_seconds
            payload = await request_overpass(build_query(osm_id_batch))
            return OverlayTopologyStore(payload).to_pology

    # gather 按传入批次顺序返回；逐批 first-wins 合并可保持稳定结果。
    for batch_topology in await asyncio.gather(*(fetch_batch(batch) for batch in batches)):
        topology_store.merge_stage2(batch_topology)
    return topology_store.to_pology


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


def _area_completion_node_ids(
    overlay_maps: TypedOsmMaps,
    topology: OverlayTopology
) -> set[int]:
    """收集直接选中的 area ways 在 bbox node Query 后仍缺失的 node IDs。"""
    completion_node_ids: set[int] = set()
    known_node_ids = topology.node_coordinates_by_id.keys()
    max_nodes = config.overpass.overlay_skel_id_batch_size

    # 只检查第一阶段 Overlay 直接选中的 ways；relation 展开的 support way 不生成 Feature，
    # 因而不能把大型 relation 的 bbox 外节点带进无 bbox completion Query。
    for osm_id, element in sorted(overlay_maps.ways_by_id.items()):
        tags = element.get("tags")
        node_ids = topology.way_node_ids_by_id.get(osm_id)
        if not isinstance(tags, dict) or node_ids is None or not is_area_way(node_ids, tags):
            continue

        missing_node_ids = set(node_ids) - known_node_ids
        new_node_ids = missing_node_ids - completion_node_ids
        if len(completion_node_ids) + len(new_node_ids) > max_nodes:
            # 上限按整次 Stage 2 请求累计。当前 way 不做部分补抓，否则依然无法形成完整 Polygon。
            warning_logger.warning(
                "skip_overlay_area_completion",
                extra={"geomcp_extra": {
                    "status": "skipped",
                    "reason": "node_limit_exceeded",
                    "filter_stage": "overlay_area_completion",
                    "osm_type": "way",
                    "osm_id": osm_id,
                    "missing_node_count": len(missing_node_ids),
                    "max_nodes": max_nodes
                }}
            )
            continue
        completion_node_ids.update(new_node_ids)

    return completion_node_ids


async def complete_overlay_area_nodes(
    overlay_maps: TypedOsmMaps,
    topology: OverlayTopology
) -> OverlayTopology:
    """为直接选中的 area ways 单独补抓 bbox 外缺失节点，并返回合并后 topology。"""
    completion_node_ids = _area_completion_node_ids(overlay_maps, topology)
    if not completion_node_ids:
        return topology

    topology_store = OverlayTopologyStore()
    topology_store.merge_stage2(topology)
    topology_store.merge_stage2(await _fetch_skel_topology_batches(
        completion_node_ids,
        overlay_query.build_overlay_node_completion_query
    ))
    return topology_store.to_pology


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
    required_way_ids.update(_relation_member_ids(topology_store.to_pology, "way"))
    if required_way_ids:
        topology_store.merge_stage2(await _fetch_way_topology(required_way_ids))

    # 第三段：node 需求来自三处——直接命中的 node、relation 的直接 node member、全部 way refs。
    required_node_ids = set(overlay_maps.nodes_by_id)
    required_node_ids.update(_relation_member_ids(topology_store.to_pology, "node"))
    for node_ids in topology_store.to_pology.way_node_ids_by_id.values():
        required_node_ids.update(node_ids)

    # known_maps 通常传 combined maps；未传时至少复用 overlay target node 自己的一阶段坐标。
    available_maps = overlay_maps if known_maps is None else known_maps
    _add_known_node_coordinates(topology_store, required_node_ids, available_maps)
    # 只有仍缺坐标的 node 才进入网络批次，避免重复下载第一阶段已经拥有的 body。
    missing_node_ids = required_node_ids - topology_store.to_pology.node_coordinates_by_id.keys()
    if missing_node_ids:
        # NodeSkeleton 在这里完成 Pydantic 校验，并把 Overpass lat/lon 转成内部 (lon, lat)。
        topology_store.merge_stage2(await _fetch_skel_topology_batches(
            missing_node_ids,
            lambda node_ids: overlay_query.build_overlay_node_skel_query(node_ids, tile_bbox)
        ))

    # 此时仍是 topology，不包含 tags、geometry 或 feature_id。
    return topology_store.to_pology
