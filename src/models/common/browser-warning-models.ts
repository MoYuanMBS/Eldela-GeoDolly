/** Browser → Node 的受限运行时 warning 协议。 */

import {z} from "zod";
import {basemapProfileIdSchema} from "./basemap-models.js";

/** Browser 始终向页面同源地址发送；内部 listener 端口不暴露给 Browser bundle。 */
export const BROWSER_WARNING_ROUTE = "/browser-warnings";

/** 初始 ready 之后同源 endpoint 仍失败；Browser 保留地图并用透明空瓦片代替。 */
export const basemapTileUnavailableWarningSchema = z.object({
  event: z.literal("basemap_tile_unavailable"),
  details: z.object({
    profile_id: basemapProfileIdSchema,
    phase: z.literal("runtime"),
    reason_code: z.literal("tile_load_failed"),
  }).strict(),
}).strict();

/** Browser 可以回传的完整 warning 白名单；URL、token、异常文本与堆栈都不属于协议。 */
export const browserWarningReportSchema = basemapTileUnavailableWarningSchema;

export type BrowserWarningReportType = z.infer<typeof browserWarningReportSchema>;

/** 生命周期级 warning sink；发布失败必须留在诊断路径，不能反向中断地图流程。 */
export type BrowserWarningReporterType = (warning: BrowserWarningReportType) => void;
