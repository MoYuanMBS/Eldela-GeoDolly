/** Snapshot 入口只启动共享 MapSurface + Visual runtime，不静态依赖 Interaction。 */

import type {
  LeafletVisualRuntimeResult,
  SnapshotMapFlowOptions,
  SnapshotMapFlowResult,
} from "../models/mapsurface/basemap-runtime-models.js";
import type {MapSurfaceHandle} from "../models/mapsurface/leaflet-renderer-models.js";
import {AppError} from "../utils/app-error.js";
import {createMapSurface} from "../leaflet/runtime/map-surface.js";
import {createLeafletVisualRuntime} from "../leaflet/runtime/leaflet-visual-runtime.js";

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
  let visualRuntime: LeafletVisualRuntimeResult;
  try {
    visualRuntime = await createLeafletVisualRuntime({
      mapSurface,
      overlay: options.overlay,
      coreOverlay: options.coreOverlay,
    });
  } catch (error) {
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
  return Object.freeze({
    mapSurface,
    visualResult: visualRuntime.visualResult,
    coreResult: visualRuntime.coreResult,
    dispose,
  });
}
