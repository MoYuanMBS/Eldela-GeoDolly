import type {Canvas, Circle, CircleMarker, Layer, Map as LeafletMap, Marker, Path, Polyline} from "leaflet";
import type {OverlayInteractionResult} from "../mapsurface/leaflet-renderer-models.js";
import type {
  ActiveMeasurementTargetType,
  MeasureCoordinateType,
  MeasureToolModeType,
  MeasureToolUiStateType,
} from "./measure-tool-models.js";

/** Leaflet 类型未公开的重绘字段；仅供测量 Canvas 生命周期适配使用，不向 UI 暴露。 */
export interface MeasurementCanvasInternals {
  _map?: LeafletMap | null;
  _ctx?: CanvasRenderingContext2D | null;
  _container?: HTMLCanvasElement;
  _redrawRequest?: number | null;
  _redraw(this: Canvas): void;
}

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

/** Path draft 的主线与数值标注必须同步更新，避免高频 preview 产生遗留 Marker。 */
export interface MeasurementDraftPathLayers {
  pathLayer: Polyline;
  labelLayer: Marker;
}

/** Circle 的外框、内侧带、水平半径线与数值标注作为一个视觉对象管理。 */
export interface MeasurementCircleVisualLayers {
  outlineLayer: Circle;
  innerBandLayer: Circle;
  radiusLayer: Polyline;
  labelLayer: Marker;
}

export interface CompletedMeasurementLayers {
  /** 可见主几何；内侧带、半径线、数值标签与顶点分别保存以便整体清理。 */
  visualLayer: Path;
  innerBandLayer: Path | null;
  radiusLayer: Polyline | null;
  labelLayer: Marker;
  vertexLayers: readonly MeasurementVertexLayers[];
  /** 透明交互几何使用独立 SVG renderer，避免整图 Canvas 截断下层 Overlay。 */
  hitLayer: Path;
}

/** Leaflet 细节由 runtime 封装，Controller 只通过该端口管理图层生命周期。 */
export interface MeasurementLayerRuntime {
  createDraftPath(coordinates: readonly MeasureCoordinateType[], lengthMeters: number): MeasurementDraftPathLayers;
  updateDraftPath(layers: MeasurementDraftPathLayers, coordinates: readonly MeasureCoordinateType[], lengthMeters: number): void;
  createDraftPathVertices(coordinates: readonly MeasureCoordinateType[]): readonly MeasurementVertexLayers[];
  createDraftCircle(center: MeasureCoordinateType, radiusMeters: number): MeasurementCircleVisualLayers;
  updateDraftCircle(layers: MeasurementCircleVisualLayers, radiusMeters: number): void;
  createCompletedLayers(geometry: MeasurementGeometryType, labelMeters: number): CompletedMeasurementLayers;
  setVisualState(layers: Pick<CompletedMeasurementLayers, "visualLayer" | "radiusLayer" | "vertexLayers">, state: "base" | "hover" | "selected"): void;
  /** 返回主几何右上方附近的实际边界点，不把包围盒角当作图形边界。 */
  getDeleteAnchor(layer: Path): MeasureCoordinateType;
  /** 绘制 mode 中只暂停命中，不删除已完成的可见 Geometry。 */
  setCompletedInteractionEnabled(enabled: boolean): void;
  getCompletedInteractionEnabled(): boolean;
  removeVisualLayer(layer: Layer): void;
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
