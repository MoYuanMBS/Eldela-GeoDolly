/**
 * MCP App 的交付数据与 AI 视口 Tool 的序列化契约。
 *
 * 共享业务 data 与角色布局分开：App 接收时解析一份 data，User / AI 装配继续引用其中的对象，
 * 不再分别 parse 完整地图数据。Leaflet 实例、投影检查和当前会话绑定由运行层负责。
 */

import {z} from "zod";
import {finalSessionIdSchema} from "../backend/session-id-models.js";
import {visualOutputSchema} from "../backend/bridge-models.js";
import {basemapOnlyMapPayloadSchema, coreMapPayloadSchema, mapSurfacePayloadSchema, nonCoreMapPayloadSchema} from "../mapsurface/map-payload-models.js";
import {interactiveMapDataSchema} from "./interactive-ui-models.js";

// 从既有地图模型中移除角色视口和 Leaflet 配置；前者进入各自 payload，后者由 App 构建配置提供。
const layoutFields = {leaflet: true, screenshot_size: true, center: true, leaflet_bbox: true} as const;
const sharedFields = {
  /** 最终会话 ID，格式为 <search_session_id>-<candidate.index>，用于关联交付与后续视口命令。 */
  session_id: finalSessionIdSchema,
  /** AI 视觉输出选择，独立于 render_mode；none 只关闭 AI 地图，User 地图仍可交付。 */
  visual_output: visualOutputSchema,
  /** 已选候选的原始 name；缺失时为 null，不用 display_name 或 UI 占位文案替代。 */
  selected_location_name: interactiveMapDataSchema.shape.selected_location_name,
};
// Core / Non-core 必须携带详情；unwrap 仅去掉既有 nullable 层，继续复用原字段的严格结构。
const overlayDetails = {
  /** 独立的 OSM 记录与 tags 分组，附匹配到的 canonical / display ID；不包含 Overlay geometry。 */
  ai_output: interactiveMapDataSchema.shape.ai_output.unwrap(),
  /** 按 Feature 类型组织的 canonical feature_id → display_id 展示索引。 */
  display_id_by_feature_id: interactiveMapDataSchema.shape.display_id_by_feature_id.unwrap(),
  /** 空间 Feature → relation feature_id[] 反向索引，供 User 详情查询所属 relation。 */
  relation_membership_by_feature_id: interactiveMapDataSchema.shape.relation_membership_by_feature_id.unwrap(),
};

/**
 * 复用既有严格 render_mode 分支，保留 Overlay、relation 成员和 core_visual 的各自约束。
 * Basemap-only 的业务输出必须为 null，不用空分组伪装成可用业务数据。
 * 发布层与 App 各自校验传输边界；App 接收后的两个角色共享同一次 parse 得到的业务对象。
 */
export const mapAppSharedDataSchema = z.discriminatedUnion("render_mode", [
  coreMapPayloadSchema.omit(layoutFields).extend({...sharedFields, ...overlayDetails}),
  nonCoreMapPayloadSchema.omit(layoutFields).extend({...sharedFields, ...overlayDetails}),
  basemapOnlyMapPayloadSchema.omit(layoutFields).extend({
    ...sharedFields,
    ai_output: z.null(),
    display_id_by_feature_id: z.null(),
    relation_membership_by_feature_id: z.null(),
  }),
]);

/** 角色各自的初始 MapSurface 布局；交付后 User 与 AI 的实际视口可以独立变化。 */
const mapAppLayoutSchema = z.object({
  /** [width, height] CSS 逻辑像素，只计地图区域，不含信息栏、宿主缩放或最终截图尺寸。 */
  map_size: mapSurfacePayloadSchema.shape.screenshot_size,
  /** 初始 [latitude, longitude]，沿用后端视口计算结果；区别于 GeoJSON 的 [longitude, latitude]。 */
  center: mapSurfacePayloadSchema.shape.center,
  /** 初始 Leaflet 双角 [[south, west], [north, east]]；可使用连续世界经度，不由 Overlay 反算。 */
  leaflet_bbox: mapSurfacePayloadSchema.shape.leaflet_bbox,
}).strict();

/** User 的外部 /interactive 页面入口；这里只校验 URL 语法，来源、路径与会话由 launcher 校验。 */
export const userMapAppPayloadSchema = mapAppLayoutSchema.extend({url: z.url()});
/** AI 的外部页面 / WebP URL 可省略；App 用共享数据直接渲染，当前 AI 视口不由该 URL 驱动。 */
export const aiMapAppPayloadSchema = mapAppLayoutSchema.extend({url: z.url().optional()});

