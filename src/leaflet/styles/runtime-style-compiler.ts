/**
 * 用户样式的浏览器编译阶段。
 *
 * Node 已完成 CSS 读取、class 对照和规则校验；CSS 由浏览器独立注入，这里仅恢复
 * RegExp、转换 priority 分区，并输出与 built-in loader 相同的规则 bundle。
 */

import {USER_STYLE_PRIORITY_OFFSET} from "../../models/built-in-style-models.js";
import type {CompiledStyleBundle, CompiledStyleRule} from "../../models/style/runtime-style-models.js";
import type {UserCssStyleRuleConfig} from "../../models/style/user-css-style-models.js";

/** 把可序列化的 regex source 恢复为运行时 RegExp；exact value 保持字符串。 */
function compileValueMatcher(rule: UserCssStyleRuleConfig): string | RegExp {
  if (typeof rule.value === "string") return rule.value;
  try {
    return Object.freeze(new RegExp(rule.value.regex, "u"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to compile user style rule "${rule.id}" regex: ${reason}`);
  }
}

/**
 * 用户 rule 已携带拍平的 kind/className；这里只把 priority 整体移入 500+ 分区。
 * 转换后 RuntimeStylePlan 无需识别规则来自 built-in 还是 user。
 */
function compileRule(rule: UserCssStyleRuleConfig): CompiledStyleRule {
  const compiledRule = {
    ...rule,
    priority: rule.priority + USER_STYLE_PRIORITY_OFFSET,
    value: compileValueMatcher(rule),
  };
  switch (compiledRule.renderLayer) {
    case "border": return Object.freeze(compiledRule);
    case "base": return Object.freeze(compiledRule);
    case "translucent": return Object.freeze(compiledRule);
  }
}

/** 用户目前只提供 CSS rule，因此 Canvas recipe 与默认 Canvas style 映射保持为空。 */
export function compileUserStyle(rules: ReadonlyArray<UserCssStyleRuleConfig>): CompiledStyleBundle {
  return Object.freeze({
    canvasStyles: Object.freeze({}),
    defaultBaseStyleIds: Object.freeze({}),
    rules: Object.freeze(rules.map(compileRule)),
  });
}
