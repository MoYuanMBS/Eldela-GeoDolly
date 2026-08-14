/**
 * 将 Python Tool result 的标准 GIS bbox 转为 Leaflet LatLngBoundsLiteral。
 */

import type {LatLngBoundsLiteral} from "leaflet";
import type {BBoxType} from "../models/backend/map-data-models.js";
import {getContinuousEastLongitude} from "./projection.js";

/**
 * @param bbox 标准 GIS 顺序 (west, south, east, north)
 * @returns Leaflet 顺序 [[south, west], [north, east]]；日期变更线 bbox 使用连续 east
 */
export function toLeafletBounds(bbox: BBoxType): LatLngBoundsLiteral {
  const [west, south, east, north] = bbox;
  return [[south, west], [north, getContinuousEastLongitude(west, east)]];
}
