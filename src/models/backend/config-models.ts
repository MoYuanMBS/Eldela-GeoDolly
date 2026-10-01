/**
 * Current authority source: doc/GeoMCP 技术规范文档.md
 *
 * TypeScript 侧实际会用到的配置模型。
 */

import {isIP} from "node:net";
import { z } from "zod";
import {logger} from "../../server/utils/logger.js";
import {UI_BUILT_IN_CONFIG} from "../../shared/ui.js";
import {iframePaddingConfigSchema, leafletConfigSchema} from "../mapsurface/map-config-models.js";

export {iframePaddingConfigSchema, leafletConfigSchema} from "../mapsurface/map-config-models.js";
export type {IframePaddingConfigType, LeafletConfigType} from "../mapsurface/map-config-models.js";

// MCP Tool 的展示文案；这里只接受当前三个固定工具，避免配置拼写错误被静默忽略。
export const toolPromptConfigSchema = z.object({
  title: z.string(),
  description: z.string(),
}).strict();
export const toolPromptsConfigSchema = z.object({
  location_search: toolPromptConfigSchema,
  tool_a: toolPromptConfigSchema,
  tool_b: toolPromptConfigSchema,
}).strict();

export type ChoiceFieldHintOptions = {
  fieldName: string;
  values: Iterable<string>;
  usage: string;
  emptyInstruction?: string;
};



//#########################feature_id###############################

// default_skin 是内建回退值，不允许在自定义皮肤表中重复声明。
const DEFAULT_FEATURE_ID_SKIN = "default_skin";
const customFeatureIdSkinNameSchema = z
  .string()
  .min(1)
  .refine((skinName) => skinName !== DEFAULT_FEATURE_ID_SKIN, {message: `${DEFAULT_FEATURE_ID_SKIN} is reserved and cannot be used as a custom skin name`,});

const featureIdSkinSelectionSchema = z.union([
  z.literal(DEFAULT_FEATURE_ID_SKIN),
  customFeatureIdSkinNameSchema,
]);

// 标量写法表示两组都使用默认皮肤；对象写法允许 alphabet 与 digits 独立搭配。
// transform 后消费者始终拿到完整的两字段对象，不需要再次处理缺省值。
export const activeFeatureIdSkinsSchema = z
  .union([
    z.literal(DEFAULT_FEATURE_ID_SKIN),
    z.object({
      alphabet: featureIdSkinSelectionSchema.optional(),
      digits: featureIdSkinSelectionSchema.optional(),
    }).strict(),
  ])
  .default(DEFAULT_FEATURE_ID_SKIN)
  .transform((activeSkins) => {
    if (activeSkins === DEFAULT_FEATURE_ID_SKIN) {
      return {alphabet: DEFAULT_FEATURE_ID_SKIN, digits: DEFAULT_FEATURE_ID_SKIN} as const;
    }
    return {
      alphabet: activeSkins.alphabet ?? DEFAULT_FEATURE_ID_SKIN,
      digits: activeSkins.digits ?? DEFAULT_FEATURE_ID_SKIN,
    };
  });

// skins 整体及其分组均可省略；loader 输出统一为空表，方便后续直接索引。
const featureIdSkinRegistrySchema = z.record(customFeatureIdSkinNameSchema, z.string().min(1)).default({});
export const featureIdRenderConfigSchema = z
  .object({
    active_skins: activeFeatureIdSkinsSchema,
    skins: z.object({
      alphabet: featureIdSkinRegistrySchema.optional().default({}),
      digits: featureIdSkinRegistrySchema.optional().default({}),
    }).strict().optional().default({alphabet: {}, digits: {}}),
  })
  .strict()
  .superRefine((renderConfig, context) => {
    // 自定义 active skin 必须已在对应分组注册，alphabet 与 digits 不交叉查找。
    for (const skinType of ["alphabet", "digits"] as const) {
      const activeSkin = renderConfig.active_skins[skinType];
      if (activeSkin !== DEFAULT_FEATURE_ID_SKIN && renderConfig.skins[skinType][activeSkin] === undefined) {
        context.addIssue({
          code: "custom",
          message: `active ${skinType} skin not found: ${activeSkin}`,
          path: ["active_skins", skinType],
        });
      }
    }
  });

