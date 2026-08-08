/**
 * Snapshot 与 Interactive 共用的 Leaflet Visual runtime。
 *
 * 本层只组合 MapSurface 与可选 Overlay Visual，不导入透明 interaction。Basemap-only 可以把
 * overlay 设为 null；未来 Basemap handle 仍由更外层 flow 与这里返回的同一个 map 对接。
 */

import type {Map as LeafletMap} from "leaflet";
import type {OverlayRendererOptions, OverlayRenderResult} from "../../models/leaflet-renderer-models.js";
import {createMapSurface, type MapSurfaceOptions} from "./map-surface.js";
import {renderOverlay} from "./overlay-render.js";

export interface LeafletVisualRuntimeOptions {
  mapSurface: MapSurfaceOptions;
  /** null 表示当前地图明确跳过 Overlay，而不是渲染失败。 */
  overlay: Omit<OverlayRendererOptions, "map"> | null;
}

export interface LeafletVisualRuntimeResult {
  map: LeafletMap;
  visualResult: OverlayRenderResult | null;
  /** 幂等执行 Visual → MapSurface 清理；Interactive 必须先清理自己的命中层。 */
  dispose(): void;
}

export async function createLeafletVisualRuntime(options: LeafletVisualRuntimeOptions): Promise<LeafletVisualRuntimeResult> {
  const map = createMapSurface(options.mapSurface);
  let visualResult: OverlayRenderResult | null = null;
  let disposed = false;
  try {
    if (options.overlay !== null) visualResult = await renderOverlay({...options.overlay, map});
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      visualResult?.dispose();
      map.remove();
    };
    return Object.freeze({map, visualResult, dispose});
  } catch (error) {
    visualResult?.dispose();
    map.remove();
    throw error;
  }
}
