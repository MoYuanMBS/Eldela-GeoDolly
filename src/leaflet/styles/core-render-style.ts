/** Core Overlay 固定 Canvas 样式；不进入 RuntimeStylePlan，也不接受用户 CSS。 */

import type {CanvasCircleOperation, CanvasLineOperation} from "../../models/style/base-canvas-style.js";

interface CoreRenderStyle {
  pointOperation: CanvasCircleOperation;
  lineOperation: CanvasLineOperation;
  areaOutline: Readonly<{color: string; opacity: number; width: number}>;
  areaBand: Readonly<{color: string; opacity: number; width: number}>;
}

const CORE_COLOR = "#d81b60";

export const CORE_RENDER_STYLE = Object.freeze({
  pointOperation: Object.freeze({
    kind: "circle",
    radius: 6,
    fillColor: CORE_COLOR,
    fillOpacity: 0.3,
    strokeColor: CORE_COLOR,
    strokeOpacity: 0,
    strokeWidth: 0,
  }),
  lineOperation: Object.freeze({
    kind: "line",
    color: CORE_COLOR,
    opacity: 0.3,
    width: 7,
    lineCap: "round",
    lineJoin: "round",
  }),
  areaOutline: Object.freeze({color: CORE_COLOR, opacity: 0.5, width: 1.5}),
  areaBand: Object.freeze({color: "#f06292", opacity: 0.3, width: 12}),
}) satisfies CoreRenderStyle;
