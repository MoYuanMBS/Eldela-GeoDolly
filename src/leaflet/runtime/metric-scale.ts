/** Leaflet 公制 Scale 的纯计算适配；不创建或挂载 UI control。 */

import type {Map as LeafletMap} from "leaflet";
import type {LeafletMetricScaleResult} from "../../models/mapsurface/leaflet-renderer-models.js";
import {AppError} from "../../utils/app-error.js";

const METRIC_SCALE_MAX_WIDTH_PX = 100;

/** 保持 Leaflet Control.Scale 使用的 1/2/3/5/10 稳定取整规则。 */
function getLeafletRoundNumber(value: number): number {
  const powerOfTen = 10 ** (String(Math.floor(value)).length - 1);
  const normalized = value / powerOfTen;
  const rounded = normalized >= 10 ? 10 : normalized >= 5 ? 5 : normalized >= 3 ? 3 : normalized >= 2 ? 2 : 1;
  return powerOfTen * rounded;
}

/** 计算当前视口中心纬度处的初始公制 Scale，结果只交给 Browser UI。 */
export function calculateLeafletMetricScale(map: LeafletMap): LeafletMetricScaleResult {
  const centerY = map.getSize().y / 2;
  const maxMeters = map.distance(
    map.containerPointToLatLng([0, centerY]),
    map.containerPointToLatLng([METRIC_SCALE_MAX_WIDTH_PX, centerY]),
  );
  if (!Number.isFinite(maxMeters) || maxMeters <= 0) {
    throw new AppError("metric_scale_failed", "Leaflet metric scale could not be calculated");
  }
  const distanceMeters = getLeafletRoundNumber(maxMeters);
  return Object.freeze({
    label: distanceMeters < 1000 ? `${distanceMeters} m` : `${distanceMeters / 1000} km`,
    distanceMeters,
    widthPx: Math.round(METRIC_SCALE_MAX_WIDTH_PX * distanceMeters / maxMeters),
  });
}
