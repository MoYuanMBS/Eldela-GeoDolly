/**
 * TypeScript 消费的部署配置加载器。
 *
 * 当前使用 `yaml` 包解析 YAML，
 * 但 TypeScript 只校验并缓存自己实际使用的 app section、web service 配置与 basemap registry。
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ZodType } from "zod";
import { parse } from "yaml";
import {basemapProfileRegistrySchema, type BasemapProfileRegistryType} from "../models/common/basemap-models.js";
import {basemapConfigSchema, browserMapConfigSchema, featureIdDisplayConfigSchema, iframeAdaptiveConfigSchema, leafletConfigSchema, toolPromptsConfigSchema, uiConfigSchema, webConfigSchema, type WebConfigType} from "../models/backend/config-models.js";
import {AppError} from "./app-error.js";

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
  private cachedBasemapProfiles: BasemapProfileRegistryType | null = null;
  private cachedWebConfig: WebConfigType | null = null;

  /**
   * 在 MCP Server 注册工具前预载当前 TypeScript 会消费的全部配置。
   * 各业务模块仍通过原 getter 读取同一份已校验缓存，不在 Tool 调用期间重新解析 YAML。
   */
  initialize(): void {
    this.getAppSection("prompts", toolPromptsConfigSchema);
    this.getAppSection("feature_id", featureIdDisplayConfigSchema);
    this.getAppSection("iframe_adaptive", iframeAdaptiveConfigSchema);
    this.getAppSection("browser_map", browserMapConfigSchema);
    this.getAppSection("ui", uiConfigSchema);
    this.getAppSection("basemap", basemapConfigSchema);
    this.getAppSection("leaflet", leafletConfigSchema);
    this.getWebConfig();
    this.getAvailableExpertNames();
    this.getBasemapProfiles();
  }

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

  /** 读取、校验并缓存完整的 `config/tiles.yaml` 在线 raster profile registry。 */
  getBasemapProfiles(): BasemapProfileRegistryType {
    if (this.cachedBasemapProfiles !== null) {
      return this.cachedBasemapProfiles;
    }

    const tilesPath = path.join(this.configDirPath, "tiles.yaml");
    if (!existsSync(tilesPath)) {
      throw new AppError("config_not_found", `config file not found: ${tilesPath}`);
    }
    try {
      this.cachedBasemapProfiles = basemapProfileRegistrySchema.parse(loadYamlFile(tilesPath));
      return this.cachedBasemapProfiles;
    } catch (error) {
      throw AppError.fromUnknown(error, "invalid_config", `Failed to load basemap profiles from ${tilesPath}`);
    }
  }

  /**
   * 读取、校验并缓存独立 `config/web.yaml` 中的共享 HTTP service 配置。
   * warning 独立进程可以只调用此 getter，不会连带初始化 MCP Tool 与地图渲染配置。
   */
  getWebConfig(): WebConfigType {
    if (this.cachedWebConfig !== null) {
      return this.cachedWebConfig;
    }

    const webConfigPath = path.join(this.configDirPath, "web.yaml");
    if (!existsSync(webConfigPath)) {
      throw new AppError("config_not_found", `config file not found: ${webConfigPath}`);
    }
    try {
      this.cachedWebConfig = webConfigSchema.parse(loadYamlFile(webConfigPath));
      return this.cachedWebConfig;
    } catch (error) {
      throw AppError.fromUnknown(error, "invalid_config", `Failed to load web config from ${webConfigPath}`);
    }
  }

  /**
   * 清空当前实例持有的配置缓存。
   */
  resetCache(): void {
    this.cachedAvailableExpertNames = null;
    this.cachedBasemapProfiles = null;
    this.cachedWebConfig = null;
    this.cachedConfigSections.clear();
  }
}

// 业务模块共享同一实例，避免每次 Tool 调用重复读取配置文件。
export const config = new ConfigLoader();
