/** Node 用户样式系统唯一公开入口；初始化后只暴露冻结的可序列化结果。 */

import type {SerializableUserStyle} from "../models/style/user-css-style-models.js";
import {logger} from "./logger.js";
import {userCssLoader} from "./style/user-css-loader.js";
import {userStyleConfigLoader} from "./style/user-style-config-loader.js";
import {validateUserStyle} from "./style/user-style-validator.js";

let cachedUserStyle: SerializableUserStyle | null = null;

/** 重新读取并校验用户样式；已有结果和原始数据缓存会在读取前清空。 */
export function initializeUserStyle(): SerializableUserStyle {
  if (cachedUserStyle !== null) {
    cachedUserStyle = null;
    userCssLoader.resetCache();
    userStyleConfigLoader.resetCache();
  }
  try {
    const rawCssSource = userCssLoader.getSource();
    const rawUserRules = userStyleConfigLoader.getRules();
    cachedUserStyle = validateUserStyle(rawCssSource, rawUserRules);
    return cachedUserStyle;
  } finally {
    // 最终缓存已持有合法 CSS/rules，立即释放两份只用于启动校验的 raw cache。
    userCssLoader.resetCache();
    userStyleConfigLoader.resetCache();
  }
}

/** 其他 Node 模块只从这里读取；缓存为空时记录 warning 并自动完成初始化。 */
export function getUserStyle(): SerializableUserStyle {
  if (cachedUserStyle === null) {
    logger.warning("user_style_initialized_on_first_read", {reason: "cache_empty"});
    return initializeUserStyle();
  }
  return cachedUserStyle;
}
