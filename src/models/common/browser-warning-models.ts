/** Browser → Node 的受限运行时 warning 协议。 */

import {z} from "zod";
import {basemapProfileIdSchema} from "./basemap-models.js";

/** Browser 始终向页面同源地址发送；内部 listener 端口不暴露给 Browser bundle。 */
export const BROWSER_WARNING_ROUTE = "/browser-warnings";

const basemapWarningPhaseSchema = z.enum(["initial", "runtime"]);
const basemapTileFailureReasonSchema = z.enum(["tile_layer_init", "tile_load_failed"]);
// 只有 Proxy 请求有独立单瓦片超时；原始来源仍由全局 ready timeout 兜底。
const basemapProxyFailureReasonSchema = z.union([basemapTileFailureReasonSchema, z.literal("tile_load_timeout")]);

/** Proxy 失效但已经切换至 profile 原始 URL，因此 warning 不进入 Basemap failed 状态。 */
export const basemapProxyFallbackWarningSchema = z.object({
  event: z.literal("basemap_proxy_fallback"),
  details: z.object({
    profile_id: basemapProfileIdSchema,
    phase: basemapWarningPhaseSchema,
    reason_code: basemapProxyFailureReasonSchema,
  }).strict(),
}).strict();

/** 初始 ready 之后原始来源仍失败；Browser 保留地图并用透明空瓦片代替。 */
export const basemapOriginTileUnavailableWarningSchema = z.object({
  event: z.literal("basemap_origin_tile_unavailable"),
  details: z.object({
    profile_id: basemapProfileIdSchema,
    phase: z.literal("runtime"),
    reason_code: basemapTileFailureReasonSchema,
  }).strict(),
}).strict();

/** Browser 可以回传的完整 warning 白名单；URL、token、异常文本与堆栈都不属于协议。 */
export const browserWarningReportSchema = z.discriminatedUnion("event", [
  basemapProxyFallbackWarningSchema,
  basemapOriginTileUnavailableWarningSchema,
]);

export type BrowserWarningReportType = z.infer<typeof browserWarningReportSchema>;

/** 生命周期级 warning sink；发布失败必须留在诊断路径，不能反向中断地图流程。 */
export type BrowserWarningReporterType = (warning: BrowserWarningReportType) => void;
