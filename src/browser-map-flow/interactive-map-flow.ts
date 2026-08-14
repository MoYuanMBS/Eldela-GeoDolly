/** Interactive 入口在共享 Visual 首次测量完成后，再附加唯一透明命中层。 */

import type {
  InteractiveMapFlowOptions,
  InteractiveMapFlowResult,
  LeafletVisualRuntimeResult,
} from "../models/mapsurface/basemap-runtime-models.js";
import type {MapSurfaceHandle, OverlayInteractionResult} from "../models/mapsurface/leaflet-renderer-models.js";
import {AppError} from "../utils/app-error.js";
import {attachOverlayInteraction} from "../leaflet/runtime/overlay-interaction.js";
import {createMapSurface} from "../leaflet/runtime/map-surface.js";
import {createLeafletVisualRuntime} from "../leaflet/runtime/leaflet-visual-runtime.js";

/**
 * 先完成 Visual 的首次测量，再使用同一份投影 geometry 和 measurement 附加 Interaction。
 *
 * 这一顺序保证命中层创建时不需要重新执行样式、relation 或 geometry 计算；若附加过程失败，
 * 已创建的 Visual 与 MapSurface 也会在异常继续上抛前一并释放。
 */
export async function createInteractiveMapFlow(options: InteractiveMapFlowOptions): Promise<InteractiveMapFlowResult> {
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
  let interactionResult: OverlayInteractionResult | null = null;
  let disposed = false;
  try {
    // Overlay 明确缺席时保留可用的 MapSurface，供纯底图流程继续接管。
    if (visualRuntime.visualResult !== null) {
      interactionResult = attachOverlayInteraction({
        map: mapSurface.map,
        visualResult: visualRuntime.visualResult,
        config: options.interactionConfig,
      });
    }
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      interactionResult?.dispose();
      visualRuntime.dispose();
      mapSurface.dispose();
    };
    return Object.freeze({
      mapSurface,
      visualResult: visualRuntime.visualResult,
      coreResult: visualRuntime.coreResult,
      interactionResult,
      dispose,
    });
  } catch (error) {
    // attach 可能只完成了部分命中层；异常路径仍严格遵循 Interaction → Visual 的清理顺序。
    interactionResult?.dispose();
    visualRuntime.dispose();
    mapSurface.dispose();
    throw AppError.fromUnknown(error, "overlay_interaction", "Overlay interaction initialization failed");
  }
}
