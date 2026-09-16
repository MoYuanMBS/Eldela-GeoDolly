/** Node Session HTTP 与 Browser 生命周期共享的最小状态协议。 */

import {z} from "zod";

export const sessionHttpStatusSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("active"),
    recheck_after_ms: z.number().int().positive(),
  }).strict(),
  z.object({
    status: z.literal("archived"),
  }).strict(),
]);

export type SessionHttpStatusType = z.infer<typeof sessionHttpStatusSchema>;
