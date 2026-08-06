import {useEffect, useRef} from "react";
import type {LatLngBoundsLiteral, LatLngTuple} from "leaflet";
import {createMapSurface} from "../leaflet/map-surface.js";
import {renderOverlay} from "../leaflet/overlay-renderer.js";
import type {IdentifiedOverlayGroupsWithDisplayIdType, RelationMemberFeaturesByRelationType} from "../models/map-data-models.js";
import type {RuntimeStylePlan} from "../models/style/runtime-style-models.js";

interface MapSurfaceViewProps {
  screenshotSize: readonly [width: number, height: number];
  center: LatLngTuple;
  leafletBounds: LatLngBoundsLiteral;
  overlayOutput: IdentifiedOverlayGroupsWithDisplayIdType | null;
  relationMemberFeaturesByRelation: RelationMemberFeaturesByRelationType | null;
  stylePlan: RuntimeStylePlan;
}

/**
 * React 只负责提供真实 DOM 容器和 Leaflet 生命周期；初始视口计算仍由 MapSurface 完成。
 */
export function MapSurfaceView({screenshotSize, center, leafletBounds, overlayOutput, relationMemberFeaturesByRelation, stylePlan}: MapSurfaceViewProps) {
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
    const abortController = new AbortController();
    if (overlayOutput !== null && relationMemberFeaturesByRelation !== null) {
      void renderOverlay({
        map: leafletMap,
        overlayOutput,
        relationMemberFeaturesByRelation,
        stylePlan,
        centerLongitude: center[1],
        signal: abortController.signal,
      }).catch((error: unknown) => {
        if (!abortController.signal.aborted) console.error("overlay_render_failed", error);
      });
    }
    return () => {
      abortController.abort();
      leafletMap.remove();
    };
  }, [screenshotSize, center, leafletBounds, overlayOutput, relationMemberFeaturesByRelation, stylePlan]);

  return <div ref={containerRef} className="map-surface" aria-label="Interactive map" />;
}
