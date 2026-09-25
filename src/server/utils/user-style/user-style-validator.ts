/** 启动阶段交叉校验用户 CSS/rules；输出保持可序列化，不执行正式 tag 匹配。 */

import type {SerializableUserStyle, UserCssSource, UserCssStyleRuleConfig} from "../../../models/mapsurface/style/user-css-style-models.js";
import {logger} from "../logger.js";

/** exact/regex 类型参与签名；ID 与 priority 不属于最终绘制语义。 */
function getRuleSignature(rule: UserCssStyleRuleConfig): string {
  const valueMatcher = typeof rule.value === "string" ? ["exact", rule.value] : ["regex", rule.value.regex];
  const effectType = rule.renderLayer === "base" ? null : rule.effectType;
  return JSON.stringify([rule.kind, rule.renderLayer, rule.featureType, effectType, rule.key, valueMatcher, rule.className, rule.nodeIcon ?? null]);
}

function freezeRule(rule: UserCssStyleRuleConfig): UserCssStyleRuleConfig {
  // regex object 也要复制并冻结，最终缓存不能继续引用 loader 返回的 raw 对象。
  const value = typeof rule.value === "string" ? rule.value : Object.freeze({...rule.value});
  const nodeIcon = rule.nodeIcon === undefined ? undefined : Object.freeze({...rule.nodeIcon});
  return Object.freeze({...rule, value, ...(nodeIcon === undefined ? {} : {nodeIcon})});
}

/**
 * CSS 与 rule 不做内容合成；这里只保留存在 CSS class、regex 合法且静态签名唯一的规则。
 * Node 仅临时构造 RegExp 验证 source，缓存中仍保留可传输的 `{regex: source}`。
 */
export function validateUserStyle(cssSource: UserCssSource, ruleConfigs: ReadonlyArray<UserCssStyleRuleConfig>): SerializableUserStyle {
  const validRules: Array<UserCssStyleRuleConfig> = [];
  const seenRuleIds = new Set<string>();
  const ruleIndexBySignature = new Map<string, number>();

  for (const [ruleIndex, ruleConfig] of ruleConfigs.entries()) {
    if (seenRuleIds.has(ruleConfig.id)) {
      logger.warning("skip_duplicate_user_css_style_rule", {rule_index: ruleIndex, rule_id: ruleConfig.id});
      continue;
    }
    if (!cssSource.classNames.has(ruleConfig.className)) {
      logger.warning("skip_user_css_style_rule_without_class", {rule_index: ruleIndex, rule_id: ruleConfig.id, class_name: ruleConfig.className});
      continue;
    }

    try {
      if (typeof ruleConfig.value !== "string") new RegExp(ruleConfig.value.regex, "u");
      const frozenRule = freezeRule(ruleConfig);
      const signature = getRuleSignature(ruleConfig);
      const duplicateIndex = ruleIndexBySignature.get(signature);
      if (duplicateIndex === undefined) {
        ruleIndexBySignature.set(signature, validRules.length);
        validRules.push(frozenRule);
      } else {
        const existingRule = validRules[duplicateIndex];
        const keepNewRule = frozenRule.priority > existingRule.priority;
        if (keepNewRule) validRules[duplicateIndex] = frozenRule;
        logger.warning("deduplicate_user_css_style_rule", {
          rule_index: ruleIndex,
          kept_rule_id: keepNewRule ? frozenRule.id : existingRule.id,
          skipped_rule_id: keepNewRule ? existingRule.id : frozenRule.id,
        });
      }
      seenRuleIds.add(ruleConfig.id);
    } catch (error) {
      // regex 是单条可跳过错误，不应使其他用户规则失效。
      logger.warning("skip_invalid_user_css_style_rule_regex", {
        rule_index: ruleIndex,
        rule_id: ruleConfig.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return Object.freeze({css: cssSource.css, rules: Object.freeze(validRules)});
}
