/**
 * 浏览器样式计划构建阶段。
 *
 * 该阶段只在地图初始化前运行一次：先解决 built-in/user 身份冲突，再固定规则顺序
 * 并建立索引。Feature 热路径只读取不含来源信息的 RuntimeStylePlan。
 *
 * 这里不做 tag 匹配。最终步骤依次为：合并 recipe/rule → 解析三类默认 Base →
 * priority 排序与 planOrder 固化 → 按 featureType/renderLayer/key 类型建立只读索引。
 */

import type {CanvasSpatialFeatureType} from "../../models/mapsurface/style/base-canvas-style.js";
import type {CompiledStyleBundle, CompiledStyleRule, RuntimeStyleFeatureRuleIndexes, RuntimeStylePlan, RuntimeStyleRule, RuntimeStyleRuleIndex} from "../../models/mapsurface/style/runtime-style-models.js";
import {AppError} from "../../utils/app-error.js";
import {BUILT_IN_RELATION_MEMBERSHIP_STYLE} from "./built-in/built-in-style.js";

interface MutableRuleIndex {
  exactKeyRules: Record<string, Array<RuntimeStyleRule>>;
  regexKeyRules: Array<RuntimeStyleRule>;
}

/** 为一个 featureType/renderLayer 建立 exact-key 与 regex-key 两条候选路径。 */
function createMutableRuleIndex(): MutableRuleIndex {
  // OSM tag key 不受普通对象原型名限制，使用无原型字典避免 `constructor` 等 key 冲突。
  return {exactKeyRules: Object.create(null) as Record<string, Array<RuntimeStyleRule>>, regexKeyRules: []};
}

/** 每种 Feature 都分别维护 border、base、translucent 三层索引。 */
function createMutableFeatureIndexes(): Record<"border" | "base" | "translucent", MutableRuleIndex> {
  return {border: createMutableRuleIndex(), base: createMutableRuleIndex(), translucent: createMutableRuleIndex()};
}

/** 冻结单层索引以及 exact key 对应的候选数组，避免渲染阶段意外改写计划。 */
function freezeRuleIndex(index: MutableRuleIndex): RuntimeStyleRuleIndex {
  const exactKeyRules = Object.create(null) as Record<string, ReadonlyArray<RuntimeStyleRule>>;
  for (const [key, rules] of Object.entries(index.exactKeyRules)) exactKeyRules[key] = Object.freeze(rules);
  return Object.freeze({exactKeyRules: Object.freeze(exactKeyRules), regexKeyRules: Object.freeze(index.regexKeyRules)});
}

/** 冻结一个 Feature 类型下的三层规则索引。 */
function freezeFeatureIndexes(indexes: Record<"border" | "base" | "translucent", MutableRuleIndex>): RuntimeStyleFeatureRuleIndexes {
  return Object.freeze({
    border: freezeRuleIndex(indexes.border),
    base: freezeRuleIndex(indexes.base),
    translucent: freezeRuleIndex(indexes.translucent),
  });
}

/**
 * planOrder 记录 priority 排序后的稳定声明顺序。
 * resolver 用它恢复候选顺序，并在 priority 并列时确定性地选择数组第 0 项。
 */
function addPlanOrder(rule: CompiledStyleRule, planOrder: number): RuntimeStyleRule {
  const runtimeRule = {...rule, planOrder};
  switch (runtimeRule.renderLayer) {
    case "border": return Object.freeze(runtimeRule);
    case "base": return Object.freeze(runtimeRule);
    case "translucent": return Object.freeze(runtimeRule);
  }
}

/** 合并 Canvas recipe；跨来源同名时固定保留 built-in，避免用户改写内置身份。 */
function mergeCanvasStyles(builtInBundle: CompiledStyleBundle, userBundle: CompiledStyleBundle): RuntimeStylePlan["canvasStyles"] {
  const canvasStyles: Record<string, CompiledStyleBundle["canvasStyles"][string]> = Object.create(null) as Record<string, CompiledStyleBundle["canvasStyles"][string]>;
  for (const [styleId, recipe] of Object.entries(builtInBundle.canvasStyles)) canvasStyles[styleId] = recipe;
  for (const [styleId, recipe] of Object.entries(userBundle.canvasStyles)) {
    if (canvasStyles[styleId] !== undefined) {
      console.warn("canvas_style_id_collision", {style_id: styleId, kept_source: "built-in", skipped_source: "user"});
      continue;
    }
    canvasStyles[styleId] = recipe;
  }
  return Object.freeze(canvasStyles);
}

