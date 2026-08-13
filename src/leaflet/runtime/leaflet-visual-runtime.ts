/**
 * Snapshot 与 Interactive 共用的 Leaflet Visual runtime。
 *
 * 本层只组合 MapSurface、可选普通 Overlay 与可选独立 Core，不导入透明 interaction。
 * Basemap-only 把两种 visual 都设为 null；未来 Basemap handle 仍与它们共享同一个 map。
 */

import type {CoreOverlayRendererOptions, CoreOverlayRenderResult} from "../../models/core-render.js";
import type {MapSurfaceHandle, OverlayRendererOptions, OverlayRenderResult} from "../../models/leaflet-renderer-models.js";
import {AppError} from "../../utils/app-error.js";
import {renderCoreOverlay} from "../core-render/core-overlay-render.js";
import {createMapSurface, type MapSurfaceOptions} from "./map-surface.js";
import {renderOverlay} from "./overlay-render.js";

/** 共享 Visual runtime 的稳定输入；Interactive 专属配置不进入本层。 */
export interface LeafletVisualRuntimeOptions {
  /** 固定尺寸与初始视口输入。 */
  mapSurface: MapSurfaceOptions;
  /** null 表示当前地图明确跳过 Overlay，而不是渲染失败。 */
  overlay: Omit<OverlayRendererOptions, "map"> | null;
  /** null 表示 Non-core/Basemap-only 或 Core GeoJSON 缺失，不创建 Core pane。 */
  coreOverlay: Omit<CoreOverlayRendererOptions, "map"> | null;
}

/** MapSurface 与可选 Visual 的共同所有权句柄。 */
export interface LeafletVisualRuntimeResult {
  /** 所有后续 basemap、Visual 和可选 Interaction 共用的 Leaflet map。 */
  mapSurface: MapSurfaceHandle;
  /** 已完成首次 measurement 的 Visual；Basemap-only 时为 null。 */
  visualResult: OverlayRenderResult | null;
  /** 独立 Core result；未请求或 GeoJSON 校验跳过时为 null。 */
  coreResult: CoreOverlayRenderResult | null;
  /** 幂等执行普通 Overlay → Core → MapSurface 清理；Interactive 必须先清理自己的命中层。 */
  dispose(): void;
}

/**
 * 创建 MapSurface，并在提供 Overlay 时等待 Visual 完成首次同步测量后返回。
 *
 * 本函数不会创建 Interaction pane 或命中层。任何 Visual 初始化异常都会先回收已创建资源，
 * 避免异步调用方只收到 rejected Promise、却遗留仍监听 Leaflet 事件的 layer。
 */
export async function createLeafletVisualRuntime(options: LeafletVisualRuntimeOptions): Promise<LeafletVisualRuntimeResult> {
  // 视口必须先稳定，Visual 的首次投影与像素测量才有可信的 zoom 和容器尺寸。
  let mapSurface: MapSurfaceHandle;
  try {
    mapSurface = createMapSurface(options.mapSurface);
  } catch (error) {
    throw AppError.fromUnknown(error, "leaflet_init", "Leaflet map initialization failed");
  }
  let visualResult: OverlayRenderResult | null = null;
  let coreResult: CoreOverlayRenderResult | null = null;
  let disposed = false;
  try {
    // null 是显式的 Basemap-only 分支；不要构造空 renderer 来伪装 Overlay。
    if (options.overlay !== null) visualResult = await renderOverlay({...options.overlay, map: mapSurface.map});
    // Core 与普通 Overlay 分别持有结果；GeoJSON 校验跳过时 renderer 正常返回 null。
    if (options.coreOverlay !== null) coreResult = await renderCoreOverlay({...options.coreOverlay, map: mapSurface.map});
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      visualResult?.dispose();
      coreResult?.dispose();
      mapSurface.dispose();
    };
    return Object.freeze({mapSurface, visualResult, coreResult, dispose});
  } catch (error) {
    // 两个 renderer 负责各自半成品；这里负责 runtime 已取得所有权的顶层资源。
    visualResult?.dispose();
    coreResult?.dispose();
    mapSurface.dispose();
    throw AppError.fromUnknown(error, "map_render", "Map visual rendering failed");
  }
}
