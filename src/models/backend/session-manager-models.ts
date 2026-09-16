/** RAM Session、checkpoint 与公开查询状态的数据边界。 */

import {z} from "zod";

import {finalSessionIdSchema} from "./session-id-models.js";

const unixSecondsSchema = z.number().finite().nonnegative();

/** RAM Session checkpoint 中单条记录的稳定结构，不保存可由 key 推导的 Session ID 或目录。 */
export const sessionIndexRecordSchema = z.object({
  query: z.string(),
  name: z.string().nullable().optional(),
  created_time: unixSecondsSchema,
  open_time: unixSecondsSchema,
  close_time: unixSecondsSchema,
}).strict().superRefine((record, context) => {
  if (record.created_time !== record.open_time) {
    context.addIssue({
      code: "custom",
      path: ["created_time"],
      message: "created_time must equal open_time",
    });
  }
  if (record.close_time <= record.open_time) {
    context.addIssue({
      code: "custom",
      path: ["close_time"],
      message: "close_time must be greater than open_time",
    });
  }
});

/** sessions.json 的 key 必须是正式 Tool 阶段使用的最终地图 Session ID。 */
export const sessionsJsonSchema = z.record(finalSessionIdSchema, sessionIndexRecordSchema);

export type SessionIndexRecordType = z.infer<typeof sessionIndexRecordSchema>;
export type SessionsJsonType = z.infer<typeof sessionsJsonSchema>;

/** HTTP 与其他消费者只通过这个判别联合读取 Session 服务状态。 */
export type SessionLookupResultType =
  | {status: "missing"}
  | {status: "active"; record: SessionIndexRecordType}
  | {status: "archived"; record: SessionIndexRecordType};