// display ID 的字母池统一转为大写 ASCII，并禁止重复字符造成反向映射歧义。
const featureIdAlphabetPoolSchema = z
  .string()
  .trim()
  .min(1)
  .transform((alphabetPool) => alphabetPool.toUpperCase())
  .pipe(
    z
      .string()
      .regex(/^[A-Z]+$/, "feature ID alphabet_pool must contain only ASCII A-Z")
      .refine((alphabetPool) => new Set(alphabetPool).size === alphabetPool.length, {
        message: "feature ID alphabet_pool must not contain duplicate characters",
      }),
  );

// id_scheme 由 Python 消费；本模型只提取并校验 TypeScript display ID 所需字段。
export const featureIdDisplayConfigSchema = z
  .object({
    alphabet_pool: featureIdAlphabetPoolSchema,
    render: featureIdRenderConfigSchema,
  })
  .superRefine((featureIdConfig, context) => {
    // Array.from 按 Unicode code point 计数，适配干支、中文数字等非 ASCII 皮肤。
    const alphabetLength = Array.from(featureIdConfig.alphabet_pool).length;
    for (const [skinName, skin] of Object.entries(featureIdConfig.render.skins.alphabet)) {
      const characters = Array.from(skin);
      if (characters.length !== alphabetLength) {
        context.addIssue({
          code: "custom",
          message: `alphabet skin must contain ${alphabetLength} characters`,
          path: ["render", "skins", "alphabet", skinName],
        });
      } else if (new Set(characters).size !== characters.length) {
        context.addIssue({
          code: "custom",
          message: "alphabet skin must not contain duplicate characters",
          path: ["render", "skins", "alphabet", skinName],
        });
      }
    }
    for (const [skinName, skin] of Object.entries(featureIdConfig.render.skins.digits)) {
      const characters = Array.from(skin);
      if (characters.length !== 10) {
        context.addIssue({
          code: "custom",
          message: "digits skin must contain 10 characters",
          path: ["render", "skins", "digits", skinName],
        });
      } else if (new Set(characters).size !== characters.length) {
        context.addIssue({
          code: "custom",
          message: "digits skin must not contain duplicate characters",
          path: ["render", "skins", "digits", skinName],
        });
      }
    }
  });

//#########################iframe adaptive###############################

// 参考面积和比例允许浮点数；所有 CSS 尺寸与像素预算都是正整数。
const positiveFiniteNumberSchema = z.number().finite().positive();
const positiveIntegerSchema = z.number().int().positive();
const nonNegativeIntegerSchema = z.number().int().nonnegative();

// TypeScript 对同一个 iframe_adaptive section 只使用这一份完整 schema；Python 专用权重由 Zod 剥离。
const iframeAdaptiveRawConfigSchema = z.object({
  // MapSurface 四条硬尺寸边界。
  min_screenshot_width: positiveIntegerSchema,
  max_screenshot_width: positiveIntegerSchema,
  min_screenshot_height: positiveIntegerSchema,
  max_screenshot_height: positiveIntegerSchema,
  // 独立像素预算用于限制宽高组合，而不只限制单边尺寸。
  max_screenshot_pixels: positiveIntegerSchema,
  // 参考面积乘以 Python factor 得到本次建议面积。
  reference_screenshot_area: positiveFiniteNumberSchema,
  // 投影 bbox 比例会被钳制在此范围，避免极端狭长画布。
  min_aspect_ratio: positiveFiniteNumberSchema,
  max_aspect_ratio: positiveFiniteNumberSchema,
  padding: iframePaddingConfigSchema,
  min_map_display_width: positiveIntegerSchema,
  min_map_display_height: positiveIntegerSchema,
});

type IframeAdaptiveRawConfigType = z.infer<typeof iframeAdaptiveRawConfigSchema>;

