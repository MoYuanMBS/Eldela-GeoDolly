/**
 * 根据 Python 提供的标准 GIS bbox 生成截图与互动地图共用的初始 center。
 */

import type {BBoxType} from "../../models/common/map-data-models.js";
import {getContinuousEastLongitude, projectLatitude, projectLongitude, unprojectLatitude} from "../../shared/projection.js";

/**
 * @param bbox Python pipeline 确定的权威 bbox，顺序为 (west, south, east, north)
 * @returns [latitude, longitude]；跨日期变更线时 longitude 保留连续世界坐标，
 * 可能大于 180，以确保 Leaflet 初始化到与 bbox 相同的世界副本
 */
export function generateCaptureCenter(bbox: BBoxType): [number, number] {
  const [west, south, east, north] = bbox;
  const projectedWest = projectLongitude(west);
  const projectedEast = projectLongitude(getContinuousEastLongitude(west, east));
  const centerLongitude = ((projectedWest + projectedEast) / 2) * 360 - 180;
  const centerLatitude = unprojectLatitude((projectLatitude(north) + projectLatitude(south)) / 2);
  return [centerLatitude, centerLongitude];
}
