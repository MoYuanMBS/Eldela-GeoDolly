/** Snapshot 入口只启动共享 MapSurface + Visual runtime，不静态依赖 Interaction。 */

import type {MapSurfaceHandle} from "../models/leaflet-renderer-models.js";
import {AppError} from "../utils/app-error.js";
import {createMapSurface, type MapSurfaceOptions} from "../leaflet/runtime/map-surface.js";
import {
  createLeafletVisualRuntime,
  type LeafletVisualRuntimeOptions,
  type LeafletVisualRuntimeResult,
} from "../leaflet/runtime/leaflet-visual-runtime.js";

/** Snapshot 不附加交互状态，但负责创建并持有唯一 MapSurface。 */
export interface SnapshotMapFlowOptions extends Omit<LeafletVisualRuntimeOptions, "mapSurface"> {
  /** Browser Flow 用于创建唯一 MapSurface 的固定尺寸与初始视口输入。 */
  mapSurface: MapSurfaceOptions;
}

/** Snapshot 返回自己持有的 MapSurface 与借助共享 runtime 创建的 Visual。 */
export interface SnapshotMapFlowResult extends LeafletVisualRuntimeResult {
  mapSurface: MapSurfaceHandle;
  /** 幂等执行 Visual → MapSurface 清理。 */
  dispose(): void;
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
