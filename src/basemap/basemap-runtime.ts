/** Browser 侧在线 raster TileLayer runtime。 */

import {tileLayer} from "leaflet";
import type {MapSurfaceHandle} from "../models/leaflet-renderer-models.js";
import type {ResolvedBasemapType} from "../models/basemap-models.js";
import type {BasemapRuntimeStatus} from "../models/browser-map-flow-models.js";
import {mountTileLayerAndWaitForInitialReady} from "./tile-ready-controller.js";

export interface BasemapRuntimeOptions {
  mapSurface: MapSurfaceHandle;
  basemap: ResolvedBasemapType;
}

/**
 * 创建并挂载所选在线瓦片层，等待当前初始视口的瓦片加载终态。
 *
 * TileLayer 随 MapSurface 统一销毁；本 runtime 不创建 attribution、UI 或独立 dispose handle。
 */
export async function createBasemapRuntime(options: BasemapRuntimeOptions): Promise<BasemapRuntimeStatus> {
  try {
    const map = options.mapSurface.map;
    const layer = tileLayer(options.basemap.url, {
      maxZoom: map.getMaxZoom(),
      maxNativeZoom: options.basemap.max_native_zoom,
      detectRetina: false
    });
    return await mountTileLayerAndWaitForInitialReady(layer, map);
  } catch {
    return {
      status: "failed",
      error: {code: "tile_layer_init", message: "Basemap tile layer failed to initialize", details: null}};
  }
}
