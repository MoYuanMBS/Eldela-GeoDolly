/** Node / Way / Area Base recipe 共用的 Canvas operation 模型。 */

export type CanvasSpatialFeatureType = "node" | "way" | "area";
export type CanvasLineCap = "butt" | "round" | "square";
export type CanvasLineJoin = "bevel" | "miter" | "round";

export interface CanvasCircleOperation {
  kind: "circle";
  radius: number;
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
}

export interface CanvasLineOperation {
  kind: "line";
  color: string;
  opacity: number;
  width: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  dash?: ReadonlyArray<number>;
}

export interface CanvasAreaOperation {
  kind: "area";
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
}

export type CanvasDrawOperation = CanvasCircleOperation | CanvasLineOperation | CanvasAreaOperation;

export interface CanvasBaseStyleRecipe {
  featureType: CanvasSpatialFeatureType;
  /** Area relation 内侧填充带需要复用的 Base 主色。 */
  mainColor?: string;
  operations: ReadonlyArray<CanvasDrawOperation>;
}

/** Relation membership 进入运行时计划的固定颜色参数。 */
export interface CanvasRelationMembershipStyle {
  defaultColor: string;
  opacity: number;
}
