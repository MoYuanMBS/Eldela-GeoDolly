/** Core Overlay 固定 Canvas 样式；不进入 RuntimeStylePlan，也不接受用户 CSS。 */

import type {CanvasCircleOperation, CanvasLineOperation} from "../../models/style/base-canvas-style.js";

interface CoreRenderStyle {
  pointOperations: readonly [CanvasCircleOperation, CanvasCircleOperation];
  lineOperations: readonly [CanvasLineOperation, CanvasLineOperation];
  areaBand: Readonly<{color: string; opacity: number; width: number}>;
}

export const CORE_RENDER_STYLE = Object.freeze({
  pointOperations: Object.freeze([{
    kind: "circle",
    radius: 5,
    fillColor: "#ffffff",
    fillOpacity: 1,
    strokeColor: "#d81b60",
    strokeOpacity: 1,
    strokeWidth: 1.5,
  }, {
    kind: "circle",
    radius: 1.5,
    fillColor: "#d81b60",
    fillOpacity: 1,
    strokeColor: "#d81b60",
    strokeOpacity: 0,
    strokeWidth: 0,
  }] as const),
  lineOperations: Object.freeze([{
    kind: "line",
    color: "#7a1238",
    opacity: 1,
    width: 7,
    lineCap: "round",
    lineJoin: "round",
  }, {
    kind: "line",
    color: "#d81b60",
    opacity: 1,
    width: 4,
    lineCap: "round",
    lineJoin: "round",
  }] as const),
  areaBand: Object.freeze({color: "#d81b60", opacity: 1, width: 12}),
}) satisfies CoreRenderStyle;
