/**
 * 浏览器地图样式初始化入口；必须在 Leaflet 与 Overlay 创建前完成。
 *
 * 完整顺序固定为：注入已校验用户 CSS → 编译用户 rule → 读取内置 bundle → 合并并建立索引。
 * Leaflet 只接收最终 RuntimeStylePlan，不参与 CSS 校验、regex 编译或优先级处理。
 */

import type {RuntimeStylePlan} from "../../models/style/runtime-style-models.js";
import type {RenderStylePayload} from "../../models/style/user-css-style-models.js";
import {getBuiltInStyle} from "./built-in-style-loader.js";
import {compileUserStyle} from "./runtime-style-compiler.js";
import {createRuntimeStylePlan} from "./runtime-style-plan.js";
import {installUserStyleCss} from "./user-style-injector.js";

let cachedRuntimeStylePlan: RuntimeStylePlan | null = null;

/**
 * 先安装用户 CSS，再编译并合并规则。同步返回保证调用方可以在 React 挂载地图前
 * 完成整个样式准备过程，不把 RegExp 编译或索引重建带入 Feature 热路径。
 */
export function initializeRuntimeStyle(renderStyle: RenderStylePayload, targetDocument: Document = document): RuntimeStylePlan {
  // 若本次 payload 编译失败，不允许后续调用方继续读取上一份地图留下的旧计划。
  cachedRuntimeStylePlan = null;
  installUserStyleCss(renderStyle.user_css, targetDocument);
  const userBundle = compileUserStyle(renderStyle.user_rules);
  // createRuntimeStylePlan 返回冻结快照；后续每个 Feature 只读这一个缓存。
  cachedRuntimeStylePlan = createRuntimeStylePlan(getBuiltInStyle(), userBundle);
  return cachedRuntimeStylePlan;
}

/** Overlay renderer 后续只读取已冻结计划，不在首次 Feature 到来时隐式初始化。 */
export function getRuntimeStylePlan(): RuntimeStylePlan {
  if (cachedRuntimeStylePlan === null) throw new Error("Runtime style plan has not been initialized");
  return cachedRuntimeStylePlan;
}
