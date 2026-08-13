/**
 * Tool description 动态提示片段构建工具。
 * 这些 helper 只负责把运行时配置值整理成给 AI / MCP client 看的说明文字；
 */

import { type ToolPromptsConfigType, toolPromptsConfigSchema} from "../models/config-models.js";
import { config } from "./config-loader.js";

export type ChoiceFieldHintOptions = {
  fieldName: string;
  values: Iterable<string>;
  usage: string;
  emptyInstruction?: string;
};

/**
 * 为“字段只能/应当填写某些配置值”的场景构造说明片段。
 */
function buildChoiceFieldHint(options: ChoiceFieldHintOptions): string {
  const values = [...options.values];

  if (values.length === 0) {
    return options.emptyInstruction ?? `No configured values are available for "${options.fieldName}". Leave it empty.`;
  }

  return [
    `Set "${options.fieldName}" to one of the configured values ${options.usage}:`,
    values.join(", "),
    `If none apply, leave "${options.fieldName}" empty.`,
  ].join("\n");
}

/** 为必填 basemap 字段列出当前部署已经缓存的 profile ID 与展示名称。 */
function buildBasemapProfileHint(): string {
  const profiles = Object.entries(config.getBasemapProfiles());
  return [
    'Set "basemap" to exactly one configured profile ID:',
    ...profiles.map(([profileId, profile]) => `- ${profileId}: ${profile.name}`),
  ].join("\n");
}

/**
 * 把一个或多个动态提示片段追加到原始 tool description 后。
 */
function appendDescriptionHints(description: string, hints: Array<string>): string {
  const nonEmptyHints = hints.filter((hint) => hint.trim().length > 0);
  return nonEmptyHints.length === 0 ? description : [description, ...nonEmptyHints].join("\n\n");
}

/**
 * 读取基础 tool prompt 配置，并把运行时动态提示写入 tool description。
 *
 * 当前约束：
 * - location_search 只负责候选地点搜索，不接收 attention_experts / basemap 动态提示。
 * - tool_a 暂不提示 attention_experts；即使 schema 允许该字段，业务上也不鼓励 AI 填写。
 * - tool_b 使用 attention_experts 选择专家分类，因此只给 tool_b 追加 expert hint。
 * - tool_a / tool_b 都要求显式选择 basemap，因此共享当前 profile registry 提示。
 */
export function getToolPromptsConfigWithHints(): ToolPromptsConfigType {
  const toolPromptsConfig = config.getAppSection("prompts", toolPromptsConfigSchema);
  const basemapProfileHint = buildBasemapProfileHint();
  const toolBExpertHint = buildChoiceFieldHint({
    fieldName: "attention_experts",
    values: config.getAvailableExpertNames(),
    usage: "when a matching facility / area expert category is relevant",
  });

  return {
    ...toolPromptsConfig,
    tool_a: {
      ...toolPromptsConfig.tool_a,
      description: appendDescriptionHints(toolPromptsConfig.tool_a.description, [basemapProfileHint]),
    },
    tool_b: {
      ...toolPromptsConfig.tool_b,
      description: appendDescriptionHints(toolPromptsConfig.tool_b.description, [
        toolBExpertHint,
        basemapProfileHint,
      ]),
    },
  };
}
