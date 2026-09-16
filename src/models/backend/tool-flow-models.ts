/**
 * Node Tool Flow 的编排模型。
 *
 * 本文件只定义 Python reply 后处理、地图模式分发与最终 Node 返回值使用的数据结构。它不执行
 * enrichment、模式选择或 schema 校验，也不让共享 Browser payload 反向依赖业务函数。
 */

import type {LatLngBoundsLiteral} from "leaflet";
import type {PyToolReqType, ToolType, VisualOutputType} from "./bridge-models.js";
import type {LeafletConfigType} from "./config-models.js";
import type {
  AiOutputGroupsWithIdsType,
  DisplayIdByFeatureIdType,
  EffectiveQueryModeType,
  IdentifiedOverlayGroupsWithDisplayIdType,
  RelationMemberFeaturesByRelationType,
  RelationMembershipByFeatureIdType,
} from "./map-data-models.js";
import type {
  BasemapOnlyMapPayloadType,
  CoreMapPayloadType,
  NonCoreMapPayloadType,
} from "../mapsurface/map-payload-models.js";
import type {InteractiveMapArchiveType} from "./map-session-models.js";
import type {InteractiveMapDataType} from "../web/interactive-ui-models.js";
import type {SnapshotMapDataType} from "../web/snapshot-ui-models.js";

/** processToolReply() 生成的公共数据结果；样式与具体 render_mode 不进入该阶段。 */
export interface ProcessedToolReplyType {
  session_id: string;
  effective_query_mode: EffectiveQueryModeType;
  ai_output: AiOutputGroupsWithIdsType | null;
  overlay_output: IdentifiedOverlayGroupsWithDisplayIdType | null;
  display_id_by_feature_id: DisplayIdByFeatureIdType | null;
  relation_member_features_by_relation: RelationMemberFeaturesByRelationType | null;
  relation_membership_by_feature_id: RelationMembershipByFeatureIdType | null;
  /** MapSurface 的 [width, height] CSS 逻辑像素。 */
  screenshot_size: [number, number];
  /** Node 根据权威 bbox 计算的 [latitude, longitude]。 */
  center: [number, number];
  /** process 阶段保留 Leaflet 宽类型，发布前再由 mapSurfacePayloadSchema 收窄为双角 tuple。 */
  leaflet_bbox: LatLngBoundsLiteral;
  leaflet: LeafletConfigType;
  info: string;
}

/** 三种地图 builder 共用且已经收窄的 MapSurface、底图与 Leaflet 配置。 */
export type CommonMapPayloadFields = Pick<
  BasemapOnlyMapPayloadType,
  "basemap" | "screenshot_size" | "center" | "leaflet_bbox" | "leaflet"
>;

/** 唯一地图模式 switch 的完整输入，不使用业务函数 ReturnType 建立反向依赖。 */
export interface MapModeSwitchInput {
  requestedTool: ToolType;
  effectiveQueryMode: EffectiveQueryModeType;
  selectedCandidate: PyToolReqType["selected_candidate"];
  processed: ProcessedToolReplyType;
  commonMapFields: CommonMapPayloadFields;
}

/** Core builder 保留普通 Overlay 必需字段，并携带地点确认阶段的可空原始 GeoJSON。 */
export type CoreFlowInput = Omit<
  CoreMapPayloadType,
  "render_mode" | "overlay_output" | "relation_member_features_by_relation"
> & {
  overlay_output: IdentifiedOverlayGroupsWithDisplayIdType | null;
  relation_member_features_by_relation: RelationMemberFeaturesByRelationType | null;
};

/** Non-core builder 接受公共 nullable 数据形态，并由最终 Non-core schema 收口必需字段。 */
export type NonCoreFlowInput = Omit<
  NonCoreMapPayloadType,
  "render_mode" | "core_visual" | "overlay_output" | "relation_member_features_by_relation"
> & {
  overlay_output: IdentifiedOverlayGroupsWithDisplayIdType | null;
  relation_member_features_by_relation: RelationMemberFeaturesByRelationType | null;
};

/** Basemap-only builder 只接收三种地图模式真正共用的字段。 */
export type BasemapOnlyFlowInput = CommonMapPayloadFields;

/** runToolFlow() 返回的 Node 数据、Archive 与两种严格 Browser runtime。 */
export type RunToolFlowResultType = Readonly<{
  session_id: string;
  /** 原样透传 Tool 输入，供后续发布层选择 AI-facing 视觉 URL。 */
  visual_output: VisualOutputType;
  effective_query_mode: EffectiveQueryModeType;
  ai_output: AiOutputGroupsWithIdsType | null;
  display_id_by_feature_id: DisplayIdByFeatureIdType | null;
  relation_membership_by_feature_id: RelationMembershipByFeatureIdType | null;
  selected_location_name: string | null;
  /** 文件层只保存这份纯数据 Archive；Browser runtime 由当前配置另行组装。 */
  interactive_archive: InteractiveMapArchiveType;
  interactive_runtime: InteractiveMapDataType;
  snapshot_runtime: SnapshotMapDataType;
  info: string;
}>;
