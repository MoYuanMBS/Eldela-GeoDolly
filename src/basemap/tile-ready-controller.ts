/** Leaflet TileLayer 初始视口 ready 控制器。 */

import type {Map as LeafletMap, TileErrorEvent, TileLayer} from "leaflet";
import type {BasemapRuntimeStatus} from "../models/mapsurface/basemap-runtime-models.js";

/**
 * 在挂载 TileLayer 前绑定监听，并把第一次初始加载周期收敛为唯一终态。
 *
 * 第一个 `tileerror` 会立即失败；全部必要瓦片结束后发布的 `load` 则代表 ready。终态发布后立即移除
 * 本控制器的监听，后续拖动或缩放产生的瓦片事件不会反向修改已经发布的状态。本函数不拥有 Layer，
 * 因此不提供独立 dispose，也不会在失败时从 MapSurface 移除它。
 *
 * @param tileLayer 已完成来源和 zoom 配置、尚未挂载的在线 raster TileLayer。
 * @param map Browser Flow 创建并持有的唯一 Leaflet Map。
 * @returns 初始视口瓦片唯一的 ready/failed 状态。
 */
export function mountTileLayerAndWaitForInitialReady(tileLayer: TileLayer, map: LeafletMap): Promise<BasemapRuntimeStatus> {
  return new Promise((resolve) => {
    let settled = false;
    // 本控制器只观察首次加载周期；终态之后由 Leaflet 自己继续管理交互产生的瓦片。
    const cleanup = (): void => {
      tileLayer.off("load", handleLoad);
      tileLayer.off("tileerror", handleTileError);
    };
    const settle = (status: BasemapRuntimeStatus): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(status);
    };
    // TileLayer 的 load 只在当前可见范围没有待加载瓦片时触发。
    const handleLoad = (): void => {
      settle({status: "ready", error: null});
    };
    // 只向汇总层暴露定位失败瓦片所需的坐标，不泄漏 provider URL 或底层异常对象。
    const handleTileError = (event: TileErrorEvent): void => {
      settle({
        status: "failed",
        error: {code: "tile_load_failed", message: "A required basemap tile failed to load",details: {tile: {x: event.coords.x, y: event.coords.y, z: event.coords.z}}}
      });
    };

    tileLayer.on("load", handleLoad);
    tileLayer.on("tileerror", handleTileError);
    try {
      // 监听必须先于 addTo，避免同步创建首批瓦片时错过事件。
      tileLayer.addTo(map);
    } catch {
      settle({
        status: "failed",
        error: {code: "tile_layer_init", message: "Basemap tile layer failed to mount", details: null}});
    }
  });
}
