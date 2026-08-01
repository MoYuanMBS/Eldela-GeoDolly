/** 用户 OSM tag rule；匹配结果只选择 CSS class，不生成 Canvas recipe。 */

import {z} from "zod";
import type {BuiltInCanvasStyleRule, CanvasStyleTargetType} from "../built-in-style-models.js";
import type {CanvasSpatialFeatureType} from "./base-canvas-style.js";

// 用户 key 只允许 exact；value 的字符串表示 exact，`regex` 对象表示待编译的 source。
const valueMatcherSchema = z.union([
  z.string().min(1),
  z.object({regex: z.string().min(1).max(512)}).strict(),
]);

const commonRuleFields = {
  id: z.string().min(1),
  priority: z.number().int(),
  key: z.string().min(1),
  value: valueMatcherSchema,
  className: z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]*$/u),
};

// 三种 render layer 与内置规则保持同样的 feature/effectType 约束，但结果改为 CSS class。
export const userCssStyleRuleConfigSchema = z.discriminatedUnion("renderLayer", [
  z.object({
    ...commonRuleFields,
    renderLayer: z.literal("border"),
    featureType: z.enum(["node", "way", "area"]),
    effectType: z.string().min(1),
  }).strict(),
  z.object({
    ...commonRuleFields,
    renderLayer: z.literal("base"),
    featureType: z.enum(["node", "way", "area"]),
  }).strict(),
  z.object({
    ...commonRuleFields,
    renderLayer: z.literal("translucent"),
    featureType: z.enum(["node", "way", "area", "relation"]),
    effectType: z.string().min(1),
  }).strict(),
]);

// 顶层结构错误会终止加载；单条 rule 留给 ConfigLoader 独立校验并 warning 跳过。
export const userCssStyleRulesDocumentSchema = z.object({
  rules: z.array(z.unknown()),
}).strict();

export type UserCssValueMatcher = string | RegExp;

/** resolver 编译后的公共运行时字段。 */
interface UserCssStyleRuleCommon {
  id: string;
  priority: number;
  key: string;
  value: UserCssValueMatcher;
  className: string;
}

export type UserCssBorderStyleRule = UserCssStyleRuleCommon & {
  renderLayer: "border";
  featureType: CanvasSpatialFeatureType;
  effectType: string;
};

export type UserCssBaseStyleRule = UserCssStyleRuleCommon & {
  renderLayer: "base";
  featureType: CanvasSpatialFeatureType;
};

export type UserCssTranslucentStyleRule = UserCssStyleRuleCommon & {
  renderLayer: "translucent";
  featureType: CanvasStyleTargetType;
  effectType: string;
};

export type UserCssStyleRule = UserCssBorderStyleRule | UserCssBaseStyleRule | UserCssTranslucentStyleRule;

export type UserCssStyleRuleConfig = z.infer<typeof userCssStyleRuleConfigSchema>;

/** 启动阶段组装后的统一规则；source 决定最终使用 Canvas styleId 还是 CSS className。 */
export type PreparedStyleRule =
  | (BuiltInCanvasStyleRule & {source: "builtIn"})
  | (UserCssStyleRule & {source: "user"});

/** 后续渲染模块只消费这一份不可热更新的样式缓存。 */
export interface PreparedStyleCache {
  css: string;
  rules: ReadonlyArray<PreparedStyleRule>;
}
