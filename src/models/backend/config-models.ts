/**
 * Current authority source: doc/GeoMCP 技术规范文档.md
 *
 * TypeScript 侧实际会用到的配置模型。
 */

import { z } from "zod";
import {logger} from "../../utils/logger.js";
import {UI_BUILT_IN_CONFIG} from "../../web/built-in-config.js";

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

export const iframePaddingConfigSchema = z.object({
  top: positiveIntegerSchema,
  right: positiveIntegerSchema,
  bottom: positiveIntegerSchema,
  left: positiveIntegerSchema,
}).strict().superRefine((padding, context) => {
  // 当前 center 算法不包含像素偏移，因此只接受水平、垂直分别对称的 padding。
  if (padding.left !== padding.right) {
    context.addIssue({code: "custom", message: "left padding must equal right padding", path: ["left"]});
  }
  if (padding.top !== padding.bottom) {
    context.addIssue({code: "custom", message: "top padding must equal bottom padding", path: ["top"]});
  }
});

// TypeScript 对同一个 iframe_adaptive section 只使用这一份完整 schema；Python 专用权重由 Zod 剥离。
export const iframeAdaptiveConfigSchema = z.object({
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
  min_map_display_width: positiveIntegerSchema.transform((minimumWidth) => {
    if (minimumWidth < UI_BUILT_IN_CONFIG.toolbar.minWidth) {logger.warning("min_map_display_width_clamped", {configured_width: minimumWidth, toolbar_min_width: UI_BUILT_IN_CONFIG.toolbar.minWidth,});
      return UI_BUILT_IN_CONFIG.toolbar.minWidth;
    }
    return minimumWidth;
  }),
  min_map_display_height: positiveIntegerSchema,
}).superRefine((adaptiveConfig, context) => {
  // 单字段类型合法仍不足以保证配置组合可解，因此集中校验跨字段关系。
  if (adaptiveConfig.min_screenshot_width > adaptiveConfig.max_screenshot_width) {
    context.addIssue({code: "custom", message: "min_screenshot_width must not exceed max_screenshot_width", path: ["min_screenshot_width"]});
  }
  if (adaptiveConfig.min_screenshot_height > adaptiveConfig.max_screenshot_height) {
    context.addIssue({code: "custom", message: "min_screenshot_height must not exceed max_screenshot_height", path: ["min_screenshot_height"]});
  }
  if (adaptiveConfig.min_aspect_ratio > adaptiveConfig.max_aspect_ratio) {
    context.addIssue({code: "custom", message: "min_aspect_ratio must not exceed max_aspect_ratio", path: ["min_aspect_ratio"]});
  }
  if (adaptiveConfig.reference_screenshot_area > adaptiveConfig.max_screenshot_pixels) {
    context.addIssue({code: "custom", message: "reference_screenshot_area must not exceed max_screenshot_pixels", path: ["reference_screenshot_area"]});
  }
  if (adaptiveConfig.padding.left + adaptiveConfig.padding.right >= adaptiveConfig.min_screenshot_width) {
    context.addIssue({code: "custom", message: "horizontal padding must leave positive MapSurface width", path: ["padding"]});
  }
  if (adaptiveConfig.padding.top + adaptiveConfig.padding.bottom >= adaptiveConfig.min_screenshot_height) {
    context.addIssue({code: "custom", message: "vertical padding must leave positive MapSurface height", path: ["padding"]});
  }

  // 比例范围两端都必须能在 min/max box 与像素预算内生成合法尺寸。
  for (const [path, aspectRatio] of [["min_aspect_ratio", adaptiveConfig.min_aspect_ratio], ["max_aspect_ratio", adaptiveConfig.max_aspect_ratio]] as const) {
    const requiredHeight = Math.max(adaptiveConfig.min_screenshot_height, adaptiveConfig.min_screenshot_width / aspectRatio);
    const requiredWidth = requiredHeight * aspectRatio;
    if (requiredWidth > adaptiveConfig.max_screenshot_width || requiredHeight > adaptiveConfig.max_screenshot_height) {
      context.addIssue({code: "custom", message: `${path} cannot satisfy the configured min/max screenshot dimensions`, path: [path]});
    } else if (requiredWidth * requiredHeight > adaptiveConfig.max_screenshot_pixels) {
      context.addIssue({code: "custom", message: `${path} cannot satisfy max_screenshot_pixels at the minimum dimensions`, path: [path]});
    }
  }
});

//#########################browser map flow###############################

export const browserMapConfigSchema = z.object({
  ready_timeout_seconds: positiveFiniteNumberSchema,
}).strict();

//#########################leaflet renderer###############################

