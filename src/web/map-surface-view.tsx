import {useEffect, useRef} from "react";
import type {LatLngBoundsLiteral, LatLngTuple} from "leaflet";
import {createMapSurface} from "../leaflet/map-surface.js";

interface MapSurfaceViewProps {
  screenshotSize: readonly [width: number, height: number];
  center: LatLngTuple;
  leafletBounds: LatLngBoundsLiteral;
}

/**
 * React 只负责提供真实 DOM 容器和 Leaflet 生命周期；初始视口计算仍由 MapSurface 完成。
 */
export function MapSurfaceView({screenshotSize, center, leafletBounds}: MapSurfaceViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const leafletMap = createMapSurface({
      container,
      screenshotSize,
      center,
      leafletBounds,
      padding: __GEOMCP_MAP_PADDING__,
    });
    return () => {
      leafletMap.remove();
    };
  }, [screenshotSize, center, leafletBounds]);

  return <div ref={containerRef} className="map-surface" aria-label="Interactive map" />;
}
