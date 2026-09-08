import {useEffect, useRef} from "react";
import "leaflet/dist/leaflet.css";
import "../leaflet/styles/leaflet-font.css";
import "../leaflet/styles/built-in/built-in-css.css";
import {initializeBuiltInStyle} from "../leaflet/styles/built-in-style-loader.js";
import {initializeRuntimeStyle} from "../leaflet/styles/runtime-style-initializer.js";
import type {SnapshotMapFlowResult} from "../models/mapsurface/basemap-runtime-models.js";
import type {RuntimeStylePlan} from "../models/mapsurface/style/runtime-style-models.js";
import type {SnapshotMapSurfacePortProps} from "../web/snapshot-map-page.js";
import {createSnapshotMapFlow} from "./snapshot-map-flow.js";

initializeBuiltInStyle();

/** Snapshot adapter 只接入共享视觉 flow，不导入 Interaction 或 Measure Tool。 */
export function SnapshotMapSurfaceView({mapPayload, stylePayload, onMetricScaleReady, onMapRuntimeReady, onMapRuntimeError}: SnapshotMapSurfacePortProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const {screenshot_size: screenshotSize, center, leaflet_bbox: leafletBounds, basemap, overlay_output: overlayOutput, relation_member_features_by_relation: relationMemberFeaturesByRelation, core_visual: coreVisual, leaflet: leafletConfig} = mapPayload;
    let stylePlan: RuntimeStylePlan | null = null;
    try {
      stylePlan = mapPayload.render_mode === "basemap_only" ? null : initializeRuntimeStyle(stylePayload, leafletConfig);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onMapRuntimeError(message);
      console.error("snapshot_map_style_initialization_failed", error);
      return;
    }

    const abortController = new AbortController();
    let flowResult: SnapshotMapFlowResult | null = null;
    const overlay = overlayOutput !== null && relationMemberFeaturesByRelation !== null && stylePlan !== null
      ? {
          overlayOutput,
          relationMemberFeaturesByRelation,
          stylePlan,
          visualConfig: {
            render_batch_size: leafletConfig.render_batch_size,
            node_zoom: leafletConfig.node_zoom,
            relation_membership: leafletConfig.relation_membership,
            visual_limits: leafletConfig.visual_limits,
          },
          centerLongitude: center[1],
          signal: abortController.signal,
        }
      : null;
    const coreOverlay = coreVisual === null
      ? null
      : {
          coreVisual,
          nodeZoomConfig: leafletConfig.node_zoom,
          centerLongitude: center[1],
          signal: abortController.signal,
        };

    void createSnapshotMapFlow({
      mapSurface: {
        container,
        screenshotSize,
        center,
        requestedLeafletBounds: leafletBounds,
        maxZoom: leafletConfig.viewport.max_zoom,
        padding: __GEOMCP_MAP_PADDING__,
      },
      basemap,
      readyTimeoutMs: __GEOMCP_MAP_READY_TIMEOUT_MS__,
      proxyTileTimeoutMs: __GEOMCP_PROXY_TILE_TIMEOUT_MS__,
      metricScaleMaxWidthPx: __GEOMCP_MAX_SCALE_WIDTH_PX__,
      overlay,
      coreOverlay,
    }).then((result) => {
      if (abortController.signal.aborted) {
        result.dispose();
        return;
      }
      flowResult = result;
      onMetricScaleReady(Object.freeze({label: result.metricScale.label, widthPx: result.metricScale.widthPx}));
      onMapRuntimeReady(result.readySummary.status);
    }).catch((error: unknown) => {
      if (abortController.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      onMapRuntimeError(message);
      console.error("snapshot_map_flow_failed", error);
    });

    return () => {
      abortController.abort();
      flowResult?.dispose();
    };
  }, [mapPayload, stylePayload, onMetricScaleReady, onMapRuntimeReady, onMapRuntimeError]);

  return <div ref={containerRef} className="geomcp-map-surface" aria-label="Snapshot map" />;
}