export const leafletConfigSchema = z.object({
  viewport: z.object({
    max_zoom: positiveIntegerSchema,
  }).strict(),
  render_batch_size: positiveIntegerSchema,
  node_zoom: z.object({
    hidden_max_zoom: positiveIntegerSchema,
    compact_max_zoom: positiveIntegerSchema,
    compact_scale: positiveFiniteNumberSchema.max(1),
    medium_max_zoom: positiveIntegerSchema,
    medium_scale: positiveFiniteNumberSchema.max(1),
  }).strict(),
  relation_membership: z.object({
    node_radius_px: positiveFiniteNumberSchema,
    node_stroke_width_px: positiveFiniteNumberSchema,
    way_width_px: positiveFiniteNumberSchema,
    area_band_total_width_px: positiveFiniteNumberSchema,
  }).strict(),
  interaction: z.object({
    node_extra_radius_px: positiveFiniteNumberSchema,
    way_extra_width_px: positiveFiniteNumberSchema,
    area_edge_width_px: positiveFiniteNumberSchema,
    min_node_radius_px: positiveFiniteNumberSchema,
    max_node_radius_px: positiveFiniteNumberSchema,
    min_way_width_px: positiveFiniteNumberSchema,
    max_way_width_px: positiveFiniteNumberSchema,
    max_area_edge_width_px: positiveFiniteNumberSchema,
  }).strict(),
  visual_limits: z.object({
    max_canvas_node_radius_px: positiveFiniteNumberSchema,
    max_canvas_stroke_width_px: positiveFiniteNumberSchema,
  }).strict(),
}).strict().superRefine((leafletConfig, context) => {
  const {node_zoom: nodeZoom, relation_membership: relation, interaction, visual_limits: limits} = leafletConfig;

  // 分段边界必须严格递增，否则同一 zoom 会命中相互矛盾的缩放等级。
  if (!(nodeZoom.hidden_max_zoom < nodeZoom.compact_max_zoom && nodeZoom.compact_max_zoom < nodeZoom.medium_max_zoom)) {
    context.addIssue({code: "custom", message: "node zoom thresholds must be strictly increasing", path: ["node_zoom"]});
  }
  if (nodeZoom.compact_scale > nodeZoom.medium_scale) {
    context.addIssue({code: "custom", message: "compact_scale must not exceed medium_scale", path: ["node_zoom", "compact_scale"]});
  }

  if (interaction.min_node_radius_px > interaction.max_node_radius_px) {
    context.addIssue({code: "custom", message: "min_node_radius_px must not exceed max_node_radius_px", path: ["interaction", "min_node_radius_px"]});
  }
  if (interaction.min_way_width_px > interaction.max_way_width_px) {
    context.addIssue({code: "custom", message: "min_way_width_px must not exceed max_way_width_px", path: ["interaction", "min_way_width_px"]});
  }
  if (interaction.area_edge_width_px > interaction.max_area_edge_width_px) {
    context.addIssue({code: "custom", message: "area_edge_width_px must not exceed max_area_edge_width_px", path: ["interaction", "area_edge_width_px"]});
  }

  // Relation 尺寸同样由 Canvas 绘制，不能借固定 addon 绕过全局视觉安全上限。
  if (relation.node_radius_px > limits.max_canvas_node_radius_px) {
    context.addIssue({code: "custom", message: "relation node radius exceeds max_canvas_node_radius_px", path: ["relation_membership", "node_radius_px"]});
  }
  for (const [field, width] of [
    ["node_stroke_width_px", relation.node_stroke_width_px],
    ["way_width_px", relation.way_width_px],
    ["area_band_total_width_px", relation.area_band_total_width_px],
  ] as const) {
    if (width > limits.max_canvas_stroke_width_px) {
      context.addIssue({code: "custom", message: `${field} exceeds max_canvas_stroke_width_px`, path: ["relation_membership", field]});
    }
  }
});

// 业务层类型全部从 schema 推导，避免配置模型与运行时校验规则分叉。
export type ToolPromptConfigType = z.infer<typeof toolPromptConfigSchema>;
export type ToolPromptsConfigType = z.infer<typeof toolPromptsConfigSchema>;
export type ActiveFeatureIdSkinsType = z.infer<typeof activeFeatureIdSkinsSchema>;
export type FeatureIdRenderConfigType = z.infer<typeof featureIdRenderConfigSchema>;
export type FeatureIdDisplayConfigType = z.infer<typeof featureIdDisplayConfigSchema>;
export type IframePaddingConfigType = z.infer<typeof iframePaddingConfigSchema>;
export type IframeAdaptiveConfigType = z.infer<typeof iframeAdaptiveConfigSchema>;
export type BrowserMapConfigType = z.infer<typeof browserMapConfigSchema>;
export type LeafletConfigType = z.infer<typeof leafletConfigSchema>;