/**
 * App 接收边界先严格解析共享数据与 User 布局；AI 布局留给 launcher 单独解析，失败只关闭 AI。
 * unknown 是局部失败隔离边界：visual_output=none 时仍须检查它为 null，其余模式须通过 AI 布局 schema。
 */
export const mapAppResultSchema = z.object({
  data: mapAppSharedDataSchema,
  user_payload: userMapAppPayloadSchema,
  ai_payload: z.unknown(),
}).strict();

// 地理纬度合法不等于 Mercator 可投影；adapter 在写入视口前另外拒绝超出投影范围的目标。
const latitudeSchema = z.number().finite().min(-90).max(90);
/**
 * 命名边界均为度，south <= north；经度允许超出 [-180, 180]，不在模型中归一化。
 * east < west 的跨线输入由 adapter 先展开，再整体移到初始 Overlay 附近的世界副本，保留 bbox 跨度。
 */
export const aiMapBoundsSchema = z.object({
  south: latitudeSchema,
  west: z.number().finite(),
  north: latitudeSchema,
  east: z.number().finite(),
}).strict().refine((bbox) => bbox.north >= bbox.south, {message: "north must not be less than south"});

/** 命名中心坐标避免 tuple 顺序混淆；经度由 adapter 选择世界副本，zoom 上限由当前地图配置决定。 */
export const aiMapCenterZoomSchema = z.object({
  center: z.object({longitude: z.number().finite(), latitude: latitudeSchema}).strict(),
  /** Leaflet 的非负整数缩放级别，区别于比例尺数值或宿主显示缩放倍数。 */
  zoom: z.number().int().nonnegative(),
}).strict();

// schema 只检查 session_id 格式；是否匹配当前已就绪 AI 地图，由 Tool handler 在每次调用时检查。
export const fitAiMapBboxInputSchema = z.object({session_id: finalSessionIdSchema, bbox: aiMapBoundsSchema}).strict();
export const setAiMapCenterZoomInputSchema = aiMapCenterZoomSchema.extend({session_id: finalSessionIdSchema});

/** 成功命令从 Leaflet 读取的实际视口；表示视口已应用，不保证新瓦片、信息栏或截图已经就绪。 */
export const aiMapViewSchema = z.object({
  center: aiMapCenterZoomSchema.shape.center,
  /** 返回地图实际采用的级别，包括受配置上限约束后的结果。 */
  zoom: aiMapCenterZoomSchema.shape.zoom,
  /** 当前可见地理范围，区别于查询 bbox 和初始 leaflet_bbox；经度保留当前世界副本。 */
  visible_bounds: aiMapBoundsSchema,
  /** MapSurface 的 CSS 逻辑像素，不含信息栏、外框和宿主显示缩放。 */
  logical_size: z.object({width: z.number().int().positive(), height: z.number().int().positive()}).strict(),
}).strict();
/** 成功 Tool Result 的 structuredContent 与 JSON 文本共用此结构；失败走 AppError / isError 路径。 */
export const aiMapToolViewSchema = aiMapViewSchema.extend({session_id: finalSessionIdSchema});

// 单块数据类型均从 schema 推导，避免运行时校验与 TypeScript 字段声明分叉。
export type MapAppSharedDataType = z.infer<typeof mapAppSharedDataSchema>;
export type UserMapAppPayloadType = z.infer<typeof userMapAppPayloadSchema>;
export type AiMapAppPayloadType = z.infer<typeof aiMapAppPayloadSchema>;
/** 发布层构造的完整交付；区别于 App 接收阶段尚未单独校验 ai_payload 的结构。 */
export type MapAppDeliveryType = Readonly<{
  /** 两个角色共同消费的业务数据；角色布局不再复制 Overlay 或详情。 */
  data: MapAppSharedDataType;
  user_payload: UserMapAppPayloadType;
  /** visual_output=none 时为 null，其余模式携带 AI 布局。 */
  ai_payload: AiMapAppPayloadType | null;
}>;
export type AiMapBoundsType = z.infer<typeof aiMapBoundsSchema>;
export type AiMapCenterZoomType = z.infer<typeof aiMapCenterZoomSchema>;
export type AiMapViewType = z.infer<typeof aiMapViewSchema>;
