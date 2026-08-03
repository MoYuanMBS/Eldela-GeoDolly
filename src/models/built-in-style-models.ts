/** 内置地图 tag rule 的分层模型。 */

import type {CanvasSpatialFeatureType} from "./style/base-canvas-style.js";

export type StyleTargetType = CanvasSpatialFeatureType | "relation";
export type CanvasTagMatcher = string | RegExp;
export type StyleRenderLayer = "border" | "base" | "translucent";

// 0-499 保留给内置规则；浏览器编译用户规则时统一加 500，之后只比较最终 priority。
export const USER_STYLE_PRIORITY_OFFSET = 500;

/** CSS 与 Canvas 只区分 renderer 消费方式，不影响 tag 匹配、priority 或分层语义。 */
export type StyleRuleTarget<StyleId extends string = string> =
  | Readonly<{kind: "canvas"; styleId: StyleId}>
  | Readonly<{kind: "css"; className: string}>;

interface BuiltInStyleRuleCommon<StyleId extends string> {
  /** 用于配置定位和并列 warning，不参与排序。 */
  id: string;
  /** 数值越大越优先；内置声明必须位于 0-499。 */
  priority: number;
  /** 内置规则的 key/value 均支持 exact string 或 RegExp。 */
  key: CanvasTagMatcher;
  value: CanvasTagMatcher;
  /** 命中后交给 Canvas renderer 的 recipe，或交给 CSS renderer 的 class。 */
  target: StyleRuleTarget<StyleId>;
}

/**
 * Border 在 Base 下方绘制；同一 effectType 只选择最高优先级规则，
 * 不同 effectType 可以同时存在。
 */
export type BuiltInBorderStyleRule<StyleId extends string = string> =
  BuiltInStyleRuleCommon<StyleId> & {
    renderLayer: "border";
    featureType: CanvasSpatialFeatureType;
    effectType: string;
  };

/** Base 位于中层；一个空间 Feature 全局只选择一个规则，不参与合并。 */
export type BuiltInBaseStyleRule<StyleId extends string = string> =
  BuiltInStyleRuleCommon<StyleId> & {
    renderLayer: "base";
    featureType: CanvasSpatialFeatureType;
  };

/**
 * Translucent 位于上层；同一 effectType 选择最高 priority 规则，
 * 平级时由 resolver 按稳定 planOrder 选择第一项。
 */
export type BuiltInTranslucentStyleRule<StyleId extends string = string> =
  BuiltInStyleRuleCommon<StyleId> & {
    renderLayer: "translucent";
    featureType: StyleTargetType;
    effectType: string;
  };

export type BuiltInStyleRule<StyleId extends string = string> =
  | BuiltInBorderStyleRule<StyleId>
  | BuiltInBaseStyleRule<StyleId>
  | BuiltInTranslucentStyleRule<StyleId>;
