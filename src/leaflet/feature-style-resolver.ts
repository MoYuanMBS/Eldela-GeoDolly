/**
 * 单 Feature 样式解析热路径。
 *
 * resolver 只匹配已经编译、排序并建立索引的 RuntimeStylePlan：Base 全局只取一条，
 * Border/Translucent 则允许不同 effectType 各取一条。这里不执行 CSS/Canvas 绘制。
 */

import type {IdentifiedOverlayFeatureType, IdentifiedOverlayRelationFeatureType} from "../models/map-data-models.js";
import type {ResolvedFeatureStyle, RuntimeRelationTranslucentStyleRule, RuntimeStylePlan, RuntimeStyleRule, RuntimeStyleRuleIndex} from "../models/style/runtime-style-models.js";

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
  for (const [key, values] of Object.entries(properties)) {
    for (const rule of index.exactKeyRules[key] ?? []) {
      if (values.some((value) => matchesText(rule.value, value))) matchedRulesByOrder.set(rule.planOrder, rule);
    }
  }
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
function selectHighestPriorityRule(feature: IdentifiedOverlayFeatureType, renderLayer: "base" | "border" | "translucent", effectType: string | null, candidates: ReadonlyArray<RuntimeStyleRule>): RuntimeStyleRule | null {
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
 * 从而允许 bridge、tunnel 或多个 relation color 等不同附加效果一起进入 renderer。
 */
function resolveAddonRules(feature: IdentifiedOverlayFeatureType, renderLayer: "border" | "translucent", candidates: ReadonlyArray<RuntimeStyleRule>): ReadonlyArray<RuntimeAddonStyleRule> {
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

/** Relation 只匹配 translucent 索引，避免为不存在的 Base/Border 重复扫描 properties。 */
export function resolveRelationTranslucentRules(relation: IdentifiedOverlayRelationFeatureType, plan: RuntimeStylePlan): ReadonlyArray<RuntimeRelationTranslucentStyleRule> {
  const candidates = collectMatchingRules(plan.rulesByFeatureType.relation.translucent, relation.properties);
  const selectedRules = resolveAddonRules(relation, "translucent", candidates);
  return Object.freeze(selectedRules.filter((rule): rule is RuntimeRelationTranslucentStyleRule => rule.renderLayer === "translucent" && rule.featureType === "relation"));
}

/** 为一个 Overlay Feature 生成拍平的最终样式；未命中的空间 Base 使用类型默认 recipe。 */
export function resolveFeatureStyle(feature: IdentifiedOverlayFeatureType, plan: RuntimeStylePlan): ResolvedFeatureStyle {
  // Relation 的公开解析结果也严格只有 translucent，不能从未来的错误配置泄漏 Base/Border。
  if (feature.feature_type === "relation") {
    return Object.freeze({base: null, border: Object.freeze([]), translucent: resolveRelationTranslucentRules(feature, plan)});
  }
  const featureIndexes = plan.rulesByFeatureType[feature.feature_type];
  const baseRule = selectHighestPriorityRule(feature, "base", null, collectMatchingRules(featureIndexes.base, feature.properties));
  const base = baseRule === null
    ? Object.freeze({kind: "canvas" as const, styleId: plan.defaultBaseStyleIds[feature.feature_type], rule: null})
    : baseRule.kind === "canvas"
      ? Object.freeze({kind: "canvas" as const, styleId: baseRule.styleId, rule: baseRule})
      : Object.freeze({kind: "css" as const, className: baseRule.className, rule: baseRule});
  return Object.freeze({
    base,
    border: resolveAddonRules(feature, "border", collectMatchingRules(featureIndexes.border, feature.properties)),
    translucent: resolveAddonRules(feature, "translucent", collectMatchingRules(featureIndexes.translucent, feature.properties)),
  });
}
