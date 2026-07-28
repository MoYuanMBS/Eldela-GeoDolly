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

// 业务层类型全部从 schema 推导，避免配置模型与运行时校验规则分叉。
export type ToolPromptConfigType = z.infer<typeof toolPromptConfigSchema>;
export type ToolPromptsConfigType = z.infer<typeof toolPromptsConfigSchema>;
export type ActiveFeatureIdSkinsType = z.infer<typeof activeFeatureIdSkinsSchema>;
export type FeatureIdRenderConfigType = z.infer<typeof featureIdRenderConfigSchema>;
export type FeatureIdDisplayConfigType = z.infer<typeof featureIdDisplayConfigSchema>;
