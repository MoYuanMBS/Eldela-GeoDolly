import geodesicLibrary from "geographiclib-geodesic";
import {MEASURE_TOOL_BUILT_IN_CONFIG} from "../../built-in-config/measure-tool.js";
import type {CircleGeodesicMeasurement, PolygonGeodesicMeasurement} from "../../models/measure-tools/measurement-geodesy-models.js";
import type {MeasureCoordinateType} from "../../models/measure-tools/measure-tool-models.js";
import {AppError} from "../../utils/app-error.js";

// 该 npm 包的 runtime 是 CommonJS；使用 synthetic default 同时兼容 NodeNext local test 与 Vite Browser bundle。
const {Geodesic} = geodesicLibrary;

interface SegmentInverseResult {
  distanceMeters: number;
}

/** 外部点击坐标在进入 GeographicLib 前统一守住有限值与纬度范围。 */
function assertCoordinate(coordinate: MeasureCoordinateType): void {
  if (!Number.isFinite(coordinate.latitude) || coordinate.latitude < -90 || coordinate.latitude > 90 || !Number.isFinite(coordinate.longitude)) {
    throw new AppError("measurement_geodesy_failed", "Measure Tool received a non-finite or out-of-range coordinate");
  }
}

/** GeographicLib 的可选返回字段在此收口，调用方只消费确定的非负 number。 */
function assertFiniteNonNegative(value: number | undefined, label: string): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    throw new AppError("measurement_geodesy_failed", `GeographicLib returned an invalid ${label}`);
  }
  return value;
}

function inverseSegment(start: MeasureCoordinateType, end: MeasureCoordinateType): SegmentInverseResult {
  assertCoordinate(start);
  assertCoordinate(end);
  const result = Geodesic.WGS84.Inverse(start.latitude, start.longitude, end.latitude, end.longitude);
  return {
    distanceMeters: assertFiniteNonNegative(result.s12, "distance"),
  };
}

/** WGS84 逐段累加；不使用 Leaflet CRS 的球面 distance 作为结算值。 */
export function calculateLineLengthMeters(coordinates: readonly MeasureCoordinateType[]): number {
  let totalMeters = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    totalMeters += inverseSegment(coordinates[index - 1], coordinates[index]).distanceMeters;
  }
  return assertFiniteNonNegative(totalMeters, "line length");
}

export function calculatePolygonGeodesy(coordinates: readonly MeasureCoordinateType[]): PolygonGeodesicMeasurement {
  if (coordinates.length < 3) {
    throw new AppError("measurement_geodesy_failed", "Polygon measurement requires at least three vertices");
  }
  const polygon = Geodesic.WGS84.Polygon(false);
  for (const coordinate of coordinates) {
    assertCoordinate(coordinate);
    polygon.AddPoint(coordinate.latitude, coordinate.longitude);
  }
  // reverse=false 保持输入方向；sign=true 保留代数面积，业务层随后统一取绝对值。
  const result = polygon.Compute(false, true);
  return Object.freeze({
    perimeterMeters: assertFiniteNonNegative(result.perimeter, "polygon perimeter"),
    areaSquareMeters: assertFiniteNonNegative(result.area === undefined ? undefined : Math.abs(result.area), "polygon area"),
  });
}

/** 自相交 Polygon 只保留周长时使用，避免把 GeographicLib 的代数面积当成业务面积。 */
export function calculateClosedPathPerimeterMeters(coordinates: readonly MeasureCoordinateType[]): number {
  if (coordinates.length < 2) return 0;
  return calculateLineLengthMeters([...coordinates, coordinates[0]]);
}

export function calculateDestination(
  start: MeasureCoordinateType,
  azimuthDegrees: number,
  distanceMeters: number,
): MeasureCoordinateType {
  assertCoordinate(start);
  if (!Number.isFinite(azimuthDegrees) || !Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new AppError("measurement_geodesy_failed", "Measure Tool received an invalid destination input");
  }
  // LONG_UNROLL 保留连续世界副本，避免跨日期变更线时突然折回 [-180, 180]。
  const result = Geodesic.WGS84.Direct(
    start.latitude,
    start.longitude,
    azimuthDegrees,
    distanceMeters,
    Geodesic.STANDARD | Geodesic.LONG_UNROLL,
  );
  if (result.lat2 === undefined || result.lon2 === undefined || !Number.isFinite(result.lat2) || !Number.isFinite(result.lon2)) {
    throw new AppError("measurement_geodesy_failed", "GeographicLib returned an invalid destination");
  }
  return Object.freeze({latitude: result.lat2, longitude: result.lon2});
}

function calculateSampledCircleArea(
  center: MeasureCoordinateType,
  radiusMeters: number,
  sampleCount: number,
): number {
  const polygon = Geodesic.WGS84.Polygon(false);
  // 等方位角采样构成测地多边形；该近似只用于 Circle finalize，不进入 mousemove 热路径。
  for (let index = 0; index < sampleCount; index += 1) {
    const point = calculateDestination(center, index * 360 / sampleCount, radiusMeters);
    polygon.AddPoint(point.latitude, point.longitude);
  }
  const result = polygon.Compute(false, true);
  return assertFiniteNonNegative(result.area === undefined ? undefined : Math.abs(result.area), "circle area");
}

/** Circle 面积只在 finalize 计算；预览阶段只调用 distance。 */
export function calculateCircleGeodesy(
  center: MeasureCoordinateType,
  radiusPoint: MeasureCoordinateType,
): CircleGeodesicMeasurement {
  const radiusMeters = inverseSegment(center, radiusPoint).distanceMeters;
  if (radiusMeters <= 0) {
    throw new AppError("measurement_geodesy_failed", "Circle measurement requires a positive radius");
  }
  const {coarseSampleCount, fineSampleCount} = MEASURE_TOOL_BUILT_IN_CONFIG.circle;
  const coarseArea = calculateSampledCircleArea(center, radiusMeters, coarseSampleCount);
  const fineArea = calculateSampledCircleArea(center, radiusMeters, fineSampleCount);
  // 两级采样按二阶误差模型外推，降低单独使用 512 边形的离散误差。
  const areaSquareMeters = (4 * fineArea - coarseArea) / 3;
  return Object.freeze({
    radiusMeters,
    areaSquareMeters: assertFiniteNonNegative(areaSquareMeters, "extrapolated circle area"),
  });
}
