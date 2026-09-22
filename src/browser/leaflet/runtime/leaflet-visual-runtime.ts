/**
 * Snapshot 与 Interactive 共用的 Leaflet Visual runtime。
 *
 * 本层借用 Browser Flow 创建的 MapSurface，只组合可选普通 Overlay 与可选独立 Core，
 * 不导入透明 interaction。Basemap-only 把两种 visual 都设为 null。
 */

import type {LeafletVisualRuntimeOptions, LeafletVisualRuntimeResult} from "../../../models/mapsurface/basemap-runtime-models.js";
import type {CoreOverlayRenderResult} from "../../../models/mapsurface/core-render-models.js";
import type {OverlayRenderResult} from "../../../models/mapsurface/leaflet-renderer-models.js";
import {AppError} from "../../../shared/app-error.js";
import {renderCoreOverlay} from "../core-render/core-overlay-render.js";
import {renderOverlay} from "./overlay-render.js";

/**
 * 在已稳定的 MapSurface 上创建 Visual，并等待首次同步测量完成后返回。
 *
 * 本函数不会创建 Interaction pane 或命中层。任何 Visual 初始化异常都会先回收已创建资源，
 * 但 MapSurface 始终由调用方负责释放。
 */
export async function createLeafletVisualRuntime(options: LeafletVisualRuntimeOptions): Promise<LeafletVisualRuntimeResult> {
  let visualResult: OverlayRenderResult | null = null;
  let coreResult: CoreOverlayRenderResult | null = null;
  let disposed = false;
  try {
    // null 是显式的 Basemap-only 分支；不要构造空 renderer 来伪装 Overlay。
    if (options.overlay !== null) visualResult = await renderOverlay({...options.overlay, map: options.mapSurface.map});
    // Core 与普通 Overlay 分别持有结果；GeoJSON 校验跳过时 renderer 正常返回 null。
    if (options.coreOverlay !== null) coreResult = await renderCoreOverlay({...options.coreOverlay, map: options.mapSurface.map});
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      visualResult?.dispose();
      coreResult?.dispose();
    };
    return Object.freeze({visualResult, coreResult, dispose});
  } catch (error) {
    // 两个 renderer 负责各自半成品；借用的 MapSurface 留给 Browser Flow 统一处理。
    visualResult?.dispose();
    coreResult?.dispose();
    throw AppError.fromUnknown(error, "map_render", "Map visual rendering failed");
  }
}
