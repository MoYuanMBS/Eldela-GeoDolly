/**
 * iframe capture 共用的 Leaflet EPSG:3857 基础投影。
 */

import type { OverlayGeoJsonGeometryType } from "../models/backend/map-data-models.js";

// Leaflet CRS.EPSG3857 使用的纬度上限；超过后会投影到同一极区边界。
const MAX_MERCATOR_LATITUDE = 85.0511287798066;

type PointGeometry = Extract<OverlayGeoJsonGeometryType, { type: "Point" }>;
type LineGeometry = Extract<OverlayGeoJsonGeometryType, { type: "LineString" | "MultiLineString" }>;
type AreaGeometry = Extract<OverlayGeoJsonGeometryType, { type: "Polygon" | "MultiPolygon" }>;
type Position = PointGeometry["coordinates"];
type LineCoordinates = Extract<OverlayGeoJsonGeometryType, { type: "LineString" }>["coordinates"];
type PolygonCoordinates = Extract<OverlayGeoJsonGeometryType, { type: "Polygon" }>["coordinates"];

/**
 * 将经度投影为 Leaflet 使用的归一化 world X。
 * 这里只改变坐标空间，不负责选择跨日期变更线后的 world 副本。
 */
export function projectLongitude(longitude: number): number {
  return (longitude + 180) / 360;
}

/** 跨日期变更线时将 east 展开到 west 右侧的连续世界副本。 */
export function getContinuousEastLongitude(west: number, east: number): number {
  return east < west ? east + 360 : east;
}

/** 将纬度换算为归一化 world Y。 */
export function projectLatitude(latitude: number): number {
  const clampedLatitude = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude));
  const sinLatitude = Math.sin(clampedLatitude * Math.PI / 180);
  return 0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI);
}

/** 将归一化 world Y 反投影为纬度。 */
export function unprojectLatitude(projectedLatitude: number): number {
  const mercatorY = Math.PI - 2 * Math.PI * projectedLatitude;
  return Math.atan(Math.sinh(mercatorY)) * 180 / Math.PI;
}

//////////////////////geometry elements 坐标跨日期变更线展开并规范化//////////////////////

/**
 * 在 longitude + 360 × n 的等价经度中，选择最接近锚点经度的一项。
 * 锚点可以是地图中心经度，也可以是已展开线段的前一个点。
 */
function getNearestWorldLongitude(longitude: number, anchorLongitude: number): number {
  return longitude + 360 * Math.round((anchorLongitude - longitude) / 360);
}

/**
 * 将首点放到地图中心附近，后续点沿前一个结果逐点展开。
 * 这样保留原折线的相邻关系，避免跨 ±180° 的短线被画成长线。
 */
function getContinuousLineCoordinates(
  coordinates: LineCoordinates,
  centerLongitude: number
): LineCoordinates {
  if (coordinates.length === 0) {
    return [];
  }

  const firstPosition: Position = [
    getNearestWorldLongitude(coordinates[0][0], centerLongitude),
    coordinates[0][1]
  ];
  const continuousCoordinates: LineCoordinates = [firstPosition];

  for (let index = 1; index < coordinates.length; index += 1) {
    const position = coordinates[index];
    const previousPosition = continuousCoordinates[index - 1];
    continuousCoordinates.push([
      getNearestWorldLongitude(position[0], previousPosition[0]),
      position[1]
    ]);
  }

  return continuousCoordinates;
}

/** 返回已展开线段的经度范围中心；空线段使用传入的回退经度。 */
function getLineLongitudeCenter(coordinates: LineCoordinates, fallbackLongitude: number): number {
  if (coordinates.length === 0) {
    return fallbackLongitude;
  }

  let minimumLongitude = coordinates[0][0];
  let maximumLongitude = coordinates[0][0];
  for (let index = 1; index < coordinates.length; index += 1) {
    minimumLongitude = Math.min(minimumLongitude, coordinates[index][0]);
    maximumLongitude = Math.max(maximumLongitude, coordinates[index][0]);
  }
  return (minimumLongitude + maximumLongitude) / 2;
}

