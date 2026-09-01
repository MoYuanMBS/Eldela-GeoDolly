/** Interactive Measure Tool 对 React 公开的纯数据模型。 */

export type MeasureToolModeType = "idle" | "draw_path" | "draw_circle";
/** finalize 后固定的业务类型，不随后续 zoom 或样式变化重新分类。 */
export type CompletedMeasurementKindType = "line" | "polygon" | "circle";
/** warning 属于可展示的业务结果，不等同于 Controller 执行失败。 */
export type MeasurementWarningCodeType = "self_intersection";

/** longitude 可使用连续世界副本，因此不限定在 [-180, 180]。 */
export interface MeasureCoordinateType {
  latitude: number;
  longitude: number;
}

export interface LineMeasurementType {
  /** 页面内存中的稳定标识，不伪造 Overlay feature_id。 */
  measurementId: string;
  kind: "line";
  lengthMeters: number;
  warning: null;
}

export interface PolygonMeasurementType {
  measurementId: string;
  kind: "polygon";
  perimeterMeters: number;
  /** 自相交时面积没有业务意义，因此显式使用 null 而不是 0。 */
  areaSquareMeters: number | null;
  warning: MeasurementWarningCodeType | null;
}

export interface CircleMeasurementType {
  measurementId: string;
  kind: "circle";
  radiusMeters: number;
  areaSquareMeters: number;
  warning: null;
}

export type CompletedMeasurementType = LineMeasurementType | PolygonMeasurementType | CircleMeasurementType;

export interface ActiveMeasurementTargetType {
  /** selection 永远高于 hover，由 Controller 在发布前完成优先级归一化。 */
  interactionState: "hover" | "selected";
  measurement: CompletedMeasurementType;
}

export type DraftMeasurementType =
  // Path 在 finalize 前不预判 Line/Polygon，只报告当前累计长度和已提交顶点数。
  | {kind: "path"; vertexCount: number; lengthMeters: number}
  // Circle 第一次 click 后只有圆心；有有效半径点后才发布 radiusMeters。
  | {kind: "circle"; centerPlaced: boolean; radiusMeters: number | null};

/**
 * Controller 对 UI 公布的当前状态；名称刻意不使用 snapshot，避免与
 * Snapshot Browser Flow 混淆。
 */
export interface MeasureToolUiStateType {
  /** 每次发布递增，便于外部订阅者识别同一对象之外的状态变化。 */
  revision: number;
  mode: MeasureToolModeType;
  draftMeasurement: DraftMeasurementType | null;
  /** 最近一次完成结果服务 HUD，不代表它当前正处于 hover 或 selection。 */
  latestMeasurement: CompletedMeasurementType | null;
  hoveredMeasurement: CompletedMeasurementType | null;
  selectedMeasurement: CompletedMeasurementType | null;
  completedCount: number;
  /** 只存用户可读错误；无效 finalize 等正常交互不进入该字段。 */
  errorMessage: string | null;
}

export const INITIAL_MEASURE_TOOL_UI_STATE: MeasureToolUiStateType = Object.freeze({
  revision: 0,
  mode: "idle",
  draftMeasurement: null,
  latestMeasurement: null,
  hoveredMeasurement: null,
  selectedMeasurement: null,
  completedCount: 0,
  errorMessage: null,
});
