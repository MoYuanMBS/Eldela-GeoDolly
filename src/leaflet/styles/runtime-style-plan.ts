/**
 * 浏览器样式计划构建阶段。
 *
 * 该阶段只在地图初始化前运行一次：合并所有统一 bundle，固定规则顺序并建立索引。
 * Feature 渲染热路径只读取 RuntimeStylePlan，不再合并配置或编译 RegExp。
 */

import type {CanvasSpatialFeatureType} from "../../models/style/base-canvas-style.js";
import type {CompiledStyleBundle, CompiledStyleRule, RuntimeStyleFeatureRuleIndexes, RuntimeStylePlan, RuntimeStyleRule, RuntimeStyleRuleIndex} from "../../models/style/runtime-style-models.js";

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

/** 合并 Canvas recipe；同名 recipe 含义不明确，因此直接拒绝重复 style ID。 */
function mergeCanvasStyles(bundles: ReadonlyArray<CompiledStyleBundle>): RuntimeStylePlan["canvasStyles"] {
  const canvasStyles: Record<string, CompiledStyleBundle["canvasStyles"][string]> = Object.create(null) as Record<string, CompiledStyleBundle["canvasStyles"][string]>;
  for (const bundle of bundles) {
    for (const [styleId, recipe] of Object.entries(bundle.canvasStyles)) {
      if (canvasStyles[styleId] !== undefined) throw new Error(`Duplicate Canvas style ID "${styleId}"`);
      canvasStyles[styleId] = recipe;
    }
  }
  return Object.freeze(canvasStyles);
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
      if (existingStyleId !== undefined && existingStyleId !== styleId) throw new Error(`Conflicting default ${featureType} styles "${existingStyleId}" and "${styleId}"`);
      mergedDefaults[featureType] = styleId;
    }
  }
  const getDefaultStyleId = (featureType: CanvasSpatialFeatureType): string => {
    const styleId = mergedDefaults[featureType];
    if (styleId === undefined) throw new Error(`Missing default ${featureType} style`);
    if (canvasStyles[styleId] === undefined) throw new Error(`Default ${featureType} style "${styleId}" was not loaded`);
    return styleId;
  };
  return Object.freeze({node: getDefaultStyleId("node"), way: getDefaultStyleId("way"), area: getDefaultStyleId("area")});
}

/**
 * 全部 bundle 使用完全相同的格式；priority 已在各自 compiler/loader 中转换为最终值。
 * 此处只按 priority 稳定排序，平级规则通过 planOrder 保留原始声明顺序。
 */
export function createRuntimeStylePlan(bundles: ReadonlyArray<CompiledStyleBundle>): RuntimeStylePlan {
  // CSS 保留 bundle 输入顺序；后出现的声明可继续遵循 CSS 自身的 cascade 规则。
  const css = bundles.map((bundle) => bundle.css).filter((cssText) => cssText.length > 0).join("\n");
  const canvasStyles = mergeCanvasStyles(bundles);
  const defaultBaseStyleIds = resolveDefaultBaseStyleIds(canvasStyles, bundles);
  const sortedRules = bundles.flatMap((bundle) => bundle.rules).sort((left, right) => right.priority - left.priority);
  const rules = Object.freeze(sortedRules.map(addPlanOrder));

  const mutableIndexes = {
    node: createMutableFeatureIndexes(),
    way: createMutableFeatureIndexes(),
    area: createMutableFeatureIndexes(),
    relation: createMutableFeatureIndexes(),
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
    css,
    defaultBaseStyleIds,
    canvasStyles,
    rules,
    rulesByFeatureType: Object.freeze({
      node: freezeFeatureIndexes(mutableIndexes.node),
      way: freezeFeatureIndexes(mutableIndexes.way),
      area: freezeFeatureIndexes(mutableIndexes.area),
      relation: freezeFeatureIndexes(mutableIndexes.relation),
    }),
  });
}
