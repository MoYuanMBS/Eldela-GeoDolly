import {z} from "zod";

import {jsonValueSchema} from "./json-models.js";

export const appErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    details: jsonValueSchema.optional(),
  })
  .strict();

export type AppErrorType = z.infer<typeof appErrorSchema>;
