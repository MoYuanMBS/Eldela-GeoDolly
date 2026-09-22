/** Browser Map Flow、Basemap 与共享 Visual runtime 的模型。 */

import type {AppErrorType} from "../common/error-models.js";
import type {JsonValueType} from "../common/json-models.js";
import type {LeafletConfigType} from "./map-config-models.js";
import type {ResolvedBasemapType} from "../common/basemap-models.js";
import type {BrowserWarningReporterType} from "../common/browser-warning-models.js";
import type {CoreOverlayRendererOptions, CoreOverlayRenderResult} from "./core-render-models.js";
import type {
  MapSurfaceHandle,
  LeafletMetricScaleResult,
  OverlayInteractionHandlers,
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

/** Leaflet Map Flow 汇总的精简终态；页面级 UI/Playwright 发布不属于本层。 */
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
}

/** 页面级 Browser Flow 在地图 runtime 与 Reference UI 都完成后发布的可序列化终态。 */
export interface BrowserFlowReadySummary extends MapFlowReadySummary {
  reference_ui: "ready";
  measured_reference_ui_height: number;
}

export interface BasemapRuntimeOptions {
  mapSurface: MapSurfaceHandle;
  basemap: ResolvedBasemapType;
  /** 长期 warning sink 与一次性 ready status 分离；未接通诊断通道时可以省略。 */
  warningReporter?: BrowserWarningReporterType;
}

/** Snapshot 固定首屏独有的瓦片统计，不进入共享 BasemapRuntimeStatus。 */
export interface SnapshotInitialTileSummary {
  success_count: number;
  total_count: number;
  success_ratio: number;
  required_ratio: number;
}

export interface SnapshotBasemapRuntimeOptions extends BasemapRuntimeOptions {
  minimumInitialTileSuccessRatio: number;
  /** 只消费上层 Snapshot Flow 持有的取消/超时 signal，不建立第二个总计时器。 */
  signal: AbortSignal;
}

export interface SnapshotBasemapRuntimeResult {
  status: BasemapRuntimeStatus;
  initialTiles: SnapshotInitialTileSummary;
}

export interface SnapshotSpatialRenderCounts {
  node: number;
  way: number;
  area: number;
}

export interface SnapshotRenderedFeatureCounts {
  overlay: SnapshotSpatialRenderCounts;
  core: SnapshotSpatialRenderCounts;
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
  /** app.yaml ui.max_scale_width_px；只参与返回给 UI 的公制 Scale 计算。 */
  metricScaleMaxWidthPx: number;
  /** 仅供透明命中层使用；Visual runtime 不读取交互配置。 */
  interactionConfig: LeafletConfigType["interaction"];
  /** hover/click 只通过纯数据回调进入 React，不把 Leaflet 对象带出 runtime。 */
  interactionHandlers?: OverlayInteractionHandlers;
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
export interface SnapshotMapFlowOptions extends Omit<LeafletVisualRuntimeOptions, "mapSurface" | "overlay" | "coreOverlay"> {
  /** Browser Flow 用于创建唯一 MapSurface 的固定尺寸与初始视口输入。 */
  mapSurface: MapSurfaceOptions;
  /** Node 已解析并写入 Browser payload 的底图 profile 快照。 */
  basemap: ResolvedBasemapType;
  /** app.yaml browser_map.ready_timeout_seconds 转换后的毫秒值。 */
  readyTimeoutMs: number;
  /** app.yaml basemap.snapshot_min_tile_success_ratio。 */
  minimumInitialTileSuccessRatio: number;
  /** app.yaml ui.max_scale_width_px；只参与返回给 UI 的公制 Scale 计算。 */
  metricScaleMaxWidthPx: number;
  /** 页面生命周期取消由 Snapshot Flow 合并进自己持有的唯一 timeout signal。 */
  signal: AbortSignal;
  /** Snapshot Basemap 诊断通过独立通道返回 Node logger，不混入 ready summary。 */
  warningReporter?: BrowserWarningReporterType;
  /** Snapshot 子流程不能各带取消源，全部消费 Flow 合并后的同一个 signal。 */
  overlay: Omit<OverlayRendererOptions, "map" | "signal"> | null;
  coreOverlay: Omit<CoreOverlayRendererOptions, "map" | "signal"> | null;
}

/** Snapshot 返回自己持有的 MapSurface 与借助共享 runtime 创建的 Visual。 */
export interface SnapshotMapFlowResult extends LeafletVisualRuntimeResult {
  mapSurface: MapSurfaceHandle;
  /** 初始视口瓦片自己的 ready/failed 终态；失败不转换成 AppError。 */
  basemapStatus: BasemapRuntimeStatus;
  /** 不包含 Leaflet runtime 对象的当前 Flow 汇总。 */
  readySummary: MapFlowReadySummary;
  /** 仅交给 Browser UI 的初始公制 Scale 数据，不进入 readySummary。 */
  /** null 是允许发布的 Scale omitted 终态，由页面记录 warning 后隐藏对应 UI。 */
  metricScale: LeafletMetricScaleResult | null;
  /** Snapshot 专属首屏统计，与共享 Basemap contract 分离。 */
  initialTiles: SnapshotInitialTileSummary;
  /** renderer 实际创建的空间对象数；不同视觉 pass 不重复计数。 */
  renderedFeatureCounts: SnapshotRenderedFeatureCounts;
  /** 幂等执行 Visual → MapSurface 清理。 */
  dispose(): void;
}
