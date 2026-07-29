/**
 * Current authority source: doc/GeoMCP 技术规范文档.md
 *
 * TypeScript 侧实际会用到的配置模型。
 */

import { z } from "zod";

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

//#########################iframe capture###############################

// 参考面积和比例允许浮点数；CSS 尺寸与像素预算必须是正整数。
const positiveFiniteNumberSchema = z.number().finite().positive();
const positiveIntegerSchema = z.number().int().positive();

// 只提取 TS 截图尺寸算法需要的字段；同 section 中的 Python 权重会由 Zod 自动剥离。
export const iframeCaptureConfigSchema = z.object({
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
}).superRefine((captureConfig, context) => {
  // 单字段类型合法仍不足以保证配置组合可解，因此集中校验跨字段关系。
  if (captureConfig.min_screenshot_width > captureConfig.max_screenshot_width) {
    context.addIssue({code: "custom", message: "min_screenshot_width must not exceed max_screenshot_width", path: ["min_screenshot_width"]});
  }
  if (captureConfig.min_screenshot_height > captureConfig.max_screenshot_height) {
    context.addIssue({code: "custom", message: "min_screenshot_height must not exceed max_screenshot_height", path: ["min_screenshot_height"]});
  }
  if (captureConfig.min_aspect_ratio > captureConfig.max_aspect_ratio) {
    context.addIssue({code: "custom", message: "min_aspect_ratio must not exceed max_aspect_ratio", path: ["min_aspect_ratio"]});
  }
  if (captureConfig.reference_screenshot_area > captureConfig.max_screenshot_pixels) {
    context.addIssue({code: "custom", message: "reference_screenshot_area must not exceed max_screenshot_pixels", path: ["reference_screenshot_area"]});
  }

  // 比例范围两端都必须能在 min/max box 与像素预算内生成合法尺寸。
  for (const [path, aspectRatio] of [["min_aspect_ratio", captureConfig.min_aspect_ratio], ["max_aspect_ratio", captureConfig.max_aspect_ratio]] as const) {
    const requiredHeight = Math.max(captureConfig.min_screenshot_height, captureConfig.min_screenshot_width / aspectRatio);
    const requiredWidth = requiredHeight * aspectRatio;
    if (requiredWidth > captureConfig.max_screenshot_width || requiredHeight > captureConfig.max_screenshot_height) {
      context.addIssue({code: "custom", message: `${path} cannot satisfy the configured min/max screenshot dimensions`, path: [path]});
    } else if (requiredWidth * requiredHeight > captureConfig.max_screenshot_pixels) {
      context.addIssue({code: "custom", message: `${path} cannot satisfy max_screenshot_pixels at the minimum dimensions`, path: [path]});
    }
  }
});

// 业务层类型全部从 schema 推导，避免配置模型与运行时校验规则分叉。
export type ToolPromptConfigType = z.infer<typeof toolPromptConfigSchema>;
export type ToolPromptsConfigType = z.infer<typeof toolPromptsConfigSchema>;
export type ActiveFeatureIdSkinsType = z.infer<typeof activeFeatureIdSkinsSchema>;
export type FeatureIdRenderConfigType = z.infer<typeof featureIdRenderConfigSchema>;
export type FeatureIdDisplayConfigType = z.infer<typeof featureIdDisplayConfigSchema>;
export type IframeCaptureConfigType = z.infer<typeof iframeCaptureConfigSchema>;
