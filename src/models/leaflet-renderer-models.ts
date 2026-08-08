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

export type OverlayVisualMeasurementListener = (measurement: OverlayVisualMeasurement) => void;

/**
 * Label 与 Interactive 命中层只通过这个只读接口消费当前视觉测量。
 * 实际状态只保存在 measurement controller 中，不复制到 Visual entry。
 */
export interface OverlayVisualMeasurementSource {
  getMeasurement(featureType: CanvasSpatialFeatureType, featureId: string): OverlayVisualMeasurement;
  subscribe(featureType: CanvasSpatialFeatureType, featureId: string, listener: OverlayVisualMeasurementListener): () => void;
  subscribeBatchComplete(listener: () => void): () => void;
}

/** 固定 Relation 样式和按空间 Feature 反查 relation IDs 的一次性上下文。 */
export interface RelationTranslucentContext {
  membershipStyle: Readonly<CanvasRelationMembershipStyle>;
  byRelationFeatureId: Readonly<Record<string, Readonly<{enabled: true}>>>;
  membershipByFeatureId: Readonly<Record<CanvasSpatialFeatureType, ReadonlyRelationFeatureIdsByFeatureId>>;
}

/**
 * Visual entry 只保存渲染完成后稳定不变的信息。实时视觉尺寸与显隐状态统一由
 * OverlayVisualMeasurementSource 管理，透明命中 Path 则只存在于 Interactive result。
 */
export type OverlayFeatureLayerEntry = {
  [FeatureType in CanvasSpatialFeatureType]: Readonly<{
    featureId: string;
    displayId: string;
    featureType: FeatureType;
    geometry: Extract<LeafletSpatialGeometry, {featureType: FeatureType}>;
    /** 一个 canonical Feature 对应一个 LayerGroup；组内可以跨多个 pane 保存重复绘制。 */
    layer: LayerGroup;
  }>
}[CanvasSpatialFeatureType];

export type OverlayFeatureLayerEntryFor<FeatureType extends CanvasSpatialFeatureType> = Extract<OverlayFeatureLayerEntry, {featureType: FeatureType}>;

export type OverlayFeatureLayerIndex = Readonly<{
  [FeatureType in CanvasSpatialFeatureType]: Readonly<Record<string, OverlayFeatureLayerEntryFor<FeatureType>>>;
}>;

/** Interaction 必须遍历显式有序数组，不能依赖普通对象的枚举顺序决定点击优先级。 */
export type OrderedOverlayFeatureLayers = Readonly<{
  [FeatureType in CanvasSpatialFeatureType]: ReadonlyArray<OverlayFeatureLayerEntryFor<FeatureType>>;
}>;

/** Renderer 构建过程中的可写索引；返回给调用方前会逐层冻结。 */
export interface MutableOverlayFeatureLayerIndex {
  node: Record<string, OverlayFeatureLayerEntryFor<"node">>;
  way: Record<string, OverlayFeatureLayerEntryFor<"way">>;
  area: Record<string, OverlayFeatureLayerEntryFor<"area">>;
}

export interface MutableOrderedOverlayFeatureLayers {
  node: Array<OverlayFeatureLayerEntryFor<"node">>;
  way: Array<OverlayFeatureLayerEntryFor<"way">>;
  area: Array<OverlayFeatureLayerEntryFor<"area">>;
}

export interface OverlayRenderResult {
  /** 只持有视觉 Leaflet layers；Interactive 命中层拥有独立生命周期。 */
  rootLayer: LayerGroup;
  layerIndex: OverlayFeatureLayerIndex;
  orderedLayers: OrderedOverlayFeatureLayers;
  relationContext: RelationTranslucentContext;
  measurementController: OverlayVisualMeasurementSource;
  /** 幂等清理 Visual 监听器、控制器与全部视觉 layers。 */
  dispose(): void;
}

/** Interaction index 只保存 UI 事件桥接需要的稳定 Visual 引用与唯一 hit Path。 */
export interface OverlayInteractionLayerEntry {
  featureId: string;
  featureType: CanvasSpatialFeatureType;
  visualEntry: OverlayFeatureLayerEntry;
  interactionLayer: Path;
}

export type OverlayInteractionLayerIndex = Readonly<Record<CanvasSpatialFeatureType, Readonly<Record<string, OverlayInteractionLayerEntry>>>>;

export interface OverlayInteractionResult {
  rootLayer: LayerGroup;
  layerIndex: OverlayInteractionLayerIndex;
  /** 幂等清理 measurement 订阅、未来 UI listener 与全部透明 hit Paths。 */
  dispose(): void;
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
