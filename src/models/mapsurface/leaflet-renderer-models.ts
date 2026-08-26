/** Leaflet Overlay renderer 的浏览器运行时模型；不进入 Bridge 或 session 序列化。 */

import type {LatLng, LatLngBounds, LatLngTuple, LayerGroup, Map as LeafletMap, Path, Point, Renderer} from "leaflet";
import type {LeafletConfigType} from "../backend/config-models.js";
import type {IdentifiedOverlayGroupsWithDisplayIdType, RelationMemberFeaturesByRelationType} from "../backend/map-data-models.js";
import type {CanvasRelationMembershipStyle, CanvasSpatialFeatureType} from "./style/base-canvas-style.js";
import type {RuntimeStylePlan} from "./style/runtime-style-models.js";

export type ReadonlyRelationFeatureIdsByFeatureId = Readonly<Record<string, ReadonlyArray<string>>>;

export type OverlayBasePaneName = "areaBase" | "wayBase" | "nodeBase";
export type OverlaySpecialPaneName = "areaSpecial" | "waySpecial" | "nodeSpecial";

/** Overlay Visual 只接收自己负责的部署配置，不能读取 interaction 容错参数。 */
export type OverlayVisualConfig = Readonly<Pick<
  LeafletConfigType,
  "render_batch_size" | "node_zoom" | "relation_membership" | "visual_limits"
>>;

/**
 * MapSurface 对外保留输入请求与 Leaflet 实际采用的初始视口，两者不能混用。
 * 所有字段都是初始化完成时的快照；后续拖动和缩放只改变 map 当前状态。
 */
export interface MapSurfaceHandle {
  /** 已完成初始 setView、供所有地图层共享的 Leaflet 实例。 */
  map: LeafletMap;
  /** 上游请求的 bbox；用于记录输入，不能当作 Leaflet 最终可见范围。 */
  requestedLeafletBounds: LatLngBounds;
  /** 首次 setView 后 Leaflet 实际采用的中心快照。 */
  initialCenter: LatLng;
  /** 根据请求 bbox、padding 与逻辑尺寸计算出的初始整数 zoom。 */
  initialZoom: number;
  /** 首次 setView 后的实际可见范围，可能因屏幕宽高比大于请求 bbox。 */
  initialViewBounds: LatLngBounds;
  /** Leaflet 初始化时读取的 CSS 逻辑像素，不包含 DPR 放大。 */
  logicalSize: Point;
  /** 幂等移除 Leaflet map 及其 DOM/event 生命周期。 */
  dispose(): void;
}

/** Leaflet 公制 Scale 算法的当前结果；只供 Browser UI 使用，不进入 ready summary。 */
export interface LeafletMetricScaleResult {
  label: string;
  distanceMeters: number;
  widthPx: number;
}

/** 每个 Feature 类型在 Base/Special pane 中各自保留 Canvas 与 SVG 两条绘制路径。 */
export interface OverlayFeatureRenderers {
  /** Base pane 中执行 Canvas recipe 的 renderer。 */
  baseCanvas: Renderer;
  /** Base pane 中承载 CSS class 的 SVG renderer。 */
  baseSvg: Renderer;
  /** Special pane 中执行 border/translucent Canvas recipe 的 renderer。 */
  specialCanvas: Renderer;
  /** Special pane 中承载 border/translucent CSS class 的 SVG renderer。 */
  specialSvg: Renderer;
}

/** Relation Area 内带需要在普通 Leaflet Renderer 之外暴露一次裁切注册。 */
export type OverlayRelationMembershipRenderer = Renderer & {
  registerInnerBand(layer: Path): void;
};

/** Overlay 一次渲染生命周期内共享的 renderer 集合；不会跨地图复用。 */
export interface OverlayRendererCollection {
  /** 各 Feature 类型独立 renderer，保持 Area → Way → Node 的视觉层级。 */
  node: OverlayFeatureRenderers;
  way: OverlayFeatureRenderers;
  area: OverlayFeatureRenderers;
  /** 专门裁切 Area 内带的 Relation renderer。 */
  relationMembership: OverlayRelationMembershipRenderer;
  /** 只记录真正产生 Path 的 renderer，避免挂载空 Canvas/SVG 容器。 */
  activated: Set<Renderer>;
}

export type LeafletSpatialGeometry =
  | Readonly<{featureType: "node"; center: LatLngTuple}>
  | Readonly<{featureType: "way"; latLngs: Array<LatLngTuple> | Array<Array<LatLngTuple>>}>
  | Readonly<{featureType: "area"; latLngs: Array<Array<LatLngTuple>> | Array<Array<Array<LatLngTuple>>>}>;

/** MultiPoint 保持多个独立点，不把它们错误折叠成一条 Node geometry。 */
export type LeafletMultiPointGeometry = Readonly<{featureType: "multiPoint"; centers: Array<LatLngTuple>}>;
export type LeafletGeoJsonGeometry = LeafletSpatialGeometry | LeafletMultiPointGeometry;

/** 单 Canvas Label layer 使用的轻量候选；geometry 已经展开到连续世界。 */
export interface OverlayLabelCandidate {
  featureId: string;
  displayId: string;
  nameText?: string;
  geometry: LeafletSpatialGeometry;
}