/** 展开 Polygon ring，并保持原本闭合的首尾坐标严格相同。 */
function getContinuousRingCoordinates(
  coordinates: LineCoordinates,
  centerLongitude: number
): LineCoordinates {
  const continuousCoordinates = getContinuousLineCoordinates(coordinates, centerLongitude);
  if (
    coordinates.length > 1
    && coordinates[0][0] === coordinates[coordinates.length - 1][0]
    && coordinates[0][1] === coordinates[coordinates.length - 1][1]
  ) {
    continuousCoordinates[continuousCoordinates.length - 1] = [...continuousCoordinates[0]];
  }
  return continuousCoordinates;
}

/** 先展开外环，再以外环中心为锚点展开所有内环。 */
function getContinuousPolygonCoordinates(
  coordinates: PolygonCoordinates,
  centerLongitude: number
): PolygonCoordinates {
  if (coordinates.length === 0) {
    return [];
  }

  const outerRing = getContinuousRingCoordinates(coordinates[0], centerLongitude);
  // 内环需要跟随外环所在的 world 副本，否则填充可能横跨整个地图。
  const outerRingLongitude = getLineLongitudeCenter(outerRing, centerLongitude);
  return [
    outerRing,
    ...coordinates.slice(1).map((ring) => getContinuousRingCoordinates(ring, outerRingLongitude))
  ];
}

/**
 * 将 Point 移动到最接近地图中心的 world 副本。
 * @param centerLongitude 当前地图中心经度，即 center[1]。
 */
export function getContinuousPointGeometry(
  geometry: PointGeometry,
  centerLongitude: number
): PointGeometry {
  return {
    type: "Point",
    coordinates: [
      getNearestWorldLongitude(geometry.coordinates[0], centerLongitude),
      geometry.coordinates[1]
    ]
  };
}

/**
 * 将 LineString / MultiLineString 展开为连续世界坐标。
 * @param centerLongitude 当前地图中心经度，即 center[1]；每条 LineString 独立以它定位首点。
 */
export function getContinuousLineGeometry(
  geometry: LineGeometry,
  centerLongitude: number
): LineGeometry {
  if (geometry.type === "LineString") {
    return {
      type: "LineString",
      coordinates: getContinuousLineCoordinates(geometry.coordinates, centerLongitude)
    };
  }

  return {
    type: "MultiLineString",
    coordinates: geometry.coordinates.map(
      (coordinates) => getContinuousLineCoordinates(coordinates, centerLongitude)
    )
  };
}

/**
 * 将 Polygon / MultiPolygon 展开，并让内外环保持在同一 world 副本。
 * @param centerLongitude 当前地图中心经度，即 center[1]；每个 Polygon 独立以它定位外环。
 */
export function getContinuousAreaGeometry(
  geometry: AreaGeometry,
  centerLongitude: number
): AreaGeometry {
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: getContinuousPolygonCoordinates(geometry.coordinates, centerLongitude)
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: geometry.coordinates.map(
      (coordinates) => getContinuousPolygonCoordinates(coordinates, centerLongitude)
    )
  };
}

/**
 * 在单个 Overlay Feature 渲染前，将 geometry 转到地图中心附近的连续世界。
 * @param centerLongitude 当前地图中心经度，即 center[1]，不是固定的本初子午线。
 */
export function getContinuousOverlayGeometry(
  geometry: OverlayGeoJsonGeometryType,
  centerLongitude: number
): OverlayGeoJsonGeometryType {
  if (geometry.type === "Point") {
    return getContinuousPointGeometry(geometry, centerLongitude);
  }
  if (geometry.type === "LineString" || geometry.type === "MultiLineString") {
    return getContinuousLineGeometry(geometry, centerLongitude);
  }
  return getContinuousAreaGeometry(geometry, centerLongitude);
}
