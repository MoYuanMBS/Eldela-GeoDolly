/**
 * Node Tool Flow 与 Browser Map Runtime 共用的可序列化地图视觉 payload。
 *
 * 本文件只定义跨进程数据，不包含 Leaflet map、layer、renderer 或 ready Promise。Interactive
 * 与 Snapshot 后续可以在该公共视觉数据之上增加各自字段，但不能重新生成 display_id 或改写 Overlay。
 * 浏览器只按 render_mode 选择视觉能力，不读取 requested Tool 或 Python 内部查询/降级状态；这样新增
 * Tool 时只需要在 Node 编排层映射到既有地图模式，不会扩大 Browser Map Runtime 的协议表面。
 *
 * 地图数据与样式发布保持独立：本 schema 不携带 built-in/user style。built-in style 随 Browser App
 * 构建，部署期冻结的用户样式使用独立 renderStylePayloadSchema；两者不能嵌入 Overlay 数据结构。
 */

import {z} from "zod";
import {basemapTypeSchema, osmTypeSchema} from "./bridge-models.js";
import {leafletConfigSchema} from "./config-models.js";
import {
  identifiedOverlayGroupsWithDisplayIdSchema,
  overlayGeoJsonGeometrySchema,
  relationMemberFeaturesByRelationSchema,
} from "./map-data-models.js";

const finiteNumberSchema = z.number().finite();
const positiveIntegerSchema = z.number().int().positive();

/** Node 已经确定的地图视觉模式，也是浏览器选择 Core/Overlay 能力的唯一判别字段。 */
export const mapRenderModeSchema = z.enum(["core", "non_core", "basemap_only"]);

/**
 * MapSurface 初始视口输入。
 *
 * screenshot_size 只表示地图画布的 CSS 逻辑像素，不包含 Reference UI；center 与 bounds 都使用
 * Leaflet 的 [latitude, longitude] 顺序。它们由 Node 一次生成，浏览器不得从 geometry 反算或替换。
 */
export const mapSurfacePayloadSchema = z.object({
  /** 固定 MapSurface 的 [width, height]，不随 iframe 宿主尺寸重新计算。 */
  screenshot_size: z.tuple([positiveIntegerSchema, positiveIntegerSchema]),
  /** Node 计算的投影中心；bbox 只决定 zoom，不能反过来覆盖该中心。 */
  center: z.tuple([finiteNumberSchema, finiteNumberSchema]),
  /** 请求 bbox 的 Leaflet 表达；跨日期变更线时 east 可以位于展开后的连续世界。 */
  leaflet_bbox: z.tuple([
    z.tuple([finiteNumberSchema, finiteNumberSchema]),
    z.tuple([finiteNumberSchema, finiteNumberSchema]),
  ]),
}).strict();

/**
 * Core renderer 消费的地点确认 geometry。
 *
 * source_osm_type 保留地点来源身份；实际采用 Node/Way/Area 哪种视觉 geometry 仍由 GeoJSON 类型决定。
 * 这里只接受现有 Leaflet geometry adapter 已支持的五种 geometry，不把任意 JSON 推迟到浏览器热路径校验。
 */
export const coreVisualPayloadSchema = z.object({
  /** 地点确认记录的原始 OSM primitive 类型，用于区分 Relation 等来源身份。 */
  source_osm_type: osmTypeSchema,
  /** Core renderer 使用的只读 geometry；不得合并回普通 overlay_output。 */
  geometry: overlayGeoJsonGeometrySchema,
}).strict();

const commonMapPayloadFields = {
  // Node 已选择的底图 profile ID。只有 Basemap runtime、Attribution 与 ready 消费该字段；
  // MapSurface 和 Overlay/Core renderer 都不得依据底图改写视口、geometry 或 Feature 样式。
  basemap: basemapTypeSchema,
  // 三个 MapSurface 字段复用同一 schema，避免 Browser 与 Snapshot 对坐标/尺寸边界产生分叉。
  screenshot_size: mapSurfacePayloadSchema.shape.screenshot_size,
  center: mapSurfacePayloadSchema.shape.center,
  leaflet_bbox: mapSurfacePayloadSchema.shape.leaflet_bbox,
  // Node 启动时已校验的 Leaflet 配置快照；浏览器不直接读取 app.yaml。
  leaflet: leafletConfigSchema,
} as const;

