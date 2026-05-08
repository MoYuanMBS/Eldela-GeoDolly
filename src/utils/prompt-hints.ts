/**
 * Tool description 动态提示片段构建工具。
 * 这些 helper 只负责把运行时配置值整理成给 AI / MCP client 看的说明文字；
 */

import { type ToolPromptsConfigType, toolPromptsConfigSchema} from "../models/config-models.js";
import { getAvailableExpertNames, getConfigSectionType} from "./config-loader.js";

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
 * - basemap 后续若改成动态配置，应在本函数中按 tool_a / tool_b 分别追加，而不是改 index.ts。
 */
export function getToolPromptsConfigWithHints(): ToolPromptsConfigType {
  const toolPromptsConfig = getConfigSectionType("prompts", toolPromptsConfigSchema);
  const toolBExpertHint = buildChoiceFieldHint({
    fieldName: "attention_experts",
    values: getAvailableExpertNames(),
    usage: "when a matching facility / area expert category is relevant",
  });

  return {
    ...toolPromptsConfig,
    tool_a: {
      ...toolPromptsConfig.tool_a,
      description: appendDescriptionHints(toolPromptsConfig.tool_a.description, [
        // Reserved for future dynamic basemap hints.
      ]),
    },
    tool_b: {
      ...toolPromptsConfig.tool_b,
      description: appendDescriptionHints(toolPromptsConfig.tool_b.description, [
        toolBExpertHint,
        // Reserved for future dynamic basemap hints.
      ]),
    },
  };
}
