/** 搜索 Session ID 与最终地图 Session ID 的严格边界。 */

import {z} from "zod";

/** Python 生成的 `YYMxxxxxxxx`：两位年份、单字符月份、8 位小写 UUID4 十六进制片段。 */
export const searchSessionIdSchema = z.string().regex(
  /^\d{2}[0-9ab][0-9a-f]{8}$/,
  "search Session ID must use YYMxxxxxxxx format",
);

/** Tool A/B 阶段使用 `<search_session_id>-<candidate.index>`，index 必须为正整数。 */
export const finalSessionIdSchema = z.string().regex(
  /^\d{2}[0-9ab][0-9a-f]{8}-[1-9]\d*$/,
  "final Session ID must use <search_session_id>-<candidate.index> format",
);

export type SessionIdType = z.infer<typeof searchSessionIdSchema>;
export type IndexSessionIdType = z.infer<typeof finalSessionIdSchema>;
