/**
 * 浏览器样式流水线的公共模型：Compiled bundle → Runtime plan → Resolved style。
 * 这些类型不记录规则来源；built-in/user 的覆盖关系已经完全编码进最终 priority。
 */

import type {CanvasTagMatcher, StyleRuleTarget, StyleTargetType} from "../built-in-style-models.js";
import type {CanvasBaseStyleRecipe, CanvasSpatialFeatureType} from "./base-canvas-style.js";

/** loader/compiler 已完成格式转换，但尚未进入全局排序和索引的统一规则。 */
interface CompiledStyleRuleCommon<StyleId extends string> {
  id: string;
  priority: number;
  key: CanvasTagMatcher;
  value: CanvasTagMatcher;
  target: StyleRuleTarget<StyleId>;
}

export type CompiledBorderStyleRule<StyleId extends string = string> = Readonly<CompiledStyleRuleCommon<StyleId> & {
  renderLayer: "border";
  featureType: CanvasSpatialFeatureType;
  effectType: string;
}>;

export type CompiledBaseStyleRule<StyleId extends string = string> = Readonly<CompiledStyleRuleCommon<StyleId> & {
  renderLayer: "base";
  featureType: CanvasSpatialFeatureType;
}>;

export type CompiledTranslucentStyleRule<StyleId extends string = string> = Readonly<CompiledStyleRuleCommon<StyleId> & {
  renderLayer: "translucent";
  featureType: StyleTargetType;
  effectType: string;
}>;

export type CompiledStyleRule<StyleId extends string = string> =
  | CompiledBorderStyleRule<StyleId>
  | CompiledBaseStyleRule<StyleId>
  | CompiledTranslucentStyleRule<StyleId>;

/**
 * built-in loader 与 user compiler 的共同输出边界。
 * 用户当前只贡献 CSS 和 rules，因此其 canvasStyles/defaultBaseStyleIds 为空对象。
 */
export interface CompiledStyleBundle<StyleId extends string = string> {
  /** 已完成各自 import 展开的地图样式文本，尚未注入 DOM。 */
  css: string;
  /** Canvas target 引用的只读绘制 recipe。 */
  canvasStyles: Readonly<Record<StyleId, CanvasBaseStyleRecipe>>;
  /** 无 Base rule 命中时的兜底 recipe；允许单个 bundle 只提供其中一部分。 */
  defaultBaseStyleIds: Readonly<Partial<Record<CanvasSpatialFeatureType, StyleId>>>;
  rules: ReadonlyArray<CompiledStyleRule<StyleId>>;
}

/** RuntimeStylePlan 中的规则；planOrder 是 priority 排序后的稳定并列顺序。 */
export type RuntimeStyleRule<StyleId extends string = string> =
  | Readonly<CompiledBorderStyleRule<StyleId> & {planOrder: number}>
  | Readonly<CompiledBaseStyleRule<StyleId> & {planOrder: number}>
  | Readonly<CompiledTranslucentStyleRule<StyleId> & {planOrder: number}>;

/** exact key 可直接索引；regex key 保持独立列表供 resolver 执行。 */
export interface RuntimeStyleRuleIndex<StyleId extends string = string> {
  exactKeyRules: Readonly<Record<string, ReadonlyArray<RuntimeStyleRule<StyleId>>>>;
  regexKeyRules: ReadonlyArray<RuntimeStyleRule<StyleId>>;
}

export interface RuntimeStyleFeatureRuleIndexes<StyleId extends string = string> {
  border: RuntimeStyleRuleIndex<StyleId>;
  base: RuntimeStyleRuleIndex<StyleId>;
  translucent: RuntimeStyleRuleIndex<StyleId>;
}

/** 浏览器初始化时构建一次、供所有 Feature 解析共享的完整只读计划。 */
export interface RuntimeStylePlan<StyleId extends string = string> {
  /** 按 bundle 输入顺序拼接的 built-in + user 地图 CSS。 */
  css: string;
  defaultBaseStyleIds: Readonly<Record<CanvasSpatialFeatureType, StyleId>>;
  canvasStyles: Readonly<Record<StyleId, CanvasBaseStyleRecipe>>;
  rules: ReadonlyArray<RuntimeStyleRule<StyleId>>;
  rulesByFeatureType: Readonly<Record<StyleTargetType, RuntimeStyleFeatureRuleIndexes<StyleId>>>;
}

/** Base 只选择一个 target；rule 为 null 表示使用 Feature 类型的默认 Canvas recipe。 */
export interface ResolvedBaseStyle<StyleId extends string = string> {
  target: StyleRuleTarget<StyleId>;
  rule: RuntimeStyleRule<StyleId> | null;
}

/** resolver 输出的绘制选择；renderer 根据 target.kind 分发至 Canvas 或 CSS 路径。 */
export interface ResolvedFeatureStyle<StyleId extends string = string> {
  base: ResolvedBaseStyle<StyleId> | null;
  border: ReadonlyArray<RuntimeStyleRule<StyleId>>;
  translucent: ReadonlyArray<RuntimeStyleRule<StyleId>>;
}
