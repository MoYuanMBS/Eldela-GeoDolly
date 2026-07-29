/**
 * iframe capture 共用的 Leaflet EPSG:3857 基础投影。
 */

// Leaflet CRS.EPSG3857 使用的纬度上限；超过后会投影到同一极区边界。
const MAX_MERCATOR_LATITUDE = 85.0511287798066;

/** 将经度换算为归一化 world X。 */
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
