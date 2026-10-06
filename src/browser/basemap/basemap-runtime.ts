/** Browser 侧在线 raster TileLayer runtime。 */

import {tileLayer, Util, type Map as LeafletMap, type TileLayer} from "leaflet";
import type {BasemapRuntimeOptions, BasemapRuntimeStatus, SnapshotBasemapRuntimeOptions, SnapshotBasemapRuntimeResult, SnapshotTileViewController} from "../../models/mapsurface/basemap-runtime-models.js";
import {mountTileLayerAndWaitForInitialReady, mountTileLayerAndWaitForSnapshotReady, observeSnapshotTileViews} from "./tile-ready-controller.js";
import {AppError} from "../../shared/app-error.js";

/** Backend 页面与 MCP App 共用带 session ID 的路由；provider 行为仍留在服务端。 */
function createRasterTileLayer(profileId: string, map: LeafletMap, maxNativeZoom: number): TileLayer {
  const baseUrl = document.querySelector<HTMLMetaElement>('meta[name="geomcp-basemap-base-url"]')?.content;
  if (baseUrl === undefined) throw new AppError("missing_basemap_session_url", "Basemap session URL is missing");
  return tileLayer(`${baseUrl}/${profileId}/{z}/{x}/{y}`, {
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
    // Leaflet 把 Util.emptyImageUrl 当作已移除瓦片并吞掉 tileerror；使用独立透明图才能结束首屏失败等待。
    layer.options.errorTileUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAABmJLR0QA/wD/AP+gvaeTAAAAC0lEQVQImWNgAAIAAAUAAWJVMogAAAAASUVORK5CYII=";
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
export async function createSnapshotBasemapRuntime(options: SnapshotBasemapRuntimeOptions): Promise<SnapshotBasemapRuntimeResult & SnapshotTileViewController> {
  const map = options.mapSurface.map;
  let layer: TileLayer;
  try {
    layer = createRasterTileLayer(options.basemap.id, map, options.basemap.max_native_zoom);
    // 与 User 地图一样避开 Leaflet 对 emptyImageUrl 的终态吞掉；透明 fallback 仍按失败位置计数。
    layer.options.errorTileUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAABmJLR0QA/wD/AP+gvaeTAAAAC0lEQVQImWNgAAIAAAUAAWJVMogAAAAASUVORK5CYII=";
  } catch {
    return {
      status: {status: "failed", error: {code: "tile_layer_init", message: "Basemap tile layer failed to initialize", details: null}},
      initialTiles: {success_count: 0, total_count: 0, success_ratio: 0, required_ratio: options.minimumInitialTileSuccessRatio},
      waitForCurrentView: async () => { throw new AppError("tile_layer_init", "Basemap tile layer failed to initialize"); },
      dispose: () => {},
    };
  }

  const views = observeSnapshotTileViews(layer, map, options.minimumInitialTileSuccessRatio);
  try {
    const result = await mountTileLayerAndWaitForSnapshotReady(layer, map, options.minimumInitialTileSuccessRatio, options.signal);
    if (result.status.status === "ready") attachRuntimeWarning(layer, options);
    return {...result, ...views};
  } catch (error) {
    views.dispose();
    throw error;
  }
}
