/**
 * Node Tool Flow 的编排模型。
 *
 * 本文件只定义 Python reply 后处理、地图模式分发与最终 Node 返回值使用的数据结构。它不执行
 * enrichment、模式选择或 schema 校验，也不让共享 Browser payload 反向依赖业务函数。
 */

import type {LatLngBoundsLiteral} from "leaflet";
import type {
  AiToolInputReqType,
  LocSearchReplyRawType,
  PyToolReplyType,
  PyToolReqType,
  VisualOutputType,
} from "./bridge-models.js";
import type {ResolvedBasemapType} from "../common/basemap-models.js";
import type {LeafletConfigType} from "./config-models.js";
import type {
  AiOutputGroupsWithIdsType,
  DisplayIdByFeatureIdType,
  EffectiveQueryModeType,
  IdentifiedOverlayGroupsWithDisplayIdType,
  RelationMemberFeaturesByRelationType,
  RelationMembershipByFeatureIdType,
} from "../common/map-data-models.js";
import type {
  BasemapOnlyMapPayloadType,
  CoreMapPayloadType,
  MapRenderModeType,
  NonCoreMapPayloadType,
} from "../mapsurface/map-payload-models.js";
import type {InteractiveMapArchiveType} from "./map-session-models.js";
import type {ToolExecutionContextType} from "./tool-execution-models.js";
import type {InteractiveMapDataType} from "../web/interactive-ui-models.js";
import type {MapAppDeliveryType} from "../web/map-app-models.js";
import type {SnapshotMapDataType} from "../web/snapshot-ui-models.js";

/** processToolReply() 生成的公共数据结果；样式与具体 render_mode 不进入该阶段。 */
export interface ProcessedToolReplyType {
  /** Python reply 携带的最终候选会话 ID，沿用到归档、Browser runtime 与 MCP 发布。 */
  session_id: string;
  /** Python 实际执行模式，包含内部 Tool A 查询降级与最终 Basemap-only 降级。 */
  effective_query_mode: EffectiveQueryModeType;
  /** OSM 记录与 tags，附匹配到的 canonical / display ID；独立于 Overlay geometry，无输出时为 null。 */
  ai_output: AiOutputGroupsWithIdsType | null;
  /** 已补展示 ID 的空间 Feature 与 relation 成员引用；无输出时为 null，relation 自身不生成几何。 */
  overlay_output: IdentifiedOverlayGroupsWithDisplayIdType | null;
  /** 按 Feature 类型组织的 canonical feature_id → display_id 映射，保持运行身份与展示身份分离。 */
  display_id_by_feature_id: DisplayIdByFeatureIdType | null;
  /** relation feature_id → 按 node / area / way 分组的成员 feature_id 与 role，供关系样式渲染。 */
  relation_member_features_by_relation: RelationMemberFeaturesByRelationType | null;
  /** 空间 Feature → relation feature_id[]，供交互详情查询所属关系；与上面的成员索引方向相反。 */
  relation_membership_by_feature_id: RelationMembershipByFeatureIdType | null;
  /** MapSurface 的 [width, height] CSS 逻辑像素，不含信息栏、宿主缩放和最终截图外框。 */
  screenshot_size: [number, number];
  /** Node 根据权威 bbox 计算的 [latitude, longitude]；GeoJSON 则使用 [longitude, latitude]。 */
  center: [number, number];
  /** 初始视口 bbox；此阶段保留 Leaflet 宽类型，发布前收窄为 [[south, west], [north, east]]。 */
  leaflet_bbox: LatLngBoundsLiteral;
  /** 当前后端配置提供的 Leaflet 参数，供后续 HTTP Browser runtime 组装。 */
  leaflet: LeafletConfigType;
  /** Python 的执行 / 降级说明，发布层作为独立 info 字段写入 AI YAML，不混入 OSM 记录。 */
  info: string;
}

/** 三种地图 builder 共用且已经收窄的 MapSurface、底图与 Leaflet 配置。 */
export type CommonMapPayloadFields = Pick<
  BasemapOnlyMapPayloadType,
  "basemap" | "screenshot_size" | "center" | "leaflet_bbox" | "leaflet"
>;

/**
 * Tool 入口已完成的地图模式映射：Tool A 为 Non-core，Tool B 为 Core。
 * Python 内部 Tool B → Tool A 查询降级仍保留 Core；只有 Basemap-only 结果覆盖该请求模式。
 */
export type RequestedMapFlowType = Exclude<MapRenderModeType, "basemap_only">;

