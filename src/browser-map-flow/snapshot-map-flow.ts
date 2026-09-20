/** Snapshot 入口并发启动 Basemap 与 Visual runtime，不静态依赖 Interaction。 */

import type {
  BasemapRuntimeStatus,
  LeafletVisualRuntimeResult,
  SnapshotMapFlowOptions,
  SnapshotMapFlowResult,
} from "../models/mapsurface/basemap-runtime-models.js";
import type {LeafletMetricScaleResult, MapSurfaceHandle, OverlayRenderResult} from "../models/mapsurface/leaflet-renderer-models.js";
import {AppError} from "../utils/app-error.js";
import {createSnapshotBasemapRuntime} from "../basemap/basemap-runtime.js";
import {createMapSurface} from "../leaflet/runtime/map-surface.js";
import {calculateLeafletMetricScale} from "../leaflet/runtime/metric-scale.js";
import {createLeafletVisualRuntime} from "../leaflet/runtime/leaflet-visual-runtime.js";
import {combineMapFlowAbortSignal, createMapFlowReadySummary, waitForMapFlowReady} from "./map-flow-ready.js";

function countVisibleOverlayFeatures(result: OverlayRenderResult | null): SnapshotMapFlowResult["renderedFeatureCounts"]["overlay"] {
  if (result === null) return Object.freeze({node: 0, way: 0, area: 0});
  const counts = {node: 0, way: 0, area: 0};
  for (const featureType of ["node", "way", "area"] as const) {
    for (const entry of result.orderedLayers[featureType]) {
      if (result.measurementController.getMeasurement(featureType, entry.featureId).hasVisiblePaint) counts[featureType] += 1;
    }
  }
  return Object.freeze(counts);
}

/**
 * 启动截图使用的共享地图流程。
 *
 * 保持这个入口为薄边界，可以确保截图 bundle 不静态导入 Interaction；截图 ready、字体和瓦片等待
 * 由更外层编排，不在这里复制另一套 Leaflet 渲染实现。
 */
export async function createSnapshotMapFlow(options: SnapshotMapFlowOptions): Promise<SnapshotMapFlowResult> {
  let mapSurface: MapSurfaceHandle;
  try {
    mapSurface = createMapSurface(options.mapSurface);
  } catch (error) {
    throw AppError.fromUnknown(error, "leaflet_init", "Leaflet map initialization failed");
  }
  let metricScale: LeafletMetricScaleResult | null = null;
  try {
    metricScale = calculateLeafletMetricScale(mapSurface.map, options.metricScaleMaxWidthPx);
  } catch {
    // Snapshot 可以省略 Scale；页面会隐藏对应 UI 并把该恢复路径写入 ready warning。
  }
  const timeoutController = new AbortController();
  // 页面生命周期取消与唯一 ready timer 在 Flow 边界合并一次，所有子流程只消费这个 signal。
  const flowSignal = combineMapFlowAbortSignal(options.signal, timeoutController.signal);
  let basemapStatus: BasemapRuntimeStatus;
  let initialTiles: SnapshotMapFlowResult["initialTiles"];
  let visualRuntime: LeafletVisualRuntimeResult;
  const completedVisualRuntime: {value: LeafletVisualRuntimeResult | null} = {value: null};
  try {
    const [basemapResult, completedVisual] = await waitForMapFlowReady(Promise.all([
      createSnapshotBasemapRuntime({
        mapSurface,
        basemap: options.basemap,
        minimumInitialTileSuccessRatio: options.minimumInitialTileSuccessRatio,
        signal: flowSignal,
        warningReporter: options.warningReporter,
      }),
      createLeafletVisualRuntime({
        mapSurface,
        overlay: options.overlay === null ? null : {
          ...options.overlay,
          signal: flowSignal,
        },
        coreOverlay: options.coreOverlay === null ? null : {
          ...options.coreOverlay,
          signal: flowSignal,
        },
      }).then((result) => {
        completedVisualRuntime.value = result;
        return result;
      }),
    ]), options.readyTimeoutMs, timeoutController);
    basemapStatus = basemapResult.status;
    initialTiles = basemapResult.initialTiles;
    visualRuntime = completedVisual;
  } catch (error) {
    completedVisualRuntime.value?.dispose();
    mapSurface.dispose();
    throw AppError.fromUnknown(error, "map_render", "Map visual rendering failed");
  }
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    visualRuntime.dispose();
    mapSurface.dispose();
  };
  const readySummary = createMapFlowReadySummary(mapSurface, basemapStatus, visualRuntime.visualResult, visualRuntime.coreResult);
  const renderedFeatureCounts = Object.freeze({
    overlay: countVisibleOverlayFeatures(visualRuntime.visualResult),
    core: visualRuntime.coreResult?.renderedFeatureCounts ?? Object.freeze({node: 0, way: 0, area: 0}),
  });
  return Object.freeze({
    mapSurface,
    basemapStatus,
    readySummary,
    metricScale,
    initialTiles,
    renderedFeatureCounts,
    visualResult: visualRuntime.visualResult,
    coreResult: visualRuntime.coreResult,
    dispose,
  });
}
