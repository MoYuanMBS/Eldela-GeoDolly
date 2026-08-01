/** 浏览器内置 Canvas 样式的初始化与只读缓存入口。 */

import type {BuiltInCanvasStyleCache, BuiltInCanvasStyleRule, CanvasTagMatcher} from "../../models/built-in-style-models.js";
import type {CanvasBaseStyleRecipe, CanvasDrawOperation} from "../../models/style/base-canvas-style.js";
import {BUILT_IN_CANVAS_STYLE_RULES, DEFAULT_CANVAS_BASE_STYLE_IDS} from "./built-in-style-rules.js";
import {BUILT_IN_CANVAS_BASE_STYLES} from "./canvas-base-styles.js";

type BuiltInCanvasStyleId = keyof typeof BUILT_IN_CANVAS_BASE_STYLES;

let cachedBuiltInCanvasStyle: BuiltInCanvasStyleCache<BuiltInCanvasStyleId> | null = null;

function freezeMatcher(matcher: CanvasTagMatcher): CanvasTagMatcher {
  // 内置 regex 已由 TypeScript 源码提供；复制实例只为避免缓存继续引用可变 source 对象。
  return typeof matcher === "string" ? matcher : Object.freeze(new RegExp(matcher.source, matcher.flags));
}

function freezeOperation(operation: CanvasDrawOperation): CanvasDrawOperation {
  if (operation.kind === "line" && operation.dash !== undefined) {
    return Object.freeze({...operation, dash: Object.freeze([...operation.dash])});
  }
  return Object.freeze({...operation});
}

function freezeBaseStyles(): Readonly<Record<BuiltInCanvasStyleId, CanvasBaseStyleRecipe>> {
  const entries = Object.entries(BUILT_IN_CANVAS_BASE_STYLES).map(([styleId, recipe]) => [
    styleId,
    Object.freeze({...recipe, operations: Object.freeze(recipe.operations.map(freezeOperation))}),
  ]);
  return Object.freeze(Object.fromEntries(entries)) as Readonly<Record<BuiltInCanvasStyleId, CanvasBaseStyleRecipe>>;
}

/**
 * 在浏览器创建 Leaflet 前加载一次内置 rules/recipes。
 * 内置源码由 TypeScript 静态约束，因此这里只复制和冻结，不执行用户配置级校验。
 */
export function initializeBuiltInCanvasStyle(): BuiltInCanvasStyleCache<BuiltInCanvasStyleId> {
  if (cachedBuiltInCanvasStyle !== null) return cachedBuiltInCanvasStyle;
  const rules = BUILT_IN_CANVAS_STYLE_RULES.map((rule) => Object.freeze({
    ...rule,
    key: freezeMatcher(rule.key),
    value: freezeMatcher(rule.value),
  })) as ReadonlyArray<BuiltInCanvasStyleRule<BuiltInCanvasStyleId>>;
  cachedBuiltInCanvasStyle = Object.freeze({
    defaultBaseStyleIds: Object.freeze({...DEFAULT_CANVAS_BASE_STYLE_IDS}),
    baseStyles: freezeBaseStyles(),
    rules: Object.freeze(rules),
  });
  return cachedBuiltInCanvasStyle;
}

/** 后续 style runtime 只通过该入口读取同一个内置样式缓存。 */
export function getBuiltInCanvasStyle(): BuiltInCanvasStyleCache<BuiltInCanvasStyleId> {
  return cachedBuiltInCanvasStyle ?? initializeBuiltInCanvasStyle();
}
