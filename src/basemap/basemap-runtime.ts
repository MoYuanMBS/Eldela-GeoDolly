/** Browser 侧在线 raster TileLayer runtime。 */

import {tileLayer, Util, type Map as LeafletMap, type TileLayer} from "leaflet";
import type {BasemapRuntimeOptions, BasemapRuntimeStatus, SnapshotBasemapRuntimeOptions, SnapshotBasemapRuntimeResult} from "../models/mapsurface/basemap-runtime-models.js";
import {mountTileLayerAndWaitForInitialReady, mountTileLayerAndWaitForSnapshotReady} from "./tile-ready-controller.js";

/** Browser 只使用同源固定路由；upstream 模板、headers 与 provider 行为均留在服务端。 */
function createRasterTileLayer(profileId: string, map: LeafletMap, maxNativeZoom: number): TileLayer {
  return tileLayer(`/basemap/${profileId}/{z}/{x}/{y}`, {
    maxZoom: map.getMaxZoom(),
    maxNativeZoom,
    detectRetina: false,
    errorTileUrl: Util.emptyImageUrl,
  });
}

/** 初始 ready 后继续观察交互产生的瓦片；失败时由透明空瓦片保持地图可用。 */
function attachRuntimeWarning(layer: TileLayer, options: BasemapRuntimeOptions): void {
  layer.on("tileerror", () => {
    options.warningReporter?.({
      event: "basemap_tile_unavailable",
      details: {profile_id: options.basemap.id, phase: "runtime", reason_code: "tile_load_failed"},
    });
  });
}

/** 创建同源 TileLayer 并等待 Interactive 初始视口的瓦片终态。 */
export async function createBasemapRuntime(options: BasemapRuntimeOptions): Promise<BasemapRuntimeStatus> {
  const map = options.mapSurface.map;
  let layer: TileLayer;
  try {
    layer = createRasterTileLayer(options.basemap.id, map, options.basemap.max_native_zoom);
  } catch {
    return {
      status: "failed",
      error: {code: "tile_layer_init", message: "Basemap tile layer failed to initialize", details: null},
    };
  }

  const status = await mountTileLayerAndWaitForInitialReady(layer, map);
  if (status.status === "ready") attachRuntimeWarning(layer, options);
  return status;
}

/** Snapshot 使用同一同源 TileLayer，但保留固定首屏成功率统计。 */
export async function createSnapshotBasemapRuntime(options: SnapshotBasemapRuntimeOptions): Promise<SnapshotBasemapRuntimeResult> {
  const map = options.mapSurface.map;
  let layer: TileLayer;
  try {
    layer = createRasterTileLayer(options.basemap.id, map, options.basemap.max_native_zoom);
  } catch {
    return {
      status: {status: "failed", error: {code: "tile_layer_init", message: "Basemap tile layer failed to initialize", details: null}},
      initialTiles: {success_count: 0, total_count: 0, success_ratio: 0, required_ratio: options.minimumInitialTileSuccessRatio},
    };
  }

  const result = await mountTileLayerAndWaitForSnapshotReady(layer, map, options.minimumInitialTileSuccessRatio, options.signal);
  if (result.status.status === "ready") attachRuntimeWarning(layer, options);
  return result;
}
