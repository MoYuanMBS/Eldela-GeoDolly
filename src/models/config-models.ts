/**
 * Current authority source: doc/GeoMCP 技术规范文档.md
 *
 * TypeScript 侧实际会用到的配置模型。
 */

import { z } from "zod";

export const toolPromptConfigSchema = z
  .object({
    title: z.string(),
    description: z.string(),
  })
  .strict();

export const toolPromptsConfigSchema = z
  .object({
    location_search: toolPromptConfigSchema,
    tool_a: toolPromptConfigSchema,
    tool_b: toolPromptConfigSchema,
  })
  .strict();

export type ToolPromptConfigType = z.infer<typeof toolPromptConfigSchema>;
export type ToolPromptsConfigType = z.infer<typeof toolPromptsConfigSchema>;

