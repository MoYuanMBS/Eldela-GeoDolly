/**
 * 单 Feature 样式解析热路径。
 *
 * resolver 只匹配已经编译、排序并建立索引的 RuntimeStylePlan：Base 全局只取一条，
 * Border/Translucent 则允许不同 effectType 各取一条。这里不执行 CSS/Canvas 绘制。
 *
 * 单 Feature 流程：读取本类型三层索引 → 收集 tag 命中 → 做 priority/effectType 选择 →
 * 输出拍平的 ResolvedFeatureStyle。Renderer 只看 kind 与 styleId/className，不再理解 tag。
 */

import type {IdentifiedOverlayFeatureType, IdentifiedOverlaySpatialFeatureType} from "../../models/map-data-models.js";
import type {ResolvedFeatureStyle, RuntimeStylePlan, RuntimeStyleRule, RuntimeStyleRuleIndex} from "../../models/style/runtime-style-models.js";

type RuntimeAddonStyleRule = Extract<RuntimeStyleRule, {renderLayer: "border" | "translucent"}>;

/** exact matcher 直接比较；global/sticky RegExp 每次复制，防止 lastIndex 污染下一次匹配。 */
function matchesText(matcher: string | RegExp, text: string): boolean {
  if (typeof matcher === "string") return matcher === text;
  // 内置 matcher 若显式使用 global/sticky，不共享可变 lastIndex。
  return matcher.global || matcher.sticky ? new RegExp(matcher.source, matcher.flags).test(text) : matcher.test(text);
}

/**
 * 从一层索引中收集命中规则。properties 的一个 tag key 可能聚合多个 value，任一 value
 * 命中即视为规则命中；Map 同时防止同一 regex-key 规则被多个 tag 重复加入。
 */
function collectMatchingRules(index: RuntimeStyleRuleIndex, properties: Record<string, Array<string>>): Array<RuntimeStyleRule> {
  const matchedRulesByOrder = new Map<number, RuntimeStyleRule>();
  // exact key 只访问当前 Feature 实际拥有的 property，常见规则不会退化成全表扫描。
  for (const [key, values] of Object.entries(properties)) {
    for (const rule of index.exactKeyRules[key] ?? []) {
      if (values.some((value) => matchesText(rule.value, value))) matchedRulesByOrder.set(rule.planOrder, rule);
    }
  }
  // regex key 无法建立字符串字典，只扫描已经按 featureType/renderLayer 缩小后的列表。
  for (const rule of index.regexKeyRules) {
    const matched = Object.entries(properties).some(([key, values]) => matchesText(rule.key, key) && values.some((value) => matchesText(rule.value, value)));
    if (matched) matchedRulesByOrder.set(rule.planOrder, rule);
  }
  // exact-key 与 regex-key 来自两次收集，返回前按 planOrder 恢复统一的稳定候选顺序。
  return [...matchedRulesByOrder.values()].sort((left, right) => left.planOrder - right.planOrder);
}

/**
 * 从同一选择范围中取最高 priority。真正影响当前 Feature 的并列才 warning；
 * 并列项已按 planOrder 排列，因此固定取数组第 0 项即可得到可复现结果。
 */
function selectHighestPriorityRule(feature: IdentifiedOverlaySpatialFeatureType, renderLayer: "base" | "border" | "translucent", effectType: string | null, candidates: ReadonlyArray<RuntimeStyleRule>): RuntimeStyleRule | null {
  if (candidates.length === 0) return null;
  const highestPriority = candidates[0].priority;
  const tiedRules = candidates.filter((rule) => rule.priority === highestPriority);
  if (tiedRules.length > 1) {
    console.warn("style_rule_priority_tie", {
      feature_id: feature.feature_id,
      feature_type: feature.feature_type,
      render_layer: renderLayer,
      effect_type: effectType,
      priority: highestPriority,
      rule_ids: tiedRules.map((rule) => rule.id),
      selected_rule_id: tiedRules[0].id,
    });
  }
  // candidates 已按稳定 planOrder 排列；平级时固定选择数组第 0 项。
  return tiedRules[0];
}

/**
 * Border/Translucent 先按 effectType 分组：同组覆盖，只留最高 priority；不同组并存，
 * 从而允许 bridge、tunnel 等不同空间 Feature 附加效果一起进入 renderer。
 */
function resolveAddonRules(feature: IdentifiedOverlaySpatialFeatureType, renderLayer: "border" | "translucent", candidates: ReadonlyArray<RuntimeStyleRule>): ReadonlyArray<RuntimeAddonStyleRule> {
  const candidatesByEffectType = new Map<string, Array<RuntimeAddonStyleRule>>();
  for (const candidate of candidates) {
    if (candidate.renderLayer !== renderLayer) continue;
    const effectCandidates = candidatesByEffectType.get(candidate.effectType) ?? [];
    if (!candidatesByEffectType.has(candidate.effectType)) candidatesByEffectType.set(candidate.effectType, effectCandidates);
    effectCandidates.push(candidate);
  }
  const selectedRules: Array<RuntimeAddonStyleRule> = [];
  for (const [effectType, effectCandidates] of candidatesByEffectType) {
    const selectedRule = selectHighestPriorityRule(feature, renderLayer, effectType, effectCandidates);
    if (selectedRule !== null && selectedRule.renderLayer !== "base") selectedRules.push(selectedRule);
  }
  selectedRules.sort((left, right) => left.planOrder - right.planOrder);
  return Object.freeze(selectedRules);
}

/** 为一个 Overlay Feature 生成拍平的最终样式；未命中的空间 Base 使用类型默认 recipe。 */
export function resolveFeatureStyle(feature: IdentifiedOverlayFeatureType, plan: RuntimeStylePlan): ResolvedFeatureStyle {
  // 保留旧的宽 Feature 入参边界，但 relation 不再拥有规则索引，也不能进入空间样式解析。
  if (feature.feature_type === "relation") throw new Error("Relation does not support tag-based feature styles");
  const featureIndexes = plan.rulesByFeatureType[feature.feature_type];
  // Base 不做字段级混合：命中最高规则就完整使用其 CSS class 或 Canvas recipe。
  const baseRule = selectHighestPriorityRule(feature, "base", null, collectMatchingRules(featureIndexes.base, feature.properties));
  const base = baseRule === null
    ? Object.freeze({kind: "canvas" as const, styleId: plan.defaultBaseStyleIds[feature.feature_type], rule: null})
    : baseRule.kind === "canvas"
      ? Object.freeze({kind: "canvas" as const, styleId: baseRule.styleId, rule: baseRule})
      : Object.freeze({kind: "css" as const, className: baseRule.className, rule: baseRule});
  return Object.freeze({
    base,
    // Addon 仍按 effectType 去重，因此 bridge 与 tunnel 可以并存，同类效果只保留一个胜者。
    border: resolveAddonRules(feature, "border", collectMatchingRules(featureIndexes.border, feature.properties)),
    translucent: resolveAddonRules(feature, "translucent", collectMatchingRules(featureIndexes.translucent, feature.properties)),
  });
}