function normalizeIframeAdaptiveConfig(adaptiveConfig: IframeAdaptiveRawConfigType): IframeAdaptiveRawConfigType {
  const minMapDisplayWidth = Math.max(adaptiveConfig.min_map_display_width, UI_BUILT_IN_CONFIG.referenceUi.minWidth);
  const minScreenshotWidth = Math.max(adaptiveConfig.min_screenshot_width, minMapDisplayWidth);
  const minScreenshotHeight = Math.max(adaptiveConfig.min_screenshot_height, adaptiveConfig.min_map_display_height);
  let maxScreenshotWidth = Math.max(adaptiveConfig.max_screenshot_width, minScreenshotWidth);
  let maxScreenshotHeight = Math.max(adaptiveConfig.max_screenshot_height, minScreenshotHeight);
  let maxScreenshotPixels = Math.max(adaptiveConfig.max_screenshot_pixels, Math.ceil(adaptiveConfig.reference_screenshot_area));

  // 比例范围端点必须能容纳整数 MapSurface；相关 max 约束不足时统一上调，不让可恢复配置阻止启动。
  for (const aspectRatio of [adaptiveConfig.min_aspect_ratio, adaptiveConfig.max_aspect_ratio]) {
    const requiredHeight = Math.ceil(Math.max(minScreenshotHeight, minScreenshotWidth / aspectRatio));
    const requiredWidth = Math.ceil(requiredHeight * aspectRatio);
    maxScreenshotWidth = Math.max(maxScreenshotWidth, requiredWidth);
    maxScreenshotHeight = Math.max(maxScreenshotHeight, requiredHeight);
    maxScreenshotPixels = Math.max(maxScreenshotPixels, requiredWidth * requiredHeight);
  }

  return {
    ...adaptiveConfig,
    min_map_display_width: minMapDisplayWidth,
    min_screenshot_width: minScreenshotWidth,
    min_screenshot_height: minScreenshotHeight,
    max_screenshot_width: maxScreenshotWidth,
    max_screenshot_height: maxScreenshotHeight,
    max_screenshot_pixels: maxScreenshotPixels,
  };
}

export const iframeAdaptiveConfigSchema = iframeAdaptiveRawConfigSchema.superRefine((adaptiveConfig, context) => {
  if (adaptiveConfig.min_aspect_ratio > adaptiveConfig.max_aspect_ratio) {
    context.addIssue({code: "custom", message: "min_aspect_ratio must not exceed max_aspect_ratio", path: ["min_aspect_ratio"]});
    return;
  }

  const normalizedConfig = normalizeIframeAdaptiveConfig(adaptiveConfig);
  if (normalizedConfig.padding.left + normalizedConfig.padding.right >= normalizedConfig.min_screenshot_width) {
    context.addIssue({code: "custom", message: "horizontal padding must leave positive MapSurface width", path: ["padding"]});
  }
  if (normalizedConfig.padding.top + normalizedConfig.padding.bottom >= normalizedConfig.min_screenshot_height) {
    context.addIssue({code: "custom", message: "vertical padding must leave positive MapSurface height", path: ["padding"]});
  }

  for (const field of ["min_map_display_width", "min_screenshot_width", "min_screenshot_height", "max_screenshot_width", "max_screenshot_height", "max_screenshot_pixels"] as const) {
    if (!Number.isSafeInteger(normalizedConfig[field])) {
      context.addIssue({code: "custom", message: `${field} exceeds the safe integer range after normalization`, path: [field]});
    }
  }
}).transform((adaptiveConfig) => {
  const normalizedConfig = normalizeIframeAdaptiveConfig(adaptiveConfig);
  if (normalizedConfig.min_map_display_width !== adaptiveConfig.min_map_display_width) {
    logger.warning("min_map_display_width_clamped", {configured_width: adaptiveConfig.min_map_display_width, reference_ui_min_width: UI_BUILT_IN_CONFIG.referenceUi.minWidth});
  }
  if (normalizedConfig.min_screenshot_width !== adaptiveConfig.min_screenshot_width) {
    logger.warning("min_screenshot_width_raised", {configured_width: adaptiveConfig.min_screenshot_width, effective_width: normalizedConfig.min_screenshot_width});
  }
  if (normalizedConfig.min_screenshot_height !== adaptiveConfig.min_screenshot_height) {
    logger.warning("min_screenshot_height_raised", {configured_height: adaptiveConfig.min_screenshot_height, effective_height: normalizedConfig.min_screenshot_height});
  }
  if (normalizedConfig.max_screenshot_width !== adaptiveConfig.max_screenshot_width) {
    logger.warning("max_screenshot_width_raised", {configured_width: adaptiveConfig.max_screenshot_width, effective_width: normalizedConfig.max_screenshot_width});
  }
  if (normalizedConfig.max_screenshot_height !== adaptiveConfig.max_screenshot_height) {
    logger.warning("max_screenshot_height_raised", {configured_height: adaptiveConfig.max_screenshot_height, effective_height: normalizedConfig.max_screenshot_height});
  }
  if (normalizedConfig.max_screenshot_pixels !== adaptiveConfig.max_screenshot_pixels) {
    logger.warning("max_screenshot_pixels_raised", {configured_pixels: adaptiveConfig.max_screenshot_pixels, effective_pixels: normalizedConfig.max_screenshot_pixels});
  }
  return normalizedConfig;
});

