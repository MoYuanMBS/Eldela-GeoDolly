/** 进程级样式缓存；模块首次加载时构建一次，后续 import 直接复用。 */

import {BUILT_IN_CANVAS_STYLE_RULES} from "../leaflet/styles/built-in-style-rules.js";
import type {PreparedStyleCache, PreparedStyleRule} from "../models/style/user-css-style-models.js";
import {config} from "./config-loader.js";
import {userCssLoader} from "./user-css-loader.js";
import {prepareUserStyle} from "./user-style-rule-resolver.js";

function buildStyleCache(): PreparedStyleCache {
  const rawCss = userCssLoader.getCss();
  const rawUserRules = config.getUserStyleRules();
  try {
    const preparedUserStyle = prepareUserStyle(rawCss, rawUserRules);
    const rules: Array<PreparedStyleRule> = [];

    // 用户规则排在前面便于后续单次候选遍历，但最终优先级仍应读取 source，不能只依赖数组顺序。
    for (const rule of preparedUserStyle.rules) rules.push(Object.freeze({...rule, source: "user"}));
    for (const rule of BUILT_IN_CANVAS_STYLE_RULES) rules.push(Object.freeze({...rule, source: "builtIn"}));

    return Object.freeze({css: preparedUserStyle.css, rules: Object.freeze(rules)});
  } finally {
    // 正式缓存已经持有处理后的 CSS/rules；释放 loader 的重复 raw 引用，且不支持运行期热更新。
    userCssLoader.resetCache();
    config.clearUserStyleRulesCache();
  }
}

export const USER_STYLE_CACHE = buildStyleCache();
