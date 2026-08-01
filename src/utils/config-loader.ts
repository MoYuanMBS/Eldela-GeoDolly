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
import {
  userCssStyleRuleConfigSchema,
  userCssStyleRulesDocumentSchema,
  type UserCssStyleRuleConfig,
} from "../models/style/user-css-style-models.js";
import {logger} from "./logger.js";

/**
 * 读取单个 YAML 文件；raw 数据只用于当次 schema 构建，不进入 loader 缓存。
 */
function loadYamlFile(filePath: string): unknown {
  return parse(readFileSync(filePath, "utf8")) as unknown;
}

export class ConfigLoader {
  private readonly configDirPath = path.join(process.cwd(), "config");
  private readonly cachedConfigSections = new Map<string, unknown>();
  private cachedAvailableExpertNames: Set<string> | null = null;
  private cachedUserStyleRules: ReadonlyArray<UserCssStyleRuleConfig> | null = null;

  /**
   * 读取、校验并缓存 `config/app.yaml` 中的指定 section。
   *
   * @param sectionName `app.yaml` 顶层 section 名称，例如 `prompts`
   * @param sectionSchema 对应 section 的 Zod schema
   * @returns 已通过 Zod 校验的 section 配置
   */
  getAppSection<T>(sectionName: string, sectionSchema: ZodType<T>): T {
    // 每个 section 独立校验和缓存，业务模块只会拿到与自身相关的已校验配置。
    if (this.cachedConfigSections.has(sectionName)) {
      return this.cachedConfigSections.get(sectionName) as T;
    }
    const rawAppConfig = loadYamlFile(path.join(this.configDirPath, "app.yaml")) as Record<string, unknown>;
    const parsedSection = sectionSchema.parse(rawAppConfig[sectionName]);
    this.cachedConfigSections.set(sectionName, parsedSection);
    return parsedSection;
  }

  /**
   * 获取当前可用于 prompt 展示 / 请求过滤的专家名称集合。
   */
  getAvailableExpertNames(): Set<string> {
    if (this.cachedAvailableExpertNames !== null) {
      return this.cachedAvailableExpertNames;
    }

    const expertDirPath = path.join(this.configDirPath, "expert");
    const expertsPath = path.join(this.configDirPath, "experts.yaml");
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
      const expertsConfig = loadYamlFile(expertsPath) as Record<string, unknown>;
      for (const expertName of Object.keys(expertsConfig)) {
        expertNames.add(expertName);
      }
    }
    this.cachedAvailableExpertNames = expertNames;
    return expertNames;
  }

  /**
   * 过滤调用方传入的专家名称列表，只保留当前配置中存在的专家。
   */
  filterAvailableExpertNames(expertNames: Array<string>): Array<string> {
    const filteredExpertNames: Array<string> = [];
    const availableExpertNames = this.getAvailableExpertNames();

    // 保留调用方传入顺序，同时过滤未知专家并去重。
    for (const expertName of expertNames) {
      if (availableExpertNames.has(expertName) && !filteredExpertNames.includes(expertName)) {
        filteredExpertNames.push(expertName);
      }
    }
    return filteredExpertNames;
  }

  /** 只加载用户 tag rule 配置；regex 编译和 CSS 对照由 resolver 负责。 */
  getUserStyleRules(): ReadonlyArray<UserCssStyleRuleConfig> {
    if (this.cachedUserStyleRules !== null) return this.cachedUserStyleRules;
    const rulesPath = path.join(this.configDirPath, "style", "style-rules.yaml");
    // 用户规则可选；缺失时保留内置样式路径，不产生配置错误。
    if (!existsSync(rulesPath)) {
      this.cachedUserStyleRules = [];
      return this.cachedUserStyleRules;
    }

    const rawDocument = userCssStyleRulesDocumentSchema.parse(loadYamlFile(rulesPath));
    const loadedRules: Array<UserCssStyleRuleConfig> = [];
    // 顶层文档错误直接抛出；单条 rule 可跳过，且这里不编译 regex、不读取 CSS。
    for (const [ruleIndex, rawRule] of rawDocument.rules.entries()) {
      const parsedRule = userCssStyleRuleConfigSchema.safeParse(rawRule);
      if (!parsedRule.success) {
        logger.warning("skip_invalid_user_css_style_rule", {rule_index: ruleIndex, reason: parsedRule.error.message});
        continue;
      }
      loadedRules.push(parsedRule.data);
    }
    this.cachedUserStyleRules = loadedRules;
    return this.cachedUserStyleRules;
  }

  /** 最终样式缓存建立后释放 raw YAML rule，其他配置缓存不受影响。 */
  clearUserStyleRulesCache(): void {
    this.cachedUserStyleRules = null;
  }

  /**
   * 清空当前实例持有的配置缓存。
   */
  resetCache(): void {
    this.cachedAvailableExpertNames = null;
    this.cachedUserStyleRules = null;
    this.cachedConfigSections.clear();
  }
}

// 业务模块共享同一实例，避免每次 Tool 调用重复读取配置文件。
export const config = new ConfigLoader();
