/**
 * Current authority source: doc/GeoMCP 技术规范文档.md
 *
 * TypeScript bridge models mirror python/utils/models.py.
 * Zod is used only on the protocol boundary for runtime verification.
 */

import { z } from "zod";

export const toolTypeSchema = z.enum(["tool_a", "tool_b"]);
export const basemapTypeSchema = z.enum(["osm", "satellite"]);
export const searchStatusSchema = z.enum(["needs_confirmation", "no_match"]);

export type ToolType = z.infer<typeof toolTypeSchema>;
export type BasemapType = z.infer<typeof basemapTypeSchema>;
export type SearchStatus = z.infer<typeof searchStatusSchema>;

export type JsonPrimitiveType = null | boolean | number | string;
export type JsonValueType = JsonPrimitiveType | JsonValueType[] | { [key: string]: JsonValueType };
export type JsonDictType = { [key: string]: JsonValueType };

export const jsonValueSchema: z.ZodType<JsonValueType> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const jsonDictSchema = z.record(z.string(), jsonValueSchema);

export const locSearchQuerySchema = z
  .object({
    query: z.string(),
    country_codes: z.array(z.string()).nullable().optional(),
  })
  .strict();

// `location_search` 的 MCP 输入。
export const locSearchQueryReqSchema = z
  .object({
    queries: z.array(locSearchQuerySchema).min(1),
  })
  .strict();

// 搜索阶段的完整候选结构。
// 这份 raw 结构会被 TS 缓存起来，供后续 tool_a / tool_b join 使用。
export const locSearchCandidateRawSchema = z
  .object({
    index: z.number().int(),
    osm_type: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    display_name: z.string().nullable().optional(),
    lat: z.number().nullable().optional(),
    lon: z.number().nullable().optional(),
    category: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    importance: z.number().nullable().optional(),
    address: z.record(z.string(), z.string()).nullable().optional(),
    boundingbox: z.array(z.number()).nullable().optional(),
    geojson: jsonDictSchema.nullable().optional(),
  })
  .strict();

export const locSearchCandidateSchema = locSearchCandidateRawSchema.omit({
  geojson: true,
});

// Python 在 `search_location` 阶段回给 TS 的业务数据结构。
// 注意：这只是 bridge envelope 里 `data` 字段的内部结构，
// 不包含外层 `{ ok, data, error }`。
export const locSearchReplyRawSchema = z
  .object({
    status: searchStatusSchema,
    session_id: z.string(),
    query: z.string(),
    candidates: z.array(locSearchCandidateRawSchema),
    instruction: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
  })
  .strict();

export const locSearchReplySchema = z
  .object({
    status: searchStatusSchema,
    session_id: z.string(),
    query: z.string(),
    candidates: z.array(locSearchCandidateSchema),
    instruction: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
  })
  .strict();

// `tool_a` / `tool_b` 暴露给 AI 的 MCP 输入。
// 这一层仍然是轻量确认信息，不包含 `selected_candidate`。
export const AitoolInputReqSchema = z
  .object({
    session_id: z.string(),
    selected_indices: z.array(z.number().int()).min(1),
    basemap: basemapTypeSchema.nullable().optional(),
    ai_attention_token: z.string().nullable().optional(),
  })
  .strict();

export const appErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    details: jsonValueSchema.optional(),
  })
  .strict();

export const bridgeActionSchema = z.enum([
  "search_location",
  "tool_a",
  "tool_b",
  "error",
]);

// Python 执行 `tool_a` / `tool_b` 后回给 TS 的业务数据结构。
export const toolResSchema = z
  .object({
    session_id: z.string(),
    result: jsonValueSchema,
  })
  .strict();

// TS 在 tool_a / tool_b handler 里完成 join 后，
// 真正发给 Python 的 `data` 结构。
export const pyToolReqSchema = z
    .object({
      session_id: z.string(),
      selected_candidate: locSearchCandidateRawSchema,
      basemap: basemapTypeSchema.nullable().optional(),
      ai_attention_token: z.string().nullable().optional(),
    })
    .strict();

export function bridgeRequestSchemaFn<T extends z.ZodType<JsonDictType>>(dataSchema: T) {
  // 创建发往 Python 的标准 envelope：
  // {
  //   action: "...",
  //   data: <dataSchema>
  // }
  return z
    .object({
      action: bridgeActionSchema,
      data: dataSchema,
    })
    .strict();
}

export function bridgeResponseSchemaFn<T extends z.ZodTypeAny>(dataSchema: T) {
  // 创建 Python 回给 TS 的标准 envelope：
  // {
  //   ok: true/false,
  //   data: <dataSchema> | null,
  //   error: {...} | null
  // }
  //
  // 所以 `toolResSchema` / `locSearchReplyRawSchema`
  // 都是在描述这里面 `data` 的内部结构。
  return z
    .object({
      ok: z.boolean(),
      data: dataSchema.nullable(),
      error: appErrorSchema.nullable(),
    })
    .strict();
}

export type LocSearchQueryType = z.infer<typeof locSearchQuerySchema>;
export type LocSearchQueryReqType = z.infer<typeof locSearchQueryReqSchema>;
export type LocSearchCandidateRawType = z.infer<typeof locSearchCandidateRawSchema>;
export type LocSearchCandidateType = z.infer<typeof locSearchCandidateSchema>;
export type LocSearchReplyRawType = z.infer<typeof locSearchReplyRawSchema>;
export type LocSearchReplyType = z.infer<typeof locSearchReplySchema>;
export type AiToolInputReqType = z.infer<typeof AitoolInputReqSchema>;
export type PyToolReqType = z.infer<typeof pyToolReqSchema>;
export type AppErrorType = z.infer<typeof appErrorSchema>;
export type BridgeActionType = z.infer<typeof bridgeActionSchema>;
export type BridgeRequestType<T extends JsonDictType> = {
  action: BridgeActionType;
  data: T;
};
export type BridgeResponseType<T> = {
  ok: boolean;
  data: T | null;
  error: AppErrorType | null;
};

export const BridgeActionsRegistry = {
  search_location: {
    requestSchema: locSearchQueryReqSchema,
    responseSchema: locSearchReplyRawSchema,
  },
  tool_a: {
    requestSchema: pyToolReqSchema,
    responseSchema: toolResSchema,
  },
  tool_b: {
    requestSchema: pyToolReqSchema,
    responseSchema: toolResSchema,
  },
};
