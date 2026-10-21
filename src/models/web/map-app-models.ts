/**
 * MCP App 的交付数据与 AI 视口 Tool 的序列化、运行时契约。
 *
 * ToolResult 只交付成功指针；业务数据由 /mapdata 提供。Leaflet 实例、投影检查
 * 和当前会话绑定由运行层负责。
 */

import {z} from "zod";
import {finalSessionIdSchema} from "../backend/session-id-models.js";
import type {SnapshotTileView} from "../mapsurface/basemap-runtime-models.js";
import type {AppErrorType} from "../common/error-models.js";
/** 成功发布的最终 Session 指针；工具错误走 isError，不混入此结构。 */
export const mapAppResultSchema = z.object({
  session_id: finalSessionIdSchema,
  success: z.literal(true),
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
/** 当前截图和 User → AI 对齐只需要会话身份，视口由当前 runtime 读取。 */
export const aiMapSessionInputSchema = z.object({session_id: finalSessionIdSchema}).strict();

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
export const aiMapToolViewSchema = aiMapViewSchema.extend({session_id: finalSessionIdSchema, visual_url: z.string().url().optional()});
/** 新工具只交付 AI 实际可见范围，不同时重复返回 center / zoom。 */
export const aiMapToolBoundsSchema = aiMapToolViewSchema.pick({session_id: true, visible_bounds: true});

// 单块数据类型均从 schema 推导，避免运行时校验与 TypeScript 字段声明分叉。
export type MapAppDeliveryType = Readonly<z.infer<typeof mapAppResultSchema>>;
export type AiMapBoundsType = z.infer<typeof aiMapBoundsSchema>;
export type AiMapCenterZoomType = z.infer<typeof aiMapCenterZoomSchema>;
export type AiMapViewType = z.infer<typeof aiMapViewSchema>;

/** 命令只操作所属浏览器地图实例；Session 绑定与生命周期由 Server 管理。 */
export interface AiMapViewCommands {
  getView(): AiMapViewType;
  waitForScreenshot(signal: AbortSignal): Promise<SnapshotTileView>;
  fitBounds(bbox: AiMapBoundsType): AiMapViewType;
  setCenterZoom(input: AiMapCenterZoomType): AiMapViewType;
}

export interface AiMapJobResult {
  view: AiMapViewType;
  visual_url?: string;
  warning?: AppErrorType;
}

/** Playwright 与 AI 页面的纯数据接线；不跨层传递 Leaflet、DOM 或 Node 对象。 */
export interface AiMapBrowserPort {
  getView(): AiMapViewType;
  fitBounds(bbox: AiMapBoundsType): AiMapViewType;
  setCenterZoom(input: AiMapCenterZoomType): AiMapViewType;
  waitForScreenshot(): Promise<void>;
}
