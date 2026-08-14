/** Interactive 入口在共享 Visual 首次测量完成后，再附加唯一透明命中层。 */

import type {LeafletConfigType} from "../models/config-models.js";
import type {MapSurfaceHandle, OverlayInteractionResult} from "../models/leaflet-renderer-models.js";
import {AppError} from "../utils/app-error.js";
import {attachOverlayInteraction} from "../leaflet/runtime/overlay-interaction.js";
import {createMapSurface, type MapSurfaceOptions} from "../leaflet/runtime/map-surface.js";
import {
  createLeafletVisualRuntime,
  type LeafletVisualRuntimeOptions,
  type LeafletVisualRuntimeResult,
} from "../leaflet/runtime/leaflet-visual-runtime.js";

export interface InteractiveMapFlowOptions extends Omit<LeafletVisualRuntimeOptions, "mapSurface"> {
  /** Browser Flow 用于创建唯一 MapSurface 的固定尺寸与初始视口输入。 */
  mapSurface: MapSurfaceOptions;
  /** 仅供透明命中层使用；Visual runtime 不读取交互配置。 */
  interactionConfig: LeafletConfigType["interaction"];
}

/** Interactive 入口持有共享 Visual 结果，以及后挂载的透明命中层。 */
export interface InteractiveMapFlowResult extends LeafletVisualRuntimeResult {
  /** Basemap、Visual 与 Interaction 共用的唯一 MapSurface。 */
  mapSurface: MapSurfaceHandle;
  /** Basemap-only 或没有 Overlay 时为 null，不表示初始化失败。 */
  interactionResult: OverlayInteractionResult | null;
  /** 幂等执行 Interaction → Visual → MapSurface 清理。 */
  dispose(): void;
}

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
