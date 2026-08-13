/**
 * 浏览器地图样式初始化入口；必须在 Leaflet 与 Overlay 创建前完成。
 *
 * 完整顺序固定为：注入已校验用户 CSS → 编译用户 rule → 读取内置 bundle → 合并并建立索引。
 * Leaflet 只接收最终 RuntimeStylePlan，不参与 CSS 校验、regex 编译或优先级处理。
 */

import type {LeafletConfigType} from "../../models/config-models.js";
import type {CanvasBaseStyleRecipe} from "../../models/style/base-canvas-style.js";
import type {RuntimeStylePlan} from "../../models/style/runtime-style-models.js";
import type {RenderStylePayload} from "../../models/style/user-css-style-models.js";
import {AppError} from "../../utils/app-error.js";
import {getBuiltInStyle} from "./built-in-style-loader.js";
import {compileUserStyle} from "./runtime-style-compiler.js";
import {createRuntimeStylePlan} from "./runtime-style-plan.js";
import {installUserStyleCss} from "./user-style-injector.js";

let cachedRuntimeStylePlan: RuntimeStylePlan | null = null;

/**
 * Canvas recipe 是启动期可信配置，超限直接终止初始化；这与运行时 CSS 超限只 warning 不同。
 * 检查统一放在计划构建后，built-in 与未来可传输的 Canvas recipe 因而遵守同一组边界。
 */
function validateCanvasVisualLimits(plan: RuntimeStylePlan, limits: LeafletConfigType["visual_limits"]): void {
  const validateRecipe = (styleId: string, recipe: CanvasBaseStyleRecipe): void => {
    for (const operation of recipe.operations) {
      if (operation.kind === "circle") {
        if (!Number.isFinite(operation.radius) || operation.radius <= 0) throw new AppError("invalid_render_style", `Canvas style "${styleId}" has an invalid node radius`);
        if (operation.radius > limits.max_canvas_node_radius_px) throw new AppError("invalid_render_style", `Canvas style "${styleId}" exceeds max_canvas_node_radius_px`);
        if (!Number.isFinite(operation.strokeWidth) || operation.strokeWidth < 0) throw new AppError("invalid_render_style", `Canvas style "${styleId}" has an invalid node stroke width`);
        if (operation.strokeWidth > limits.max_canvas_stroke_width_px) throw new AppError("invalid_render_style", `Canvas style "${styleId}" exceeds max_canvas_stroke_width_px`);
      } else {
        const strokeWidth = operation.kind === "line" ? operation.width : operation.strokeWidth;
        if (!Number.isFinite(strokeWidth) || strokeWidth < 0 || (operation.kind === "line" && strokeWidth === 0)) {
          throw new AppError("invalid_render_style", `Canvas style "${styleId}" has an invalid stroke width`);
        }
        if (strokeWidth > limits.max_canvas_stroke_width_px) throw new AppError("invalid_render_style", `Canvas style "${styleId}" exceeds max_canvas_stroke_width_px`);
      }
    }
  };
  for (const [styleId, recipe] of Object.entries(plan.canvasStyles)) validateRecipe(styleId, recipe);
}

/**
 * 先安装用户 CSS，再编译并合并规则。同步返回保证调用方可以在 React 挂载地图前
 * 完成整个样式准备过程，不把 RegExp 编译或索引重建带入 Feature 热路径。
 */
export function initializeRuntimeStyle(
  renderStyle: RenderStylePayload,
  leafletConfig: LeafletConfigType,
  targetDocument: Document = document,
): RuntimeStylePlan {
  // 若本次 payload 编译失败，不允许后续调用方继续读取上一份地图留下的旧计划。
  cachedRuntimeStylePlan = null;
  installUserStyleCss(renderStyle.user_css, targetDocument);
  const userBundle = compileUserStyle(renderStyle.user_rules);
  // createRuntimeStylePlan 返回冻结快照；后续每个 Feature 只读这一个缓存。
  const nextPlan = createRuntimeStylePlan(getBuiltInStyle(), userBundle);
  validateCanvasVisualLimits(nextPlan, leafletConfig.visual_limits);
  // 只有全部初始化步骤成功后才发布缓存，失败路径不会暴露半初始化计划。
  cachedRuntimeStylePlan = nextPlan;
  return cachedRuntimeStylePlan;
}

/** Overlay renderer 后续只读取已冻结计划，不在首次 Feature 到来时隐式初始化。 */
export function getRuntimeStylePlan(): RuntimeStylePlan {
  if (cachedRuntimeStylePlan === null) throw new AppError("missing_render_style", "Runtime style plan has not been initialized");
  return cachedRuntimeStylePlan;
}
