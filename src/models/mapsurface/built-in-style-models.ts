/** 内置地图 tag rule 的分层模型。 */

import type {CanvasSpatialFeatureType} from "./style/base-canvas-style.js";

export type StyleTargetType = CanvasSpatialFeatureType;
export type CanvasTagMatcher = string | RegExp;
export type StyleRenderLayer = "border" | "base" | "translucent";

// 0-499 保留给内置规则；浏览器编译用户规则时统一加 500，之后只比较最终 priority。
export const USER_STYLE_PRIORITY_OFFSET = 500;

/** 内置 Node 图标由 SVG image 承载；尺寸仍由 JS rule 固定，CSS 只负责 presentation。 */
export interface CssNodeIconStyle {
  src: string;
  sizePx: number;
}

/** CSS 与 Canvas 字段直接展开到 rule；kind 保证 className/styleId 不会形成非法组合。 */
export type StyleRuleStyleFields<StyleId extends string = string> =
  | Readonly<{kind: "canvas"; styleId: StyleId}>
  | Readonly<{kind: "css"; className: string; nodeIcon?: Readonly<CssNodeIconStyle>}>;

interface BuiltInStyleRuleCommon {
  /** 用于配置定位和并列 warning，不参与排序。 */
  id: string;
  /** 数值越大越优先；内置声明必须位于 0-499。 */
  priority: number;
  /** 内置规则的 key/value 均支持 exact string 或 RegExp。 */
  key: CanvasTagMatcher;
  value: CanvasTagMatcher;
}

/**
 * Border 在 Base 下方绘制；同一 effectType 只选择最高优先级规则，
 * 不同 effectType 可以同时存在。
 */
export type BuiltInBorderStyleRule<StyleId extends string = string> =
  BuiltInStyleRuleCommon & {
    renderLayer: "border";
    featureType: CanvasSpatialFeatureType;
    effectType: string;
  } & StyleRuleStyleFields<StyleId>;

/** Base 位于中层；一个空间 Feature 全局只选择一个规则，不参与合并。 */
export type BuiltInBaseStyleRule<StyleId extends string = string> =
  BuiltInStyleRuleCommon & {
    renderLayer: "base";
    featureType: CanvasSpatialFeatureType;
  } & StyleRuleStyleFields<StyleId>;

/**
 * Translucent 位于上层；同一 effectType 选择最高 priority 规则，
 * 平级时由 resolver 按稳定 planOrder 选择第一项。
 */
export type BuiltInTranslucentStyleRule<StyleId extends string = string> =
  BuiltInStyleRuleCommon & {
    renderLayer: "translucent";
    featureType: CanvasSpatialFeatureType;
    effectType: string;
  } & StyleRuleStyleFields<StyleId>;

export type BuiltInStyleRule<StyleId extends string = string> =
  | BuiltInBorderStyleRule<StyleId>
  | BuiltInBaseStyleRule<StyleId>
  | BuiltInTranslucentStyleRule<StyleId>;
