/**
 * `config/app.yaml` 的 TypeScript 配置加载器。
 *
 * 当前使用 `yaml` 包解析 YAML，
 * 但 TypeScript 只校验并缓存自己实际使用的配置分段。
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ZodType } from "zod";
import { parse } from "yaml";

const configDirPath = path.join(process.cwd(), "config");

// app.yaml 原始解析结果只作为 section 校验的临时输入，不作为长期业务对象暴露。
let cachedRawAppConfig: unknown = null;

// TS 侧按 section 缓存已经通过 Zod 校验的配置，避免每次 tool 调用重复解析 app.yaml。
const cachedConfigSections = new Map<string, unknown>();
let cachedAvailableExpertNames: Set<string> | null = null;

/**
 * 读取并解析 `config/app.yaml` 原始内容。
 */
function getRawAppConfig(): unknown {
  // 整份 YAML 只在当前进程中解析一次，供不同 section 复用。
  if (cachedRawAppConfig !== null) {
    return cachedRawAppConfig;
  }
  cachedRawAppConfig = parse(readFileSync(path.join(configDirPath, "app.yaml"), "utf8")) as unknown;
  return cachedRawAppConfig;
}

/**
 * 读取、校验并缓存 `config/app.yaml` 中的指定 section。
 *
 * @param sectionName `app.yaml` 顶层 section 名称，例如 `prompts`
 * @param sectionSchema 对应 section 的 Zod schema
 * @returns 已通过 Zod 校验的 section 配置
 */
export function getConfigSectionType<T>(sectionName: string, sectionSchema: ZodType<T>): T {
  // 每个 section 在 TS 侧独立校验并独立缓存，避免耦合整份 app 配置结构。
  if (cachedConfigSections.has(sectionName)) {
    return cachedConfigSections.get(sectionName) as T;
  }
  const rawAppConfig = getRawAppConfig() as Record<string, unknown>;
  const parsedSection = sectionSchema.parse(rawAppConfig[sectionName]);
  cachedConfigSections.set(sectionName, parsedSection);
  cachedRawAppConfig = null; // 解析完各 section 后原始 YAML 配置不再需要，允许 GC 回收。
  return parsedSection;
}

/**
 * 获取当前可用于 prompt 展示 / 请求过滤的专家名称集合。
 */
export function getAvailableExpertNames(): Set<string> {
  if (cachedAvailableExpertNames === null) {
    const expertDirPath = path.join(configDirPath, "expert");
    const expertsPath = path.join(configDirPath, "experts.yaml");
    const expertNames = new Set<string>();

    // 单专家文件优先级高于 experts.yaml，但 prompt 侧只需要可用名称并集。
    if (existsSync(expertDirPath)) {
      for (const file of readdirSync(expertDirPath, { withFileTypes: true })) {
        if (!file.isFile()) continue;
        if (!file.name.endsWith(".yaml")) continue;
        expertNames.add(path.basename(file.name, ".yaml"));
      }
    }

    // experts.yaml 是兼容 fallback；其顶层 key 同样是专家名称。
    if (existsSync(expertsPath)) {
      const expertsConfig = parse(readFileSync(expertsPath, "utf8")) as Record<string, unknown>;
      for (const expertName of Object.keys(expertsConfig)) {
        expertNames.add(expertName);
      }
    }
    cachedAvailableExpertNames = expertNames;
    return expertNames;
  } else { return cachedAvailableExpertNames; }
}

/**
 * 过滤调用方传入的专家名称列表，只保留当前配置中存在的专家。
 */
export function filterAvailableExpertNames(expertNames: Array<string>): Array<string> {
  const filteredExpertNames: Array<string> = [];
  const availableExpertNames = getAvailableExpertNames();

  // 保留调用方传入顺序，同时过滤未知专家并去重。
  for (const expertName of expertNames) {
    if (availableExpertNames.has(expertName) && !filteredExpertNames.includes(expertName)) {
      filteredExpertNames.push(expertName);
    }
  }
  return filteredExpertNames;
}

/**
 * 清空 TS 侧 app config 缓存
 */
export function resetAppConfigCache(): void {
  // 测试场景下允许主动清空原始 YAML 与各 section 缓存。
  cachedRawAppConfig = null;
  cachedAvailableExpertNames = null;
  cachedConfigSections.clear();
}