/** `tools.ts` 完成 Tool 映射与 Python 调用后交给内部 Flow 的完整输入。 */
export interface ToolFlowInputType {
  /** 调用方 Tool 决定的地图模式，区别于 toolReply 中的实际查询模式。 */
  requestedFlow: RequestedMapFlowType;
  /** 地点确认缓存中的原始检索结果，供会话归档与 Core 原始候选 GeoJSON 使用。 */
  cachedSelection: LocSearchReplyRawType;
  /** 已校验的 MCP Tool 请求，包含 AI 视觉输出与可选 Overlay GeoJSON 输出选择。 */
  toolInput: AiToolInputReqType;
  /** 已发往 Python 的请求，保留选中候选与实际查询参数，供发布层归档。 */
  pythonQuery: PyToolReqType;
  /** 已通过 Bridge 边界校验的 Python reply，公共后处理只消费这一份结果。 */
  toolReply: PyToolReplyType;
  /** 配置解析后的底图快照，后端与客户端沿用同一份来源和署名信息。 */
  resolvedBasemap: ResolvedBasemapType;
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

/**
 * 地图模式与公共数据整理完成后，供发布阶段消费的 Node 数据和两种严格 HTTP Browser runtime。
 * 此处的 ai_output 仍是业务记录；发布阶段才生成 YAML、视觉 URL 与 MCP App 交付包装。
 */
export type RunToolFlowResultType = Readonly<{
  /** 归档、运行时与最终发布共同使用的最终候选会话 ID。 */
  session_id: string;
  /** 原样透传 Tool 输入，供发布层选择 AI-facing 视觉 URL 与是否交付 AI App 布局。 */
  visual_output: VisualOutputType;
  /** 记录实际查询 / 降级模式；渲染模式已单独保存在 archive 与 runtime 中。 */
  effective_query_mode: EffectiveQueryModeType;
  /** 已补关联 ID 的业务记录，供 YAML 发布与 App 详情共享；Basemap-only 为 null。 */
  ai_output: AiOutputGroupsWithIdsType | null;
  /** canonical feature_id → 展示 ID；与归档里的 Overlay 使用同一套 ID。 */
  display_id_by_feature_id: DisplayIdByFeatureIdType | null;
  /** 空间 Feature → relation ID 的详情索引；Basemap-only 与展示索引一起为 null。 */
  relation_membership_by_feature_id: RelationMembershipByFeatureIdType | null;
  /** 已选候选的原始 name 或 null，保持归档与 App 展示来源一致。 */
  selected_location_name: string | null;
  /** 文件层只保存这份纯数据 Archive；Browser runtime 由当前配置另行组装。 */
  interactive_archive: InteractiveMapArchiveType;
  /** /interactive 页面使用的完整数据与当前 Leaflet / UI 配置，区别于 App 的共享 data。 */
  interactive_runtime: InteractiveMapDataType;
  /** Snapshot 页面与后端图片渲染使用的完整数据和当前配置。 */
  snapshot_runtime: SnapshotMapDataType;
  /** 保留 Python 的执行说明，供发布层生成 AI YAML 的独立 info 字段。 */
  info: string;
}>;

/** 只允许进入 MCP `content` 的 AI-facing 发布结果。 */
export type AiPublishedToolFlowResultType = Readonly<{
  /** 与客户端交付相同的最终会话 ID，供 AI 后续命令引用。 */
  session_id: string;
  /** 业务 AI Output 的 YAML 文本；Basemap-only 无业务记录时省略。 */
  ai_output_yaml?: string;
  /** 仅在部署允许、请求选择且存在业务 Overlay 时提供的 GeoJSON 文本。 */
  overlay_output_json?: string;
  /** 按 visual_output 选择的 Snapshot 页面或 WebP URL；none 时省略。 */
  visual_url?: string;
}>;

/**
 * 进入 MCP Tool Result `_meta["io.geomcp/interactiveMap"]` 的 App 交付，不放入 AI-facing content。
 * data 保存共享业务对象，user_payload / ai_payload 只保存各自布局与 URL；none 时仍保留 User 交付。
 */
export type ClientPublishedToolFlowResultType = MapAppDeliveryType;

/** Tool Flow 在构造阶段就分离 AI 与客户端发布路径，禁止先混合再删除敏感字段。 */
export type PublishedToolFlowResultType = Readonly<{
  /** AI-facing 发布包装，区别于共享 data.ai_output 中按 OSM 类型分组的业务记录。 */
  ai_output: AiPublishedToolFlowResultType;
  /** 完整客户端交付，只由 MCP handler 放入 _meta，保留共享数据与角色布局的分离。 */
  client_output: ClientPublishedToolFlowResultType;
}>;

/** MCP handler 可装饰的已发布地图 Tool executor；Services 保持泛型，避免 models 反向依赖实现层。 */
export type PublishedMapToolExecutorType<ServicesType> = (
  cachedSelection: LocSearchReplyRawType,
  toolInput: AiToolInputReqType,
  context: ToolExecutionContextType,
  services: ServicesType,
) => Promise<PublishedToolFlowResultType>;
