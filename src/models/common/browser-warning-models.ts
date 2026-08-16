/** Browser → Node 的受限运行时 warning 协议。 */

import {z} from "zod";
import {basemapProfileIdSchema} from "./basemap-models.js";

/** 允许触发在线 raster fallback 的 PMTiles 来源失败；编程错误不通过本 warning 协议降级。 */
export const interactivePmtilesFallbackReasonSchema = z.enum([
  "pmtiles_header_failed",
  "pmtiles_tile_type",
  "pmtiles_zoom_range",
  "tile_load_failed",
]);

/**
 * Interactive PMTiles 降级 warning。
 *
 * Browser 只回传 profile ID 与稳定 reason code，不携带 archive URL、provider token、异常文本或堆栈。
 * warning 仅供 Browser console 与 Node 后台日志消费，不进入 Map payload、ready summary 或 AI Output。
 */
export const interactivePmtilesFallbackWarningSchema = z.object({
  event: z.literal("interactive_pmtiles_fallback"),
  details: z.object({
    profile_id: basemapProfileIdSchema,
    reason_code: interactivePmtilesFallbackReasonSchema,
  }).strict(),
}).strict();

/** 当前 Browser 可以上报给 Node 的完整 warning 白名单。 */
export const browserWarningReportSchema = z.discriminatedUnion("event", [
  interactivePmtilesFallbackWarningSchema,
]);

export type InteractivePmtilesFallbackReasonType = z.infer<typeof interactivePmtilesFallbackReasonSchema>;
export type BrowserWarningReportType = z.infer<typeof browserWarningReportSchema>;

/** Browser runtime 使用的 warning 发布接口；实现不得让日志或回传失败中断地图流程。 */
export type BrowserWarningReporterType = (warning: BrowserWarningReportType) => void;
