/** GeoJSON `(lon, lat)` geometry 到 Leaflet `(lat, lon)` 连续世界坐标的适配。 */

import type {LatLngTuple} from "leaflet";
import {getContinuousAreaGeometry, getContinuousLineGeometry, getContinuousPointGeometry} from "../iframe-capture/projection.js";
import type {IdentifiedOverlaySpatialFeatureType} from "../models/map-data-models.js";
import type {LeafletSpatialGeometry} from "../models/leaflet-renderer-models.js";

function toLatLng(position: readonly [number, number]): LatLngTuple {
  return [position[1], position[0]];
}

/**
 * 每个 Feature 在进入 Leaflet 前只转换一次；原 Overlay geometry 保持不变。
 * Way 的各段和 Area 的各 Polygon 继续保留原嵌套结构，避免合并独立 geometry。
 */
export function prepareLeafletGeometry(feature: IdentifiedOverlaySpatialFeatureType, centerLongitude: number): LeafletSpatialGeometry {
  if (feature.feature_type === "node") {
    const geometry = getContinuousPointGeometry(feature.geometry, centerLongitude);
    return Object.freeze({featureType: "node", center: toLatLng(geometry.coordinates)});
  }
  if (feature.feature_type === "way") {
    const geometry = getContinuousLineGeometry(feature.geometry, centerLongitude);
    const latLngs = geometry.type === "LineString"
      ? geometry.coordinates.map(toLatLng)
      : geometry.coordinates.map((line) => line.map(toLatLng));
    return Object.freeze({featureType: "way", latLngs});
  }
  const geometry = getContinuousAreaGeometry(feature.geometry, centerLongitude);
  const latLngs = geometry.type === "Polygon"
    ? geometry.coordinates.map((ring) => ring.map(toLatLng))
    : geometry.coordinates.map((polygon) => polygon.map((ring) => ring.map(toLatLng)));
  return Object.freeze({featureType: "area", latLngs});
}
