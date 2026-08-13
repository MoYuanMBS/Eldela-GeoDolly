/**
 * GeoJSON `(lon, lat)` geometry 到 Leaflet `(lat, lon)` 连续世界坐标的唯一适配层。
 *
 * Overlay renderer、标签和透明命中层共用这里的返回值；它们不能各自重新处理日期变更线，
 * 否则同一 Feature 的视觉、文字和 hit geometry 可能被投影到不同 world copy。
 */

import type {LatLngTuple} from "leaflet";
import {getContinuousAreaGeometry, getContinuousLineGeometry, getContinuousPointGeometry} from "../../iframe-capture/projection.js";
import type {CoreGeoJsonPrimitiveGeometryType} from "../../models/core-render.js";
import type {IdentifiedOverlaySpatialFeatureType} from "../../models/map-data-models.js";
import type {LeafletGeoJsonGeometry, LeafletSpatialGeometry} from "../../models/leaflet-renderer-models.js";

function toLatLng(position: readonly [number, number]): LatLngTuple {
  // GeoJSON 与 Leaflet 的坐标顺序相反，只在进入 Leaflet 的边界处交换一次。
  return [position[1], position[0]];
}

/**
 * centerLongitude 是当前连续世界的参考经度，不是固定的本初子午线。
 * 每个 Feature 在进入 Leaflet 前只转换一次；原 Overlay geometry 保持不变。
 * Way 的各段和 Area 的各 Polygon 继续保留原嵌套结构，避免合并独立 geometry。
 */
export function prepareLeafletGeoJsonGeometry(geometry: CoreGeoJsonPrimitiveGeometryType, centerLongitude: number): LeafletGeoJsonGeometry {
  switch (geometry.type) {
    case "Point": {
      const continuousGeometry = getContinuousPointGeometry(geometry, centerLongitude);
      return Object.freeze({featureType: "node", center: toLatLng(continuousGeometry.coordinates)});
    }
    case "MultiPoint": {
      const centers = geometry.coordinates.map((coordinates) => {
        const continuousGeometry = getContinuousPointGeometry({type: "Point", coordinates}, centerLongitude);
        return toLatLng(continuousGeometry.coordinates);
      });
      return Object.freeze({featureType: "multiPoint", centers});
    }
    case "LineString":
    case "MultiLineString": {
      const continuousGeometry = getContinuousLineGeometry(geometry, centerLongitude);
      const latLngs = continuousGeometry.type === "LineString"
        ? continuousGeometry.coordinates.map(toLatLng)
        : continuousGeometry.coordinates.map((line) => line.map(toLatLng));
      return Object.freeze({featureType: "way", latLngs});
    }
    case "Polygon":
    case "MultiPolygon": {
      const continuousGeometry = getContinuousAreaGeometry(geometry, centerLongitude);
      const latLngs = continuousGeometry.type === "Polygon"
        ? continuousGeometry.coordinates.map((ring) => ring.map(toLatLng))
        : continuousGeometry.coordinates.map((polygon) => polygon.map((ring) => ring.map(toLatLng)));
      return Object.freeze({featureType: "area", latLngs});
    }
  }
}

export function prepareLeafletGeometry(feature: IdentifiedOverlaySpatialFeatureType, centerLongitude: number): LeafletSpatialGeometry {
  if (feature.feature_type === "node") {
    const geometry = prepareLeafletGeoJsonGeometry(feature.geometry, centerLongitude);
    if (geometry.featureType !== "node") throw new Error("Node Overlay produced non-point Leaflet geometry");
    return geometry;
  }
  if (feature.feature_type === "way") {
    const geometry = prepareLeafletGeoJsonGeometry(feature.geometry, centerLongitude);
    if (geometry.featureType !== "way") throw new Error("Way Overlay produced non-line Leaflet geometry");
    return geometry;
  }
  const geometry = prepareLeafletGeoJsonGeometry(feature.geometry, centerLongitude);
  if (geometry.featureType !== "area") throw new Error("Area Overlay produced non-polygon Leaflet geometry");
  return geometry;
}
