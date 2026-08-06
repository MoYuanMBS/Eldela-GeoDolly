/** Leaflet Overlay renderer 的浏览器运行时模型；不进入 Bridge 或 session 序列化。 */

import type {LatLngTuple, LayerGroup, Map as LeafletMap} from "leaflet";
import type {IdentifiedOverlayGroupsWithDisplayIdType, RelationMemberFeaturesByRelationType} from "./map-data-models.js";
import type {CanvasRelationMembershipStyle, CanvasSpatialFeatureType} from "./style/base-canvas-style.js";
import type {RuntimeStylePlan} from "./style/runtime-style-models.js";

export type ReadonlyRelationFeatureIdsByFeatureId = Readonly<Record<string, ReadonlyArray<string>>>;

export type LeafletSpatialGeometry =
  | Readonly<{featureType: "node"; center: LatLngTuple}>
  | Readonly<{featureType: "way"; latLngs: Array<LatLngTuple> | Array<Array<LatLngTuple>>}>
  | Readonly<{featureType: "area"; latLngs: Array<Array<LatLngTuple>> | Array<Array<Array<LatLngTuple>>>}>;

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
}

export type OverlayFeatureLayerIndex = Readonly<Record<CanvasSpatialFeatureType, Readonly<Record<string, OverlayFeatureLayerEntry>>>>;

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
  /** 后端 center[1]；连续世界适配只使用经度。 */
  centerLongitude: number;
  signal?: AbortSignal;
}