const overlayMapPayloadFields = {
  // Interactive 与 Snapshot 共用同一次 display_id enrichment 后的 canonical Overlay。
  overlay_output: identifiedOverlayGroupsWithDisplayIdSchema,
  // Relation 只通过该字典附加 membership visual，不生成独立 relation geometry。
  relation_member_features_by_relation: relationMemberFeaturesByRelationSchema,
} as const;

/**
 * 普通 Overlay 地图。
 *
 * 该模式不携带 Core visual；它可以由任何当前或未来 Tool 选择，schema 不编码 Tool 名称。
 */
export const nonCoreMapPayloadSchema = z.object({
  ...commonMapPayloadFields,
  ...overlayMapPayloadFields,
  /** Browser 只初始化普通 Overlay/Relation/Label visual。 */
  render_mode: z.literal("non_core"),
  /** 显式 null 让错误混入 Core 数据的 payload 在边界直接失败。 */
  core_visual: z.null(),
}).strict();

/**
 * Core 地图同时携带普通 Overlay 与独立 Core visual。
 *
 * Core 不能合并进 overlay_output、Relation membership 或普通 Feature index；Browser Map Runtime
 * 分别持有两套 visual result，并在共同 ready/dispose 生命周期中进行编排。
 */
export const coreMapPayloadSchema = z.object({
  ...commonMapPayloadFields,
  ...overlayMapPayloadFields,
  /** Browser 在普通 Overlay 之外追加独立 Core visual。 */
  render_mode: z.literal("core"),
  /** Core 模式必须提供可渲染的地点确认 geometry，不能以 null 静默降级。 */
  core_visual: coreVisualPayloadSchema,
}).strict();

/**
 * 纯底图模式只保留 MapSurface、basemap 与 Leaflet 部署配置。
 *
 * Overlay、Relation 与 Core 固定为 null，而不是空对象或空数组，使 Browser 能明确发布对应
 * `skipped` 状态，并完全跳过 RuntimeStylePlan、Label 和 Interaction 初始化。样式不是本 schema
 * 的字段；Basemap-only 是否读取独立样式 payload 由更外层 Browser flow 决定。
 */
export const basemapOnlyMapPayloadSchema = z.object({
  ...commonMapPayloadFields,
  /** Browser 只启动 MapSurface 与 Basemap runtime。 */
  render_mode: z.literal("basemap_only"),
  /** Basemap-only 不使用空 Overlay 伪装成功渲染。 */
  overlay_output: z.null(),
  /** 没有 Overlay 时也不能单独携带 Relation membership。 */
  relation_member_features_by_relation: z.null(),
  /** 纯底图流程不绘制 Core。 */
  core_visual: z.null(),
}).strict();

/**
 * 三种地图模式的公共视觉 payload。
 *
 * render_mode 是唯一判别字段；requested Tool 与 Python effective query mode 可以保留在 Node 的
 * session/诊断模型中，但不得进入 Browser schema，也不得影响底图选择或其他视觉实现。
 */
export const commonVisualMapPayloadSchema = z.discriminatedUnion("render_mode", [
  coreMapPayloadSchema,
  nonCoreMapPayloadSchema,
  basemapOnlyMapPayloadSchema,
]);

export type MapRenderModeType = z.infer<typeof mapRenderModeSchema>;
export type MapSurfacePayloadType = z.infer<typeof mapSurfacePayloadSchema>;
export type CoreVisualPayloadType = z.infer<typeof coreVisualPayloadSchema>;
export type NonCoreMapPayloadType = z.infer<typeof nonCoreMapPayloadSchema>;
export type CoreMapPayloadType = z.infer<typeof coreMapPayloadSchema>;
export type BasemapOnlyMapPayloadType = z.infer<typeof basemapOnlyMapPayloadSchema>;
export type CommonVisualMapPayloadType = z.infer<typeof commonVisualMapPayloadSchema>;
