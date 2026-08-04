/** 用户 OSM tag rule；匹配结果只选择 CSS class，不生成 Canvas recipe。 */

import {z} from "zod";

// 用户 key 只允许 exact；value 的字符串表示 exact，`regex` 对象表示待编译的 source。
const valueMatcherSchema = z.union([
  z.string().min(1),
  z.object({regex: z.string().min(1).max(512)}).strict(),
]);

const commonRuleFields = {
  id: z.string().min(1),
  // 用户当前只支持 CSS；仍显式传输 kind，使 Node 与浏览器共用同一拍平规则结构。
  kind: z.literal("css"),
  // YAML 中保存用户自己的非负 priority；传到浏览器后再统一加 500。
  priority: z.number().int().nonnegative(),
  key: z.string().min(1),
  value: valueMatcherSchema,
  // 用户 class 必须保留独立命名空间，避免与固定 built-in selector 形成身份冲突。
  className: z.string().regex(/^geomcp-user-[A-Za-z0-9_-]+$/u),
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

export type UserCssStyleRuleConfig = z.infer<typeof userCssStyleRuleConfigSchema>;

/** 单次地图生成时固定进 render payload 的可序列化用户样式快照。 */
export const renderStylePayloadSchema = z.object({
  user_css: z.string(),
  user_rules: z.array(userCssStyleRuleConfigSchema),
}).strict();

export type RenderStylePayload = z.infer<typeof renderStylePayloadSchema>;

/** CSS loader 内部结果；classNames 只用于启动校验，不进入传输缓存。 */
export interface UserCssSource {
  css: string;
  classNames: ReadonlySet<string>;
}

/** Node 启动时生成、随后复制进每份 render payload 的用户样式缓存。 */
export interface SerializableUserStyle {
  css: string;
  rules: ReadonlyArray<UserCssStyleRuleConfig>;
}
