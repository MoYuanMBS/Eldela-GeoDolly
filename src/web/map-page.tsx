import {useEffect, useState, type CSSProperties} from "react";
import {z} from "zod";
import {initializeRuntimeStyle} from "../leaflet/styles/runtime-style-initializer.js";
import {commonVisualMapPayloadSchema, type CommonVisualMapPayloadType} from "../models/mapsurface/map-payload-models.js";
import type {RuntimeStylePlan} from "../models/mapsurface/style/runtime-style-models.js";
import {renderStylePayloadSchema} from "../models/mapsurface/style/user-css-style-models.js";
import {AppError} from "../utils/app-error.js";
import {UI_BUILT_IN_CONFIG} from "./built-in-config.js";
import {MapSurfaceView} from "./map-surface-view.js";

const publishedMapPayloadSchema = z.object({
  map_payload: commonVisualMapPayloadSchema,
  style_payload: renderStylePayloadSchema,
}).strict();

type MapLoadState =
  | {status: "loading"}
  | {status: "ready"; payload: CommonVisualMapPayloadType; stylePlan: RuntimeStylePlan | null}
  | {status: "error"; message: string};

interface MapPageProps {
  mapDataUrl: string | null;
}

interface MapPageStyle extends CSSProperties {
  "--geomcp-map-width": string;
  "--geomcp-toolbar-min-width": string;
  "--geomcp-toolbar-min-height": string;
}

export function MapPage({mapDataUrl}: MapPageProps) {
  const [loadState, setLoadState] = useState<MapLoadState>({status: "loading"});

  useEffect(() => {
    if (mapDataUrl === null) {
      setLoadState({status: "error", message: "Map data URL is missing"});
      return;
    }

    const dataUrl = mapDataUrl;
    const abortController = new AbortController();
    async function loadMapData() {
      try {
        const response = await fetch(dataUrl, {cache: "no-store", signal: abortController.signal});
        if (!response.ok) {
          throw new AppError("map_data_request", `Map data request failed with HTTP ${response.status}`);
        }
        const publishedPayload = publishedMapPayloadSchema.parse(await response.json());
        const payload = publishedPayload.map_payload;
        // Basemap-only 不初始化 RuntimeStylePlan；其他模式必须在创建 Leaflet 前完成样式准备。
        const stylePlan = payload.render_mode === "basemap_only"
          ? null
          : initializeRuntimeStyle(publishedPayload.style_payload, payload.leaflet);
        setLoadState({status: "ready", payload, stylePlan});
      } catch (error) {
        if (abortController.signal.aborted) return;
        setLoadState({status: "error", message: error instanceof Error ? error.message : String(error)});
      }
    }
    void loadMapData();
    return () => abortController.abort();
  }, [mapDataUrl]);

  if (loadState.status === "loading") {
    return <main className="map-page-state" role="status">Loading map data…</main>;
  }
  if (loadState.status === "error") {
    return <main className="map-page-state map-page-error" role="alert">{loadState.message}</main>;
  }

  const {payload, stylePlan} = loadState;
  const pageStyle: MapPageStyle = {
    "--geomcp-map-width": `${payload.screenshot_size[0]}px`,
    "--geomcp-toolbar-min-width": `${UI_BUILT_IN_CONFIG.toolbar.minWidth}px`,
    "--geomcp-toolbar-min-height": `${UI_BUILT_IN_CONFIG.toolbar.minHeight}px`,
  };
  return (
    <main className="map-page" style={pageStyle}>
      <MapSurfaceView
        screenshotSize={payload.screenshot_size}
        center={payload.center}
        leafletBounds={payload.leaflet_bbox}
        basemap={payload.basemap}
        overlayOutput={payload.overlay_output}
        relationMemberFeaturesByRelation={payload.relation_member_features_by_relation}
        coreVisual={payload.core_visual}
        stylePlan={stylePlan}
        leafletConfig={payload.leaflet}
      />
      <footer className="map-toolbar" aria-label="Map toolbar">
        <span>GeoMCP</span>
        <span>Map preview</span>
      </footer>
    </main>
  );
}
