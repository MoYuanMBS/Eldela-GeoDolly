/** 启动阶段整理用户 CSS 与 rule；本模块不读取正式 Feature，也不执行 tag 匹配。 */

import {transform, type Selector} from "lightningcss";
import type {
  UserCssStyleRule,
  UserCssStyleRuleConfig,
  UserCssValueMatcher,
} from "../models/style/user-css-style-models.js";
import {logger} from "./logger.js";

const OVERLAY_SCOPE_CLASS = "geomcp-user-overlay";

/**
 * 从一个 selector 中收集真正作用于 Overlay Feature 元素的 class。
 * combinator 会开启新的 compound，因此 `.geomcp-user-overlay .label` 中的 label 不会被误收集。
 */
function collectOverlayClassNames(selector: Selector, output: Set<string>): void {
  let compoundClassNames: Array<string> = [];
  const flushCompound = (): void => {
    // className 必须与 Overlay 作用域位于同一 compound selector，避免把后代 UI class 误认为 Feature 样式。
    if (compoundClassNames.includes(OVERLAY_SCOPE_CLASS)) {
      for (const className of compoundClassNames) output.add(className);
    }
    compoundClassNames = [];
  };

  for (const component of selector) {
    if (component.type === "combinator") flushCompound();
    else if (component.type === "class") compoundClassNames.push(component.name);
  }
  flushCompound();
}

/**
 * CSS loader 只负责得到完整 CSS 文本；跨文件的 class/rule 对照在这里完成。
 * 使用 AST visitor 而不是字符串搜索，避免注释、声明值或相似 class 名造成误判。
 */
function extractOverlayClassNames(css: string): ReadonlySet<string> {
  const classNames = new Set<string>();
  const result = transform({
    filename: "config/style/style.css",
    code: Buffer.from(css),
    minify: false,
    sourceMap: false,
    errorRecovery: false,
    visitor: {Selector: (selector) => collectOverlayClassNames(selector, classNames)},
  });
  if (result.warnings.length > 0) throw new Error(`Invalid user CSS: ${result.warnings[0].message}`);
  return classNames;
}

/** 将 YAML 中可序列化的 value matcher 转成启动后复用的运行时 matcher。 */
function compileValueMatcher(matcher: UserCssStyleRuleConfig["value"]): UserCssValueMatcher {
  // 只有 value 可以保存 regex source；在绘制循环外统一编译，避免每个 Feature 重建 RegExp。
  return typeof matcher === "string" ? matcher : new RegExp(matcher.regex, "u");
}

/** 保留三种 renderLayer 的可辨识联合，同时把 value regex source 编译为 RegExp。 */
function compileRule(rule: UserCssStyleRuleConfig): UserCssStyleRule {
  const common = {
    id: rule.id,
    priority: rule.priority,
    key: rule.key,
    value: compileValueMatcher(rule.value),
    className: rule.className,
  };
  if (rule.renderLayer === "base") return {...common, renderLayer: "base", featureType: rule.featureType};
  if (rule.renderLayer === "border") {
    return {...common, renderLayer: "border", featureType: rule.featureType, effectType: rule.effectType};
  }
  return {...common, renderLayer: "translucent", featureType: rule.featureType, effectType: rule.effectType};
}

/**
 * 构造与 ID、priority 无关的静态绘制签名。
 * exact 与 regex 显式区分，避免相同文本在两种 matcher 语义下被错误去重。
 */
function getRuleSignature(rule: UserCssStyleRuleConfig): string {
  const valueMatcher = typeof rule.value === "string" ? ["exact", rule.value] : ["regex", rule.value.regex];
  const effectType = rule.renderLayer === "base" ? null : rule.effectType;
  // ID 与 priority 不属于绘制语义；同签名规则只需保留 priority 较高的一条。
  return JSON.stringify([rule.renderLayer, rule.featureType, effectType, rule.key, valueMatcher, rule.className]);
}

/**
 * 将两个已加载的独立输入整理成唯一的启动期结果。
 * CSS 保持 CSS，rule 保持 rule；这里只过滤缺失 class、非法 regex 和重复规则。
 */
export function prepareUserStyle(css: string, ruleConfigs: ReadonlyArray<UserCssStyleRuleConfig>) {
  // CSS 本身不会与 rule 合成；这里只提取 class 集合用于筛掉无法生效的 rule。
  const availableClassNames = extractOverlayClassNames(css);
  const preparedRules: Array<UserCssStyleRule> = [];
  // ID 去重用于保证日志、调试和后续索引中的身份唯一。
  const seenRuleIds = new Set<string>();
  // 绘制签名去重处理“不同 ID 但实际规则相同”的情况，避免后续重复匹配和绘制。
  const ruleIndexBySignature = new Map<string, number>();
  for (const [ruleIndex, ruleConfig] of ruleConfigs.entries()) {
    if (seenRuleIds.has(ruleConfig.id)) {
      logger.warning("skip_duplicate_user_css_style_rule", {rule_index: ruleIndex, rule_id: ruleConfig.id});
      continue;
    }
    if (!availableClassNames.has(ruleConfig.className)) {
      logger.warning("skip_user_css_style_rule_without_class", {rule_index: ruleIndex, rule_id: ruleConfig.id, class_name: ruleConfig.className});
      continue;
    }
    try {
      const compiledRule = compileRule(ruleConfig);
      const signature = getRuleSignature(ruleConfig);
      const duplicateIndex = ruleIndexBySignature.get(signature);
      if (duplicateIndex === undefined) {
        // 首次出现的签名保留其当前位置，后续替换也不会改变规则顺序。
        ruleIndexBySignature.set(signature, preparedRules.length);
        preparedRules.push(compiledRule);
      } else {
        const existingRule = preparedRules[duplicateIndex];
        // 同签名规则只由 priority 决定保留项；相同 priority 保留先出现者，保证结果稳定。
        const keepNewRule = compiledRule.priority > existingRule.priority;
        if (keepNewRule) preparedRules[duplicateIndex] = compiledRule;
        logger.warning("deduplicate_user_css_style_rule", {rule_index: ruleIndex, kept_rule_id: keepNewRule ? compiledRule.id : existingRule.id,skipped_rule_id: keepNewRule ? existingRule.id : compiledRule.id });
      }
      seenRuleIds.add(ruleConfig.id);
    } catch (error) {
      // regex 是单条规则的可跳过错误，不应使其他用户规则失效。
      logger.warning("skip_invalid_user_css_style_rule_regex", {rule_index: ruleIndex, rule_id: ruleConfig.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  // 进程启动后不支持热更新；冻结顶层结果和规则数组，后续模块只读消费。
  return Object.freeze({css, rules: Object.freeze(preparedRules)});
}