/** 一条视觉 Path 对命中层贡献的可见状态与最外屏幕尺寸。 */
export interface OverlayVisualMeasurement {
  /** 合并该 Feature 全部视觉 Path 后，当前是否至少存在一种实际可见绘制。 */
  hasVisiblePaint: boolean;
  /** Node 为最外半径、Way 为最宽线宽、Area 为边缘描边宽度，单位均为 CSS px。 */
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
  /** 读取最新测量；首次同步尚未完成或 Feature 未注册时会抛错。 */
  getMeasurement(featureType: CanvasSpatialFeatureType, featureId: string): OverlayVisualMeasurement;
  /** 订阅单个 Feature 的实际变化；返回的取消订阅函数可幂等调用。 */
  subscribe(featureType: CanvasSpatialFeatureType, featureId: string, listener: OverlayVisualMeasurementListener): () => void;
  /** 每批 Feature 更新全部发布后触发，供 Interaction 做一次全局顺序归一化。 */
  subscribeBatchComplete(listener: () => void): () => void;
}

/** 固定 Relation 样式和按空间 Feature 反查 relation IDs 的一次性上下文。 */
export interface RelationTranslucentContext {
  /** 固定 Relation 半透明颜色与 opacity；用户规则不能覆盖。 */
  membershipStyle: Readonly<CanvasRelationMembershipStyle>;
  /** 本次 Overlay 中可以参与附加绘制的 relation feature_id 集合。 */
  byRelationFeatureId: Readonly<Record<string, Readonly<{enabled: true}>>>;
  /** 按 Feature 类型和 feature_id 反查 relation IDs，避免渲染时反复遍历 relation 字典。 */
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
  /** 按 type + feature_id 查找稳定 Visual entry，供 UI 定位具体 Feature。 */
  layerIndex: OverlayFeatureLayerIndex;
  /** 保留原 Overlay 次序的分类型数组，Interaction 不依赖对象枚举顺序。 */
  orderedLayers: OrderedOverlayFeatureLayers;
  /** 本次渲染预解析且冻结的 Relation 附加绘制上下文。 */
  relationContext: RelationTranslucentContext;
  /** zoom/resize 后仍持续更新的唯一视觉测量状态源。 */
  measurementController: OverlayVisualMeasurementSource;
  /** 幂等清理 Visual 监听器、控制器与全部视觉 layers。 */
  dispose(): void;
}

/** Interaction index 只保存 UI 事件桥接需要的稳定 Visual 引用与唯一 hit Path。 */
export interface OverlayInteractionLayerEntry {
  /** canonical ID 只在同一 featureType 内唯一。 */
  featureId: string;
  featureType: CanvasSpatialFeatureType;
  /** Visual 引用只供地图 runtime 同步命中 geometry，不作为 UI 展示数据源。 */
  visualEntry: OverlayFeatureLayerEntry;
  /** 唯一透明命中 Path；不携带业务 hover/click 状态。 */
  interactionLayer: Path;
}

export type OverlayInteractionLayerIndex = Readonly<Record<CanvasSpatialFeatureType, Readonly<Record<string, OverlayInteractionLayerEntry>>>>;

/** Interaction 向 React 发布的纯数据 target；不携带 Leaflet layer 或事件对象。 */
export interface OverlayInteractionTarget {
  featureType: CanvasSpatialFeatureType;
  featureId: string;
}

export interface OverlayInteractionHandlers {
  onHoverChange(target: OverlayInteractionTarget | null): void;
  onSelectionChange(target: OverlayInteractionTarget | null): void;
}

export interface OverlayInteractionResult {
  /** 持有唯一 Interaction renderer 与当前可见的透明 hit Paths。 */
  rootLayer: LayerGroup;
  /** UI 层按 type + feature_id 绑定事件的稳定入口。 */
  layerIndex: OverlayInteractionLayerIndex;
  /** UI close button 与地图空白点击共用同一个 selection 清理入口。 */
  clearSelection(): void;
  /** 幂等清理 measurement 订阅、未来 UI listener 与全部透明 hit Paths。 */
  dispose(): void;
}

/** Interaction attach 只接收已有 Visual 结果和自己的命中容错配置。 */
export interface AttachOverlayInteractionOptions {
  /** 与 Visual 共用、且仍处于活动生命周期的 Leaflet map。 */
  map: LeafletMap;
  /** 已完成首次 measurement 的 Visual；本层不会重新解析 Feature。 */
  visualResult: OverlayRenderResult;
  /** 仅影响透明命中半径/宽度，不参与可见绘制。 */
  config: LeafletConfigType["interaction"];
  /** 可选 UI 事件出口；Snapshot 不接收也不构造该回调。 */
  handlers?: OverlayInteractionHandlers;
}

export interface OverlayRendererOptions {
  /** 已由 MapSurface 初始化完成的共享 Leaflet map。 */
  map: LeafletMap;
  /** 已补齐 feature_id/display_id 的 canonical Overlay 数据。 */
  overlayOutput: IdentifiedOverlayGroupsWithDisplayIdType;
  /** 仅用于一次性建立 Relation 半透明反查上下文。 */
  relationMemberFeaturesByRelation: RelationMemberFeaturesByRelationType;
  /** 浏览器初始化阶段已经编译、合并并建立索引的只读样式计划。 */
  stylePlan: RuntimeStylePlan;
  /** Node 启动时已校验，并从完整 Leaflet payload 中提取的 Visual 配置。 */
  visualConfig: OverlayVisualConfig;
  /** 后端 center[1]；连续世界适配只使用经度。 */
  centerLongitude: number;
  /** 上层卸载或切换数据时中断分批渲染，不改变已处理 Feature 的语义。 */
  signal?: AbortSignal;
}
