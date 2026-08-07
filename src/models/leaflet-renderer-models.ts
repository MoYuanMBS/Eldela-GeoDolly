/** Leaflet Overlay renderer 的浏览器运行时模型；不进入 Bridge 或 session 序列化。 */

import type {LatLngTuple, LayerGroup, Map as LeafletMap, Path, Renderer} from "leaflet";
import type {LeafletConfigType} from "./config-models.js";
import type {IdentifiedOverlayGroupsWithDisplayIdType, RelationMemberFeaturesByRelationType} from "./map-data-models.js";
import type {CanvasRelationMembershipStyle, CanvasSpatialFeatureType} from "./style/base-canvas-style.js";
import type {RuntimeStylePlan} from "./style/runtime-style-models.js";

export type ReadonlyRelationFeatureIdsByFeatureId = Readonly<Record<string, ReadonlyArray<string>>>;

export type OverlayBasePaneName = "areaBase" | "wayBase" | "nodeBase";
export type OverlaySpecialPaneName = "areaSpecial" | "waySpecial" | "nodeSpecial";

/** 每个 Feature 类型在 Base/Special pane 中各自保留 Canvas 与 SVG 两条绘制路径。 */
export interface OverlayFeatureRenderers {
  baseCanvas: Renderer;
  baseSvg: Renderer;
  specialCanvas: Renderer;
  specialSvg: Renderer;
}

/** Relation Area 内带需要在普通 Leaflet Renderer 之外暴露一次裁切注册。 */
export type OverlayRelationMembershipRenderer = Renderer & {
  registerInnerBand(layer: Path): void;
};

/** Overlay 一次渲染生命周期内共享的 renderer 集合；不会跨地图复用。 */
export interface OverlayRendererCollection {
  node: OverlayFeatureRenderers;
  way: OverlayFeatureRenderers;
  area: OverlayFeatureRenderers;
  relationMembership: OverlayRelationMembershipRenderer;
  interaction: Renderer;
  activated: Set<Renderer>;
}

export type LeafletSpatialGeometry =
  | Readonly<{featureType: "node"; center: LatLngTuple}>
  | Readonly<{featureType: "way"; latLngs: Array<LatLngTuple> | Array<Array<LatLngTuple>>}>
  | Readonly<{featureType: "area"; latLngs: Array<Array<LatLngTuple>> | Array<Array<Array<LatLngTuple>>>}>;

/** 单 Canvas Label layer 使用的轻量候选；geometry 已经展开到连续世界。 */
export interface OverlayLabelCandidate {
  featureId: string;
  displayId: string;
  nameText?: string;
  geometry: LeafletSpatialGeometry;
}

/** 一条视觉 Path 对命中层贡献的可见状态与最外屏幕尺寸。 */
export interface OverlayVisualMeasurement {
  hasVisiblePaint: boolean;
  visualSizePx: number;
}

/**
 * CSS 只提供 presentation 状态；Node radius 始终在每次同步时从 Leaflet CircleMarker 读取。
 * 该结构可以在 SVG 暂时卸载时缓存，不会把上一个 zoom 的 geometry 半径一并冻结。
 */
export interface OverlayCssPresentationMeasurement {
  fillVisible: boolean;
  strokeVisible: boolean;
  strokeWidthPx: number;
}

/** 一个空间 Feature 的视觉层与唯一透明命中层之间的运行时关联。 */
export interface OverlayInteractionRegistration {
  featureId: string;
  featureType: CanvasSpatialFeatureType;
  featureLayer: LayerGroup;
  visualLayers: ReadonlyArray<Path>;
  cssLayers: ReadonlySet<Path>;
  interactionLayer: Path;
  onVisualMeasurementChange: (measurement: OverlayVisualMeasurement) => void;
}

export interface MeasuredOverlayInteraction {
  registration: OverlayInteractionRegistration;
  measurement: OverlayVisualMeasurement;
}

/** 固定 Relation 样式和按空间 Feature 反查 relation IDs 的一次性上下文。 */
export interface RelationTranslucentContext {
  membershipStyle: Readonly<CanvasRelationMembershipStyle>;
  byRelationFeatureId: Readonly<Record<string, Readonly<{enabled: true}>>>;
  membershipByFeatureId: Readonly<Record<CanvasSpatialFeatureType, ReadonlyRelationFeatureIdsByFeatureId>>;
}

/** 一个 canonical Feature 对应一个 LayerGroup；组内可以跨多个 pane 保存重复绘制。 */
export interface OverlayFeatureLayerEntry {
  featureId: string;
  displayId: string;
  layer: LayerGroup;
  /** 后续 hover/click 只绑定这一层；Feature 无可见像素时引用保留，但 Path 会从 layer 暂时移除。 */
  interactionLayer: Path;
}

export type OverlayFeatureLayerIndex = Readonly<Record<CanvasSpatialFeatureType, Readonly<Record<string, OverlayFeatureLayerEntry>>>>;

/** Renderer 构建过程中的可写索引；返回给调用方前会逐层冻结。 */
export interface MutableOverlayFeatureLayerIndex {
  node: Record<string, OverlayFeatureLayerEntry>;
  way: Record<string, OverlayFeatureLayerEntry>;
  area: Record<string, OverlayFeatureLayerEntry>;
}

export interface OverlayRenderResult {
  /** 清理整批 Overlay 时只需移除这个根组。 */
  rootLayer: LayerGroup;
  layerIndex: OverlayFeatureLayerIndex;
  relationContext: RelationTranslucentContext;
}

export interface OverlayRendererOptions {
  map: LeafletMap;
  overlayOutput: IdentifiedOverlayGroupsWithDisplayIdType;
  relationMemberFeaturesByRelation: RelationMemberFeaturesByRelationType;
  stylePlan: RuntimeStylePlan;
  /** Node 启动时已校验并随当前地图 payload 固定下来的 Leaflet renderer 配置。 */
  leafletConfig: LeafletConfigType;
  /** 后端 center[1]；连续世界适配只使用经度。 */
  centerLongitude: number;
  signal?: AbortSignal;
}