//#########################browser map flow###############################

export const browserMapConfigSchema = z.object({
  ready_timeout_seconds: positiveFiniteNumberSchema,
}).strict();

//#########################MCP Apps###############################

export const mcpAppsConfigSchema = z.object({
  interactive_map_launcher: z.object({
    preferred_height_px: positiveIntegerSchema,
    load_notice_delay_ms: nonNegativeIntegerSchema.max(2_147_483_647),
  }).strict(),
}).strict();

//#########################browser UI###############################

/** Browser UI 的部署配置；平铺保存彼此独立的公开尺寸参数。 */
export const uiConfigSchema = z.object({
  decorations_enabled: z.boolean(),
  max_scale_width_px: positiveIntegerSchema,
  feature_ui_max_height_px: positiveIntegerSchema,
  measurement_preview_refresh_interval_ms: positiveIntegerSchema,
}).strict();

//#########################basemap endpoint###############################

export const basemapConfigSchema = z.object({
  /** GeoMCP 请求上游 provider 时使用的部署标识。 */
  user_agent: z.string().trim().min(1),
  /** 单次上游瓦片请求的服务端超时秒数。 */
  upstream_timeout_seconds: positiveFiniteNumberSchema,
  // 只用于 Snapshot 固定首屏；0 允许空底图，1 要求全部所需瓦片成功。
  snapshot_min_tile_success_ratio: z.number().finite().min(0).max(1),
}).strict();

/** 部署级输出总开关；具体请求仍需同时显式启用对应输出。 */
export const outputConfigSchema = z.object({
  allow_overlay_geojson: z.boolean(),
}).strict();

//#########################shared HTTP services###############################

