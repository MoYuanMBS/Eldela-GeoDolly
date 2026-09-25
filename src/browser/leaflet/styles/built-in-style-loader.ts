/**
 * 浏览器内置地图样式的唯一加载入口。
 *
 * 这里把 Canvas recipe 和 tag rules 组装为只读 bundle，不执行 Feature 匹配。
 * built-in CSS 由 web 入口作为固定样式表加载，不进入此运行时对象。
 *
 * 执行顺序：复制并冻结源码声明 → 缓存 CompiledStyleBundle → 由 RuntimeStylePlan 与用户 bundle 合并。
 */

import {USER_STYLE_PRIORITY_OFFSET, type BuiltInStyleRule, type CanvasTagMatcher} from "../../../models/mapsurface/built-in-style-models.js";
import type {CanvasBaseStyleRecipe, CanvasDrawOperation} from "../../../models/mapsurface/style/base-canvas-style.js";
import type {CompiledStyleBundle, CompiledStyleRule} from "../../../models/mapsurface/style/runtime-style-models.js";
import {AppError} from "../../../shared/app-error.js";
import {BUILT_IN_STYLE_RULES, DEFAULT_CANVAS_BASE_STYLE_IDS} from "./built-in/built-in-style-rules.js";
import {BUILT_IN_CANVAS_STYLES, BUILT_IN_RELATION_MEMBERSHIP_STYLE} from "./built-in/built-in-style.js";

type BuiltInStyleId = keyof typeof BUILT_IN_CANVAS_STYLES;

// 内置配置在一次页面生命周期中保持不变，首次初始化后直接复用同一份只读结果。
let cachedBuiltInStyle: CompiledStyleBundle<BuiltInStyleId> | null = null;

/** 复制 RegExp，避免运行时规则继续引用入口文件中可变的 matcher 实例。 */
function freezeMatcher(matcher: CanvasTagMatcher): CanvasTagMatcher {
  return typeof matcher === "string" ? matcher : Object.freeze(new RegExp(matcher.source, matcher.flags));
}

/** line dash 是 operation 内唯一的数组字段，需要额外复制后冻结。 */
function freezeOperation(operation: CanvasDrawOperation): CanvasDrawOperation {
  if (operation.kind === "line" && operation.dash !== undefined) {
    return Object.freeze({...operation, dash: Object.freeze([...operation.dash])});
  }
  return Object.freeze({...operation});
}

/** 深度冻结每个 recipe 的 operations，保证 RuntimeStylePlan 可以安全共享这些对象。 */
function freezeCanvasStyles(): Readonly<Record<BuiltInStyleId, CanvasBaseStyleRecipe>> {
  // 复制而不是直接冻结源码 export，避免 loader 的初始化副作用污染声明文件本身。
  const entries = Object.entries(BUILT_IN_CANVAS_STYLES).map(([styleId, recipe]) => [
    styleId,
    Object.freeze({...recipe, operations: Object.freeze(recipe.operations.map(freezeOperation))}),
  ]);
  return Object.freeze(Object.fromEntries(entries)) as Readonly<Record<BuiltInStyleId, CanvasBaseStyleRecipe>>;
}

/** 把一条内置声明转换为与用户规则相同的浏览器编译规则。 */
function freezeRule(rule: BuiltInStyleRule<BuiltInStyleId>): CompiledStyleRule<BuiltInStyleId> {
  // priority 分区是合并后不再区分来源的前提，内置配置错误直接终止浏览器初始化。
  if (!Number.isInteger(rule.priority) || rule.priority < 0 || rule.priority >= USER_STYLE_PRIORITY_OFFSET) {
    throw new AppError("invalid_builtin_style", `Built-in style rule "${rule.id}" priority must be an integer from 0 to ${USER_STYLE_PRIORITY_OFFSET - 1}`);
  }
  if (rule.kind === "css" && rule.nodeIcon !== undefined) {
    if (rule.featureType !== "node" || rule.renderLayer !== "base") throw new AppError("invalid_builtin_style", `Built-in node icon rule "${rule.id}" must target the Node Base layer`);
    if (rule.nodeIcon.src.length === 0 || !Number.isFinite(rule.nodeIcon.sizePx) || rule.nodeIcon.sizePx <= 0) throw new AppError("invalid_builtin_style", `Built-in node icon rule "${rule.id}" has invalid icon metadata`);
  }
  const frozenRule = {
    ...rule,
    key: freezeMatcher(rule.key),
    value: freezeMatcher(rule.value),
    ...(rule.kind === "css" && rule.nodeIcon !== undefined ? {nodeIcon: Object.freeze({...rule.nodeIcon})} : {}),
  };
  switch (frozenRule.renderLayer) {
    case "border": return Object.freeze(frozenRule);
    case "base": return Object.freeze(frozenRule);
    case "translucent": return Object.freeze(frozenRule);
  }
}

/** 内置 rule ID 属于源码身份；重复会让后续跨来源冲突策略失去确定含义。 */
function freezeRules(): ReadonlyArray<CompiledStyleRule<BuiltInStyleId>> {
  const seenRuleIds = new Set<string>();
  return Object.freeze(BUILT_IN_STYLE_RULES.map((rule) => {
    if (seenRuleIds.has(rule.id)) throw new AppError("invalid_builtin_style", `Duplicate built-in style rule ID "${rule.id}"`);
    seenRuleIds.add(rule.id);
    return freezeRule(rule);
  }));
}

/**
 * 初始化并缓存内置 bundle。内置资源属于受控源码，因此语法、import 或 priority
 * 分区错误会直接终止构建/页面初始化，不在这里做逐条降级。
 */
export function initializeBuiltInStyle(): CompiledStyleBundle<BuiltInStyleId> {
  // 内置资源不会热更新；同一浏览器页面只构建一次，后续地图直接共享冻结对象。
  if (cachedBuiltInStyle !== null) return cachedBuiltInStyle;
  cachedBuiltInStyle = Object.freeze({
    canvasStyles: freezeCanvasStyles(),
    defaultBaseStyleIds: Object.freeze({...DEFAULT_CANVAS_BASE_STYLE_IDS}),
    relationMembershipStyle: Object.freeze({...BUILT_IN_RELATION_MEMBERSHIP_STYLE}),
    rules: freezeRules(),
  });
  return cachedBuiltInStyle;
}

/** 获取缓存；允许调用方不关心初始化先后，缺少缓存时自动完成一次初始化。 */
export function getBuiltInStyle(): CompiledStyleBundle<BuiltInStyleId> {
  return cachedBuiltInStyle ?? initializeBuiltInStyle();
}
