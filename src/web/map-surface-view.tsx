import {useEffect, useRef} from "react";
import type {LatLngBoundsLiteral, LatLngTuple} from "leaflet";
import {createInteractiveMapFlow, type InteractiveMapFlowResult} from "../leaflet/interactive-map-flow.js";
import type {LeafletConfigType} from "../models/config-models.js";
import type {IdentifiedOverlayGroupsWithDisplayIdType, RelationMemberFeaturesByRelationType} from "../models/map-data-models.js";
import type {RuntimeStylePlan} from "../models/style/runtime-style-models.js";

interface MapSurfaceViewProps {
  screenshotSize: readonly [width: number, height: number];
  center: LatLngTuple;
  leafletBounds: LatLngBoundsLiteral;
  overlayOutput: IdentifiedOverlayGroupsWithDisplayIdType | null;
  relationMemberFeaturesByRelation: RelationMemberFeaturesByRelationType | null;
  stylePlan: RuntimeStylePlan;
  leafletConfig: LeafletConfigType;
}

/**
 * React 只负责提供真实 DOM 容器和 Leaflet 生命周期；初始视口计算仍由 MapSurface 完成。
 */
export function MapSurfaceView({screenshotSize, center, leafletBounds, overlayOutput, relationMemberFeaturesByRelation, stylePlan, leafletConfig}: MapSurfaceViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const abortController = new AbortController();
    let flowResult: InteractiveMapFlowResult | null = null;
    const overlay = overlayOutput !== null && relationMemberFeaturesByRelation !== null
      ? {
          overlayOutput,
          relationMemberFeaturesByRelation,
          stylePlan,
          leafletConfig,
          centerLongitude: center[1],
          signal: abortController.signal,
        }
      : null;
    void createInteractiveMapFlow({
      mapSurface: {
        container,
        screenshotSize,
        center,
        leafletBounds,
        padding: __GEOMCP_MAP_PADDING__,
      },
      overlay,
      interactionConfig: leafletConfig.interaction,
    }).then((result) => {
      if (abortController.signal.aborted) {
        result.dispose();
        return;
      }
      flowResult = result;
    }).catch((error: unknown) => {
      if (!abortController.signal.aborted) console.error("interactive_map_flow_failed", error);
    });
    return () => {
      abortController.abort();
      flowResult?.dispose();
    };
  }, [screenshotSize, center, leafletBounds, overlayOutput, relationMemberFeaturesByRelation, stylePlan, leafletConfig]);

  return <div ref={containerRef} className="map-surface" aria-label="Interactive map" />;
}
