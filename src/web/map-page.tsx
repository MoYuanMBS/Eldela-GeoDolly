import {useEffect, useState, type CSSProperties} from "react";
import {z} from "zod";
import {initializeRuntimeStyle} from "../leaflet/styles/runtime-style-initializer.js";
import {leafletConfigSchema} from "../models/config-models.js";
import {identifiedOverlayGroupsWithDisplayIdSchema, relationMemberFeaturesByRelationSchema} from "../models/map-data-models.js";
import type {RuntimeStylePlan} from "../models/style/runtime-style-models.js";
import {renderStylePayloadSchema} from "../models/style/user-css-style-models.js";
import {UI_BUILT_IN_CONFIG} from "./built-in-config.js";
import {MapSurfaceView} from "./map-surface-view.js";

const finiteNumberSchema = z.number().finite();
const positiveIntegerSchema = z.number().int().positive();
const mapPayloadSchema = z.object({
  screenshot_size: z.tuple([positiveIntegerSchema, positiveIntegerSchema]),
  center: z.tuple([finiteNumberSchema, finiteNumberSchema]),
  leaflet_bbox: z.tuple([
    z.tuple([finiteNumberSchema, finiteNumberSchema]),
    z.tuple([finiteNumberSchema, finiteNumberSchema]),
  ]),
  overlay_output: identifiedOverlayGroupsWithDisplayIdSchema.nullable(),
  relation_member_features_by_relation: relationMemberFeaturesByRelationSchema.nullable(),
  leaflet: leafletConfigSchema,
  render_style: renderStylePayloadSchema,
}).superRefine((payload, context) => {
  if ((payload.overlay_output === null) !== (payload.relation_member_features_by_relation === null)) {
    context.addIssue({code: "custom", message: "overlay_output and relation_member_features_by_relation must both be null or both contain data"});
  }
});

type MapPayload = z.infer<typeof mapPayloadSchema>;

type MapLoadState =
  | {status: "loading"}
  | {status: "ready"; payload: MapPayload; stylePlan: RuntimeStylePlan}
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
          throw new Error(`Map data request failed with HTTP ${response.status}`);
        }
        const payload = mapPayloadSchema.parse(await response.json());
        // 样式注入、regex 编译和索引构建必须先完成，ready render 才会创建 Leaflet。
        const stylePlan = initializeRuntimeStyle(payload.render_style, payload.leaflet);
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
        overlayOutput={payload.overlay_output}
        relationMemberFeaturesByRelation={payload.relation_member_features_by_relation}
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
