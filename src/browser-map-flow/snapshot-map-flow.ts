/** Snapshot 入口并发启动 Basemap 与 Visual runtime，不静态依赖 Interaction。 */

import type {
  BasemapRuntimeStatus,
  LeafletVisualRuntimeResult,
  SnapshotMapFlowOptions,
  SnapshotMapFlowResult,
} from "../models/mapsurface/basemap-runtime-models.js";
import type {LeafletMetricScaleResult, MapSurfaceHandle} from "../models/mapsurface/leaflet-renderer-models.js";
import {AppError} from "../utils/app-error.js";
import {createBasemapRuntime} from "../basemap/basemap-runtime.js";
import {createMapSurface} from "../leaflet/runtime/map-surface.js";
import {calculateLeafletMetricScale} from "../leaflet/runtime/metric-scale.js";
import {createLeafletVisualRuntime} from "../leaflet/runtime/leaflet-visual-runtime.js";
import {combineMapFlowAbortSignal, createMapFlowReadySummary, waitForMapFlowReady} from "./map-flow-ready.js";

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
  let metricScale: LeafletMetricScaleResult;
  try {
    metricScale = calculateLeafletMetricScale(mapSurface.map);
  } catch (error) {
    mapSurface.dispose();
    throw AppError.fromUnknown(error, "metric_scale_failed", "Leaflet metric scale initialization failed");
  }
  const timeoutController = new AbortController();
  let basemapStatus: BasemapRuntimeStatus;
  let visualRuntime: LeafletVisualRuntimeResult;
  const completedVisualRuntime: {value: LeafletVisualRuntimeResult | null} = {value: null};
  try {
    [basemapStatus, visualRuntime] = await waitForMapFlowReady(Promise.all([
      createBasemapRuntime({mapSurface, basemap: options.basemap}),
      createLeafletVisualRuntime({
        mapSurface,
        overlay: options.overlay === null ? null : {
          ...options.overlay,
          signal: combineMapFlowAbortSignal(options.overlay.signal, timeoutController.signal),
        },
        coreOverlay: options.coreOverlay === null ? null : {
          ...options.coreOverlay,
          signal: combineMapFlowAbortSignal(options.coreOverlay.signal, timeoutController.signal),
        },
      }).then((result) => {
        completedVisualRuntime.value = result;
        return result;
      }),
    ]), options.readyTimeoutMs, timeoutController);
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
  return Object.freeze({
    mapSurface,
    basemapStatus,
    readySummary,
    metricScale,
    visualResult: visualRuntime.visualResult,
    coreResult: visualRuntime.coreResult,
    dispose,
  });
}
