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

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonDict = { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
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

export const locationQuerySchema = z
  .object({
    query: z.string(),
    country_codes: z.array(z.string()).nullable().optional(),
  })
  .strict();

export const searchRequestSchema = z
  .object({
    queries: z.array(locationQuerySchema).min(1),
  })
  .strict();

export const candidateRawSchema = z
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

export const candidateForAiSchema = candidateRawSchema.omit({
  geojson: true,
});

export const searchResponseRawSchema = z
  .object({
    status: searchStatusSchema,
    session_id: z.string(),
    query: z.string(),
    candidates: z.array(candidateRawSchema),
    instruction: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
  })
  .strict();

export const searchResponseForAiSchema = z
  .object({
    status: searchStatusSchema,
    session_id: z.string(),
    query: z.string(),
    candidates: z.array(candidateForAiSchema),
    instruction: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
  })
  .strict();

export const selectionRequestSchema = z
  .object({
    session_id: z.string(),
    selected_indices: z.array(z.number().int()).min(1),
    tool: toolTypeSchema,
    ai_attention_token: z.string().nullable().optional(),
    basemap: basemapTypeSchema.nullable().optional(),
  })
  .strict();

export const toolAInputSchema = z
  .object({
    session_id: z.string(),
    selected_indices: z.array(z.number().int()).min(1),
    basemap: basemapTypeSchema.nullable().optional(),
    ai_attention_token: z.string().nullable().optional(),
  })
  .strict();

export const toolBInputSchema = z
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

export const toolAAndBResponseSchema = z
  .object({
    session_id: z.string(),
    result: jsonValueSchema,
  })
  .strict();

export function createApiRequestDataSchema<T extends z.ZodType<JsonDict>>(dataSchema: T) {
  return z
    .object({
      action: bridgeActionSchema,
      data: dataSchema,
    })
    .strict();
}

export function createApiDataResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z
    .object({
      ok: z.boolean(),
      data: dataSchema.nullable(),
      error: appErrorSchema.nullable(),
    })
    .strict();
}

export type LocationQuery = z.infer<typeof locationQuerySchema>;
export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type CandidateRaw = z.infer<typeof candidateRawSchema>;
export type CandidateForAI = z.infer<typeof candidateForAiSchema>;
export type SearchResponseRaw = z.infer<typeof searchResponseRawSchema>;
export type SearchResponseForAI = z.infer<typeof searchResponseForAiSchema>;
export type SelectionRequest = z.infer<typeof selectionRequestSchema>;
export type ToolAInput = z.infer<typeof toolAInputSchema>;
export type ToolBInput = z.infer<typeof toolBInputSchema>;
export type AppError = z.infer<typeof appErrorSchema>;
export type BridgeAction = z.infer<typeof bridgeActionSchema>;
export type ApiRequestData<T extends JsonDict> = {
  action: BridgeAction;
  data: T;
};
export type ApiDataResponse<T> = {
  ok: boolean;
  data: T | null;
  error: AppError | null;
};

export const BridgeActionsRegistry = {
  search_location: {
    requestSchema: searchRequestSchema,
    responseSchema: searchResponseRawSchema,
  },
  tool_a: {
    requestSchema: toolAInputSchema,
    responseSchema: toolAAndBResponseSchema,
  },
  tool_b: {
    requestSchema: toolBInputSchema,
    responseSchema: toolAAndBResponseSchema,
  },
};
