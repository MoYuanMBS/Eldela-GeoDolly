/**
 * `config/app.yaml` 的 TypeScript 配置加载器。
 *
 * 当前使用 `yaml` 包解析 YAML，
 * 但 TypeScript 只校验并缓存自己实际使用的配置分段。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type { ZodType } from "zod";
import { parse } from "yaml";

import { toolPromptsConfigSchema, type ToolPromptsConfigType } from "../models/config-models.js";

const APP_CONFIG_PATH = path.join(process.cwd(), "config", "app.yaml");

let cachedRawAppConfig: unknown = null;
const cachedConfigSections = new Map<string, unknown>();

function loadRawAppConfig(): unknown {
  // 每次都从磁盘读取并重新解析 `config/app.yaml`。
  const rawYaml = readFileSync(APP_CONFIG_PATH, "utf8");
  return parse(rawYaml) as unknown;
}

function getRawAppConfig(): unknown {
  // 整份 YAML 只在当前进程中解析一次，供不同 section 复用。
  if (cachedRawAppConfig !== null) {
    return cachedRawAppConfig;
  }

  cachedRawAppConfig = loadRawAppConfig();
  return cachedRawAppConfig;
}

function getConfigSectionType<T>(sectionName: string, sectionSchema: ZodType<T>): T {
  // 每个 section 在 TS 侧独立校验并独立缓存，避免耦合整份 app 配置结构。
  if (cachedConfigSections.has(sectionName)) {
    return cachedConfigSections.get(sectionName) as T;
  }
  const rawAppConfig = getRawAppConfig() as Record<string, unknown>;
  const parsedSection = sectionSchema.parse(rawAppConfig[sectionName]);
  cachedConfigSections.set(sectionName, parsedSection);
  return parsedSection;
}

export function getToolPromptsConfig(): ToolPromptsConfigType {
  return getConfigSectionType("prompts", toolPromptsConfigSchema);
}

export function resetAppConfigCache(): void {
  // 测试场景下允许主动清空原始 YAML 与各 section 缓存。
  cachedRawAppConfig = null;
  cachedConfigSections.clear();
}