/** rule ID 也是全局身份；用户撞到内置 ID 时 warning 并丢弃用户规则。 */
function mergeRules(builtInBundle: CompiledStyleBundle, userBundle: CompiledStyleBundle): Array<CompiledStyleRule> {
  const builtInRuleIds = new Set(builtInBundle.rules.map((rule) => rule.id));
  const userRules = userBundle.rules.filter((rule) => {
    if (!builtInRuleIds.has(rule.id)) return true;
    console.warn("style_rule_id_collision", {rule_id: rule.id, kept_source: "built-in", skipped_source: "user"});
    return false;
  });
  return [...builtInBundle.rules, ...userRules];
}

/**
 * 汇总 node/way/area 的默认 Canvas style，并确认 ID 确实指向已加载的 recipe。
 * 默认样式是无规则命中时的兜底，因此三种空间 Feature 缺少任意一项都不能启动。
 */
function resolveDefaultBaseStyleIds(canvasStyles: CompiledStyleBundle["canvasStyles"], bundles: ReadonlyArray<CompiledStyleBundle>): RuntimeStylePlan["defaultBaseStyleIds"] {
  const mergedDefaults: Partial<Record<CanvasSpatialFeatureType, string>> = {};
  for (const bundle of bundles) {
    for (const [featureType, styleId] of Object.entries(bundle.defaultBaseStyleIds) as Array<[CanvasSpatialFeatureType, string]>) {
      const existingStyleId = mergedDefaults[featureType];
      if (existingStyleId !== undefined && existingStyleId !== styleId) throw new AppError("invalid_render_style", `Conflicting default ${featureType} styles "${existingStyleId}" and "${styleId}"`);
      mergedDefaults[featureType] = styleId;
    }
  }
  const getDefaultStyleId = (featureType: CanvasSpatialFeatureType): string => {
    const styleId = mergedDefaults[featureType];
    if (styleId === undefined) throw new AppError("missing_render_style", `Missing default ${featureType} style`);
    if (canvasStyles[styleId] === undefined) throw new AppError("missing_render_style", `Default ${featureType} style "${styleId}" was not loaded`);
    return styleId;
  };
  return Object.freeze({node: getDefaultStyleId("node"), way: getDefaultStyleId("way"), area: getDefaultStyleId("area")});
}

/** Relation membership 参数通常由 built-in bundle 提供；独立 fixture 缺省时仍使用同一内置默认值。 */
function resolveRelationMembershipStyle(bundles: ReadonlyArray<CompiledStyleBundle>): RuntimeStylePlan["relationMembershipStyle"] {
  const styles = bundles.flatMap((bundle) => bundle.relationMembershipStyle === undefined ? [] : [bundle.relationMembershipStyle]);
  if (styles.length === 0) return Object.freeze({...BUILT_IN_RELATION_MEMBERSHIP_STYLE});
  if (styles.length > 1) throw new AppError("invalid_render_style", "Multiple default relation membership styles were loaded");
  return Object.freeze({...styles[0]});
}

/**
 * 两侧 bundle 使用相同格式；priority 已在 compiler/loader 中转换为最终值。来源只用于
 * 解决 ID 冲突，之后按 priority 稳定排序并通过 planOrder 保留声明顺序。
 */
export function createRuntimeStylePlan(builtInBundle: CompiledStyleBundle, userBundle: CompiledStyleBundle): RuntimeStylePlan {
  const bundles = [builtInBundle, userBundle];
  const canvasStyles = mergeCanvasStyles(builtInBundle, userBundle);
  const defaultBaseStyleIds = resolveDefaultBaseStyleIds(canvasStyles, bundles);
  const relationMembershipStyle = resolveRelationMembershipStyle(bundles);
  const sortedRules = mergeRules(builtInBundle, userBundle).sort((left, right) => right.priority - left.priority);
  // 现代 JS sort 是稳定排序；相同 priority 保留合并后的声明顺序，再由 planOrder 显式记录。
  const rules = Object.freeze(sortedRules.map(addPlanOrder));

  const mutableIndexes = {
    node: createMutableFeatureIndexes(),
    way: createMutableFeatureIndexes(),
    area: createMutableFeatureIndexes(),
  };
  for (const rule of rules) {
    const index = mutableIndexes[rule.featureType][rule.renderLayer];
    if (typeof rule.key === "string") {
      // exact key 可在 resolver 中按 Feature property 名直接定位，避免扫描所有规则。
      let keyRules = index.exactKeyRules[rule.key];
      if (keyRules === undefined) {
        keyRules = [];
        index.exactKeyRules[rule.key] = keyRules;
      }
      keyRules.push(rule);
    } else {
      // regex key 无法预先枚举，只保留在对应 Feature/层级的小范围列表中。
      index.regexKeyRules.push(rule);
    }
  }

  return Object.freeze({
    defaultBaseStyleIds,
    canvasStyles,
    relationMembershipStyle,
    rules,
    rulesByFeatureType: Object.freeze({
      node: freezeFeatureIndexes(mutableIndexes.node),
      way: freezeFeatureIndexes(mutableIndexes.way),
      area: freezeFeatureIndexes(mutableIndexes.area),
    }),
  });
}
