import {latLng, type Map as LeafletMap, type Point} from "leaflet";
import {MEASURE_TOOL_BUILT_IN_CONFIG} from "../../built-in-config/measure-tool.js";
import type {MeasureCoordinateType} from "../../../models/measure-tools/measure-tool-models.js";

type FinalizedPathClassification =
  | {kind: "invalid"; coordinates: readonly MeasureCoordinateType[]}
  | {kind: "line"; coordinates: readonly MeasureCoordinateType[]}
  | {kind: "polygon"; coordinates: readonly MeasureCoordinateType[]; selfIntersects: boolean};

function toContainerPoint(map: LeafletMap, coordinate: MeasureCoordinateType): Point {
  return map.latLngToContainerPoint(latLng(coordinate.latitude, coordinate.longitude));
}

function removeConsecutiveDuplicateVertices(
  map: LeafletMap,
  coordinates: readonly MeasureCoordinateType[],
): MeasureCoordinateType[] {
  // 只消除连续误触；不删除稍后再次经过的顶点，否则会改变自相交语义。
  const result: MeasureCoordinateType[] = [];
  for (const coordinate of coordinates) {
    const previous = result.at(-1);
    if (previous !== undefined && toContainerPoint(map, previous).distanceTo(toContainerPoint(map, coordinate)) <= MEASURE_TOOL_BUILT_IN_CONFIG.duplicateVertexThresholdPx) {
      continue;
    }
    result.push(coordinate);
  }
  return result;
}

function countDistinctScreenVertices(map: LeafletMap, coordinates: readonly MeasureCoordinateType[]): number {
  // 有效性与闭合都是当前视觉交互语义，因此使用 CSS 像素而不是经纬度 epsilon。
  const uniquePoints: Point[] = [];
  for (const coordinate of coordinates) {
    const point = toContainerPoint(map, coordinate);
    if (uniquePoints.every((candidate) => candidate.distanceTo(point) > MEASURE_TOOL_BUILT_IN_CONFIG.duplicateVertexThresholdPx)) {
      uniquePoints.push(point);
    }
  }
  return uniquePoints.length;
}

function orientation(first: Point, second: Point, third: Point): number {
  const cross = (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);
  if (Math.abs(cross) <= Number.EPSILON) return 0;
  return cross > 0 ? 1 : -1;
}

function isPointOnSegment(start: Point, end: Point, point: Point): boolean {
  return point.x >= Math.min(start.x, end.x) && point.x <= Math.max(start.x, end.x)
    && point.y >= Math.min(start.y, end.y) && point.y <= Math.max(start.y, end.y);
}

function segmentsIntersect(firstStart: Point, firstEnd: Point, secondStart: Point, secondEnd: Point): boolean {
  // 一般相交之外还覆盖共线端点/重叠段；相邻边由外层循环提前排除。
  const firstSecondStart = orientation(firstStart, firstEnd, secondStart);
  const firstSecondEnd = orientation(firstStart, firstEnd, secondEnd);
  const secondFirstStart = orientation(secondStart, secondEnd, firstStart);
  const secondFirstEnd = orientation(secondStart, secondEnd, firstEnd);
  if (firstSecondStart !== firstSecondEnd && secondFirstStart !== secondFirstEnd) return true;
  return (firstSecondStart === 0 && isPointOnSegment(firstStart, firstEnd, secondStart))
    || (firstSecondEnd === 0 && isPointOnSegment(firstStart, firstEnd, secondEnd))
    || (secondFirstStart === 0 && isPointOnSegment(secondStart, secondEnd, firstStart))
    || (secondFirstEnd === 0 && isPointOnSegment(secondStart, secondEnd, firstEnd));
}

/**
 * 闭合 Path 按当前 Web Mercator 连续世界副本做 O(n²) 相交检查。相邻边共享顶点
 * 是正常闭合，只检查非相邻边。
 */
export function hasProjectedSelfIntersection(map: LeafletMap, coordinates: readonly MeasureCoordinateType[]): boolean {
  const points = coordinates.map((coordinate) => map.project(latLng(coordinate.latitude, coordinate.longitude), map.getZoom()));
  const edgeCount = points.length;
  for (let firstIndex = 0; firstIndex < edgeCount; firstIndex += 1) {
    const firstNext = (firstIndex + 1) % edgeCount;
    for (let secondIndex = firstIndex + 1; secondIndex < edgeCount; secondIndex += 1) {
      const secondNext = (secondIndex + 1) % edgeCount;
      const adjacent = firstIndex === secondIndex || firstNext === secondIndex || secondNext === firstIndex;
      if (adjacent) continue;
      if (segmentsIntersect(points[firstIndex], points[firstNext], points[secondIndex], points[secondNext])) return true;
    }
  }
  return false;
}

/** finalize 前不推断类型；只在最终屏幕像素距离上区分 Line/Polygon。 */
export function classifyFinalizedPath(
  map: LeafletMap,
  coordinates: readonly MeasureCoordinateType[],
): FinalizedPathClassification {
  const normalizedCoordinates = removeConsecutiveDuplicateVertices(map, coordinates);
  if (countDistinctScreenVertices(map, normalizedCoordinates) < 2) {
    return Object.freeze({kind: "invalid", coordinates: Object.freeze(normalizedCoordinates)});
  }
  const first = normalizedCoordinates[0];
  const last = normalizedCoordinates.at(-1);
  if (last !== undefined && toContainerPoint(map, first).distanceTo(toContainerPoint(map, last)) <= MEASURE_TOOL_BUILT_IN_CONFIG.pathCloseSnapThresholdPx) {
    // 闭合点只表达用户意图；Leaflet Polygon 和 GeographicLib 都自行闭合，不重复保存首点。
    const polygonCoordinates = normalizedCoordinates.slice(0, -1);
    if (countDistinctScreenVertices(map, polygonCoordinates) >= 3) {
      return Object.freeze({
        kind: "polygon",
        coordinates: Object.freeze(polygonCoordinates),
        selfIntersects: hasProjectedSelfIntersection(map, polygonCoordinates),
      });
    }
  }
  // 顶点数足够但没有在屏幕阈值内闭合时仍然是 Line，不依据面积或标签推断类型。
  return Object.freeze({kind: "line", coordinates: Object.freeze(normalizedCoordinates)});
}
