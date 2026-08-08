/** Interactive 入口在共享 Visual 首次测量完成后，再附加唯一透明命中层。 */

import type {LeafletConfigType} from "../models/config-models.js";
import type {OverlayInteractionResult} from "../models/leaflet-renderer-models.js";
import {attachOverlayInteraction} from "./runtime/overlay-interaction.js";
import {
  createLeafletVisualRuntime,
  type LeafletVisualRuntimeOptions,
  type LeafletVisualRuntimeResult,
} from "./runtime/leaflet-visual-runtime.js";

export interface InteractiveMapFlowOptions extends LeafletVisualRuntimeOptions {
  interactionConfig: LeafletConfigType["interaction"];
}

export interface InteractiveMapFlowResult extends LeafletVisualRuntimeResult {
  interactionResult: OverlayInteractionResult | null;
  /** 幂等执行 Interaction → Visual → MapSurface 清理。 */
  dispose(): void;
}

export async function createInteractiveMapFlow(options: InteractiveMapFlowOptions): Promise<InteractiveMapFlowResult> {
  const visualRuntime = await createLeafletVisualRuntime(options);
  let interactionResult: OverlayInteractionResult | null = null;
  let disposed = false;
  try {
    if (visualRuntime.visualResult !== null) {
      interactionResult = attachOverlayInteraction({
        map: visualRuntime.map,
        visualResult: visualRuntime.visualResult,
        config: options.interactionConfig,
      });
    }
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      interactionResult?.dispose();
      visualRuntime.dispose();
    };
    return Object.freeze({
      map: visualRuntime.map,
      visualResult: visualRuntime.visualResult,
      interactionResult,
      dispose,
    });
  } catch (error) {
    interactionResult?.dispose();
    visualRuntime.dispose();
    throw error;
  }
}
