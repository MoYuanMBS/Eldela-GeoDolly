/** Leaflet TileLayer 初始视口 ready 控制器。 */

import type {Map as LeafletMap, TileErrorEvent, TileLayer} from "leaflet";
import type {BasemapRuntimeStatus} from "../models/mapsurface/basemap-runtime-models.js";

/**
 * 在挂载 TileLayer 前绑定监听，并把第一次初始加载周期收敛为唯一终态。
 *
 * ready 后立即移除本控制器的监听；后续交互产生的瓦片事件不会反向修改已经发布的状态。
 */
export function mountTileLayerAndWaitForInitialReady(tileLayer: TileLayer, map: LeafletMap): Promise<BasemapRuntimeStatus> {
  return new Promise((resolve) => {
    let settled = false;
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
    const handleLoad = (): void => {
      settle({status: "ready", error: null});
    };
    const handleTileError = (event: TileErrorEvent): void => {
      settle({
        status: "failed",
        error: {code: "tile_load_failed", message: "A required basemap tile failed to load",details: {tile: {x: event.coords.x, y: event.coords.y, z: event.coords.z}}}
      });
    };

    tileLayer.on("load", handleLoad);
    tileLayer.on("tileerror", handleTileError);
    try {
      tileLayer.addTo(map);
    } catch {
      settle({
        status: "failed",
        error: {code: "tile_layer_init", message: "Basemap tile layer failed to mount", details: null}});
    }
  });
}
