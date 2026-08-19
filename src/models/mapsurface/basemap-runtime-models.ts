/** Browser Map Flow、Basemap 与共享 Visual runtime 的模型。 */

import type {AppErrorType, JsonValueType} from "../backend/bridge-models.js";
import type {LeafletConfigType} from "../backend/config-models.js";
import type {ResolvedBasemapType} from "../common/basemap-models.js";
import type {BrowserWarningReporterType} from "../common/browser-warning-models.js";
import type {CoreOverlayRendererOptions, CoreOverlayRenderResult} from "./core-render-models.js";
import type {
  MapSurfaceHandle,
  LeafletMetricScaleResult,
  OverlayInteractionResult,
  OverlayRendererOptions,
  OverlayRenderResult,
} from "./leaflet-renderer-models.js";
import type {MapSurfaceOptions} from "./map-surface-models.js";

/** 单次初始视口瓦片加载失败；该状态不属于 AppError throw 路径。 */
export interface TileRuntimeFailure {
  code: string;
  message: string;
  details: JsonValueType;
}

/** Basemap runtime 只发布初始瓦片自己的终态。 */
export type BasemapRuntimeStatus =
  | {status: "ready"; error: null}
  | {status: "failed"; error: TileRuntimeFailure};

export type MapFlowVisualStatus = "ready" | "skipped";

/** Browser Flow 自己汇总的精简终态；后续 UI/Playwright 发布不属于本层。 */
export interface MapFlowReadySummary {
  status: "ready" | "degraded" | "failed";
  error: AppErrorType | null;
  initial_view: {
    center: [number, number];
    zoom: number;
    bounds: [[number, number], [number, number]];
  };
  basemap: BasemapRuntimeStatus;
  overlay: MapFlowVisualStatus;
  core_overlay: MapFlowVisualStatus;
  /** Reference UI 尚未实现；当前由空 UI 阶段发布 ready 占位。 */
  reference_ui: "ready" | "failed";
}

export interface BasemapRuntimeOptions {
  mapSurface: MapSurfaceHandle;
  basemap: ResolvedBasemapType;
  /** 单块 Proxy 瓦片的请求上限；原始瓦片仍由 Flow ready timeout 统一兜底。 */
  proxyTileTimeoutMs: number;
  /** 长期 warning sink 与一次性 ready status 分离；Snapshot 或未接通通道时可以省略。 */
  warningReporter?: BrowserWarningReporterType;
}

/** 共享 Visual runtime 的稳定输入；Interactive 专属配置不进入本层。 */
export interface LeafletVisualRuntimeOptions {
  /** 由 Browser Flow 创建并持有；本层只借用其中的 Leaflet map。 */
  mapSurface: MapSurfaceHandle;
  /** null 表示当前地图明确跳过 Overlay，而不是渲染失败。 */
  overlay: Omit<OverlayRendererOptions, "map"> | null;
  /** null 表示 Non-core/Basemap-only 或 Core GeoJSON 缺失，不创建 Core pane。 */
  coreOverlay: Omit<CoreOverlayRendererOptions, "map"> | null;
}

/** 可选 Visual 的共同所有权句柄，不拥有 MapSurface。 */
export interface LeafletVisualRuntimeResult {
  /** 已完成首次 measurement 的 Visual；Basemap-only 时为 null。 */
  visualResult: OverlayRenderResult | null;
  /** 独立 Core result；未请求或 GeoJSON 校验跳过时为 null。 */
  coreResult: CoreOverlayRenderResult | null;
  /** 幂等执行普通 Overlay → Core 清理；不会清理借用的 MapSurface。 */
  dispose(): void;
}

export interface InteractiveMapFlowOptions extends Omit<LeafletVisualRuntimeOptions, "mapSurface"> {
  /** Browser Flow 用于创建唯一 MapSurface 的固定尺寸与初始视口输入。 */
  mapSurface: MapSurfaceOptions;
  /** Node 已解析并写入 Browser payload 的底图 profile 快照。 */
  basemap: ResolvedBasemapType;
  /** app.yaml browser_map.ready_timeout_seconds 转换后的毫秒值。 */
  readyTimeoutMs: number;
  /** app.yaml browser_map.proxy_tile_timeout_seconds 转换后的毫秒值。 */
  proxyTileTimeoutMs: number;
  /** app.yaml ui.max_scale_width_px；只参与返回给 UI 的公制 Scale 计算。 */
  metricScaleMaxWidthPx: number;
  /** 仅供透明命中层使用；Visual runtime 不读取交互配置。 */
  interactionConfig: LeafletConfigType["interaction"];
  /** 页面生命周期级 warning sink；不参与 ready summary 或 AppError throw。 */
  warningReporter?: BrowserWarningReporterType;
}

/** Interactive 入口持有共享 Visual 结果，以及后挂载的透明命中层。 */
export interface InteractiveMapFlowResult extends LeafletVisualRuntimeResult {
  /** Basemap、Visual 与 Interaction 共用的唯一 MapSurface。 */
  mapSurface: MapSurfaceHandle;
  /** 初始视口瓦片自己的 ready/failed 终态；失败不转换成 AppError。 */
  basemapStatus: BasemapRuntimeStatus;
  /** 不包含 Leaflet runtime 对象的当前 Flow 汇总。 */
  readySummary: MapFlowReadySummary;
  /** 仅交给 Browser UI 的初始公制 Scale 数据，不进入 readySummary。 */
  metricScale: LeafletMetricScaleResult;
  /** Basemap-only 或没有 Overlay 时为 null，不表示初始化失败。 */
  interactionResult: OverlayInteractionResult | null;
  /** 幂等执行 Interaction → Visual → MapSurface 清理。 */
  dispose(): void;
}

/** Snapshot 不附加交互状态，但负责创建并持有唯一 MapSurface。 */
export interface SnapshotMapFlowOptions extends Omit<LeafletVisualRuntimeOptions, "mapSurface"> {
  /** Browser Flow 用于创建唯一 MapSurface 的固定尺寸与初始视口输入。 */
  mapSurface: MapSurfaceOptions;
  /** Node 已解析并写入 Browser payload 的底图 profile 快照。 */
  basemap: ResolvedBasemapType;
  /** app.yaml browser_map.ready_timeout_seconds 转换后的毫秒值。 */
  readyTimeoutMs: number;
  /** app.yaml browser_map.proxy_tile_timeout_seconds 转换后的毫秒值。 */
  proxyTileTimeoutMs: number;
  /** app.yaml ui.max_scale_width_px；只参与返回给 UI 的公制 Scale 计算。 */
  metricScaleMaxWidthPx: number;
}

/** Snapshot 返回自己持有的 MapSurface 与借助共享 runtime 创建的 Visual。 */
export interface SnapshotMapFlowResult extends LeafletVisualRuntimeResult {
  mapSurface: MapSurfaceHandle;
  /** 初始视口瓦片自己的 ready/failed 终态；失败不转换成 AppError。 */
  basemapStatus: BasemapRuntimeStatus;
  /** 不包含 Leaflet runtime 对象的当前 Flow 汇总。 */
  readySummary: MapFlowReadySummary;
  /** 仅交给 Browser UI 的初始公制 Scale 数据，不进入 readySummary。 */
  metricScale: LeafletMetricScaleResult;
  /** 幂等执行 Visual → MapSurface 清理。 */
  dispose(): void;
}
