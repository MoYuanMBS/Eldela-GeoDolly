import type {CanvasSpatialFeatureType} from "../mapsurface/style/base-canvas-style.js";

/** React 与后续 DrawingController 共享的可序列化工具状态。 */
export type DrawingUiModeType = "idle" | "draw_path" | "draw_circle";

/** selected/hover 解析完成后交给 Interactive UI 的最小空间对象摘要。 */
export interface InteractiveFeatureSummaryType {
  featureType: CanvasSpatialFeatureType;
  displayId: string;
  name: string | null;
}
