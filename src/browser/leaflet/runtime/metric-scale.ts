/** Leaflet 公制 Scale 的纯计算适配；不创建或挂载 UI control。 */

import type {Map as LeafletMap} from "leaflet";
import type {LeafletMetricScaleResult} from "../../../models/mapsurface/leaflet-renderer-models.js";
import {AppError} from "../../../shared/app-error.js";

/** 保持 Leaflet Control.Scale 使用的 1/2/3/5/10 稳定取整规则。 */
function getLeafletRoundNumber(value: number): number {
  const powerOfTen = 10 ** (String(Math.floor(value)).length - 1);
  const normalized = value / powerOfTen;
  const rounded = normalized >= 10 ? 10 : normalized >= 5 ? 5 : normalized >= 3 ? 3 : normalized >= 2 ? 2 : 1;
  return powerOfTen * rounded;
}

/**
 * 计算当前视口中心纬度处的初始公制 Scale，结果只交给 Browser UI。
 *
 * @param map 已完成初始 setView 的 Leaflet Map。
 * @param maxWidthPx app.yaml 中已校验的 ui.max_scale_width_px。
 */
export function calculateLeafletMetricScale(map: LeafletMap, maxWidthPx: number): LeafletMetricScaleResult {
  const centerY = map.getSize().y / 2;
  const maxMeters = map.distance(
    map.containerPointToLatLng([0, centerY]),
    map.containerPointToLatLng([maxWidthPx, centerY]),
  );
  if (!Number.isFinite(maxMeters) || maxMeters <= 0) {
    throw new AppError("metric_scale_failed", "Leaflet metric scale could not be calculated");
  }
  const distanceMeters = getLeafletRoundNumber(maxMeters);
  return Object.freeze({
    label: distanceMeters < 1000 ? `${distanceMeters} m` : `${distanceMeters / 1000} km`,
    distanceMeters,
    widthPx: Math.round(maxWidthPx * distanceMeters / maxMeters),
  });
}
