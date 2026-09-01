import type {Circle, CircleMarker, Map as LeafletMap, Path, Polyline} from "leaflet";
import type {OverlayInteractionResult} from "../mapsurface/leaflet-renderer-models.js";
import type {
  ActiveMeasurementTargetType,
  MeasureCoordinateType,
  MeasureToolModeType,
  MeasureToolUiStateType,
} from "./measure-tool-models.js";

export type MeasurementGeometryType =
  // Geometry 只保存计算与重建图层所需的原始坐标，不混入显示格式或 Overlay ID。
  | {kind: "line"; coordinates: readonly MeasureCoordinateType[]}
  | {kind: "polygon"; coordinates: readonly MeasureCoordinateType[]}
  | {kind: "circle"; center: MeasureCoordinateType; radiusMeters: number};

/** 每个 Path 顶点复用 Overlay node-default 的外圈与中心点结构。 */
export interface MeasurementVertexLayers {
  outerLayer: CircleMarker;
  centerLayer: CircleMarker;
}

export interface CompletedMeasurementLayers {
  /** 可见主几何；Line/Polygon 的顶点 Node 单独保存在 vertexLayers。 */
  visualLayer: Path;
  vertexLayers: readonly MeasurementVertexLayers[];
  /** 透明交互几何使用独立 SVG renderer，避免整图 Canvas 截断下层 Overlay。 */
  hitLayer: Path;
}

/** Leaflet 细节由 runtime 封装，Controller 只通过该端口管理图层生命周期。 */
export interface MeasurementLayerRuntime {
  createDraftPath(coordinates: readonly MeasureCoordinateType[]): Polyline;
  createDraftPathVertices(coordinates: readonly MeasureCoordinateType[]): readonly MeasurementVertexLayers[];
  createDraftCircle(center: MeasureCoordinateType, radiusMeters: number): Circle;
  createCompletedLayers(geometry: MeasurementGeometryType): CompletedMeasurementLayers;
  setVisualState(layers: Pick<CompletedMeasurementLayers, "visualLayer" | "vertexLayers">, state: "base" | "hover" | "selected"): void;
  /** 返回主几何包围范围右上角，作为 selection 删除按钮的地图锚点。 */
  getVisualNorthEast(layer: Path): MeasureCoordinateType;
  /** 绘制 mode 中只暂停命中，不删除已完成的可见 Geometry。 */
  setCompletedInteractionEnabled(enabled: boolean): void;
  getCompletedInteractionEnabled(): boolean;
  removeVisualLayer(layer: Path): void;
  removeHitLayer(layer: Path): void;
  dispose(): void;
}

export interface MeasureToolControllerOptions {
  /** Map 与 Overlay interaction 都属于 Browser runtime，不得进入 React state。 */
  map: LeafletMap;
  overlayInteraction: OverlayInteractionResult | null;
  previewRefreshIntervalMs: number;
  /** 只在 active target 变化时发布，避免 mousemove 让 MapPage 高频重渲染。 */
  onActiveMeasurementChange?(target: ActiveMeasurementTargetType | null): void;
}

/** React/MapSurface 可调用的最小 Controller 契约，不暴露 Leaflet Layer。 */
export interface MeasureToolController {
  getUiState(): MeasureToolUiStateType;
  subscribe(listener: () => void): () => void;
  setMode(mode: MeasureToolModeType): void;
  clearMeasurementHover(): void;
  clearMeasurementSelection(): void;
  dispose(): void;
}