/** MCP 与地图共用公开基础地址；协议由 Host 类型决定，部署路径前缀保留。 */
const publicOriginSchema = z.string().trim().min(1)
  .transform((value) => value.includes("://") ? value : `http://${value}`)
  .pipe(z.url({protocol: /^https?$/, normalize: true}))
  .transform((value) => new URL(value))
  .refine((url) => !url.username && !url.password && !url.search && !url.hash, "public_origin must not contain credentials, query, or fragment")
  .refine((url) => url.hostname !== "0.0.0.0" && url.hostname !== "[::]", "public_origin must not use a wildcard bind address")
  .refine((url) => {
    // 路由和 HTML 会使用这个前缀，拒绝转义后改变路径分段或 HTML 属性的字符。
    try {
      const pathname = decodeURIComponent(url.pathname);
      return !/[\\\s<>"'&?#\u0000-\u001f]/u.test(pathname) && !/%2f/iu.test(url.pathname);
    } catch {
      return false;
    }
  }, "public_origin path must contain safe URL path segments")
  .transform((url) => {
    const hostname = url.hostname.replace(/^\[|\]$/gu, "");
    url.protocol = hostname === "localhost" || isIP(hostname) !== 0 ? "http:" : "https:";
    return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
  });

export const mapHttpConfigSchema = z.object({
  port: positiveIntegerSchema.max(65535),
  public_origin: publicOriginSchema,
}).strict();

export const toolExecutionConfigSchema = z.object({
  max_workers: positiveIntegerSchema,
  // 0 明确表示没有等待队列；worker 全忙时立即返回 busy。
  max_queue_length: nonNegativeIntegerSchema,
  timeout_seconds: positiveFiniteNumberSchema,
}).strict();

export const sessionConfigSchema = z.object({
  ttl_seconds: positiveFiniteNumberSchema,
  expiry_check_interval_seconds: positiveFiniteNumberSchema,
  flush_interval_seconds: positiveFiniteNumberSchema,
  max_timer_delay_ms: positiveIntegerSchema,
}).strict();

export const snapshotConfigSchema = z.object({
  // 完整 wrapper 包含 MapSurface 与完成布局后的 Reference UI；当前 DPR 固定为 1。
  max_wrapper_physical_pixels: positiveIntegerSchema,
}).strict();

/** 独立 web.yaml；所有 HTTP、调度、Session 与 Headless Snapshot 部署值都在启动时严格校验。 */
export const webConfigSchema = z.object({
  http: z.object({
    /** MCP/地图公开入口与独立 warning service 的监听地址。 */
    listen_host: z.string().trim().min(1),
    warning: z.object({
      port: positiveIntegerSchema.max(65535),
      /** 在 JSON 解析前拒绝过大的 warning 请求，避免诊断通道消耗无界内存。 */
      max_body_bytes: positiveIntegerSchema,
      /** 全局限流只限制恶意/异常洪泛；Browser 仍按页面生命周期独立去重。 */
      rate_limit_window_seconds: positiveIntegerSchema,
      max_requests_per_window: positiveIntegerSchema,
    }).strict(),
    map: mapHttpConfigSchema,
    tls: z.object({
      cert_file: z.string().trim().min(1).default("config/key/fullchain.pem"),
      key_file: z.string().trim().min(1).default("config/key/privkey.pem"),
    }).strict().default({cert_file: "config/key/fullchain.pem", key_file: "config/key/privkey.pem"}),
  }).strict(),
  tool_execution: toolExecutionConfigSchema,
  session: sessionConfigSchema,
  snapshot: snapshotConfigSchema,
}).strict();

// 业务层类型全部从 schema 推导，避免配置模型与运行时校验规则分叉。
export type ToolPromptConfigType = z.infer<typeof toolPromptConfigSchema>;
export type ToolPromptsConfigType = z.infer<typeof toolPromptsConfigSchema>;
export type ActiveFeatureIdSkinsType = z.infer<typeof activeFeatureIdSkinsSchema>;
export type FeatureIdRenderConfigType = z.infer<typeof featureIdRenderConfigSchema>;
export type FeatureIdDisplayConfigType = z.infer<typeof featureIdDisplayConfigSchema>;
export type IframeAdaptiveConfigType = z.infer<typeof iframeAdaptiveConfigSchema>;
export type BrowserMapConfigType = z.infer<typeof browserMapConfigSchema>;
export type UiConfigType = z.infer<typeof uiConfigSchema>;
export type BasemapConfigType = z.infer<typeof basemapConfigSchema>;
export type MapHttpConfigType = z.infer<typeof mapHttpConfigSchema>;
export type ToolExecutionConfigType = z.infer<typeof toolExecutionConfigSchema>;
export type SessionConfigType = z.infer<typeof sessionConfigSchema>;
export type SnapshotConfigType = z.infer<typeof snapshotConfigSchema>;
export type WebConfigType = z.infer<typeof webConfigSchema>;
