/** 内置 Canvas tag rule 的分层模型。 */

import type {CanvasSpatialFeatureType} from "./style/base-canvas-style.js";

export type CanvasStyleTargetType = CanvasSpatialFeatureType | "relation";
export type CanvasTagMatcher = string | RegExp;
export type CanvasRenderLayer = "border" | "base" | "translucent";

interface BuiltInCanvasStyleRuleCommon<StyleId extends string> {
  id: string;
  priority: number;
  key: CanvasTagMatcher;
  value: CanvasTagMatcher;
  styleId: StyleId;
}

/**
 * Border 在 Base 下方绘制；同一 effectType 只选择最高优先级规则，
 * 不同 effectType 可以同时存在。
 */
export type BuiltInCanvasBorderStyleRule<StyleId extends string = string> =
  BuiltInCanvasStyleRuleCommon<StyleId> & {
    renderLayer: "border";
    featureType: CanvasSpatialFeatureType;
    effectType: string;
  };

/** Base 位于中层；一个空间 Feature 全局只选择一个规则，不参与合并。 */
export type BuiltInCanvasBaseStyleRule<StyleId extends string = string> =
  BuiltInCanvasStyleRuleCommon<StyleId> & {
    renderLayer: "base";
    featureType: CanvasSpatialFeatureType;
  };

/**
 * Translucent 位于上层；同一 effectType 的匹配全部保留，
 * 由对应 compositor 合并 Relation 或 Area 提示性绘制。
 */
export type BuiltInCanvasTranslucentStyleRule<StyleId extends string = string> =
  BuiltInCanvasStyleRuleCommon<StyleId> & {
    renderLayer: "translucent";
    featureType: CanvasStyleTargetType;
    effectType: string;
  };

export type BuiltInCanvasStyleRule<StyleId extends string = string> =
  | BuiltInCanvasBorderStyleRule<StyleId>
  | BuiltInCanvasBaseStyleRule<StyleId>
  | BuiltInCanvasTranslucentStyleRule<StyleId>;
