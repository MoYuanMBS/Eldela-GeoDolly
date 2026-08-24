import {useCallback, useEffect, useMemo, useRef, useState, type CSSProperties} from "react";
import {z} from "zod";
import {initializeRuntimeStyle} from "../leaflet/styles/runtime-style-initializer.js";
import {commonVisualMapPayloadSchema, type CommonVisualMapPayloadType} from "../models/mapsurface/map-payload-models.js";
import type {BrowserFlowReadySummary, MapFlowReadySummary} from "../models/mapsurface/basemap-runtime-models.js";
import type {LeafletMetricScaleResult} from "../models/mapsurface/leaflet-renderer-models.js";
import type {RuntimeStylePlan} from "../models/mapsurface/style/runtime-style-models.js";
import {renderStylePayloadSchema} from "../models/mapsurface/style/user-css-style-models.js";
import type {DrawingUiModeType} from "../models/web/interactive-ui-models.js";
import {AppError} from "../utils/app-error.js";
import {UI_BUILT_IN_CONFIG} from "./built-in-config.js";
import {DrawingToolbar} from "./components/drawing-toolbar.js";
import {FeatureBar} from "./components/feature-bar.js";
import {MeasurementHUD} from "./components/measurement-hud.js";
import {ReferenceBar} from "./components/reference-bar.js";
import {MapSurfaceView, type MapSurfaceZoomCommands} from "./map-surface-view.js";

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
  "--geomcp-reference-ui-min-width": string;
  "--geomcp-reference-ui-min-height": string;
  "--geomcp-reference-ui-end-block-width": string;
  "--geomcp-reference-ui-live-feature-min-width": string;
  "--geomcp-reference-ui-divider-width": string;
  "--geomcp-feature-bar-gap": string;
  "--geomcp-scale-max-width": string;
}

type MapRuntimeState =
  | {status: "pending"}
  | {status: "ready"; summary: MapFlowReadySummary}
  | {status: "failed"; message: string};

type ReferenceUiState =
  | {status: "pending"}
  | {status: "ready"; measuredHeight: number}
  | {status: "failed"; message: string};

export function MapPage({mapDataUrl}: MapPageProps) {
  const [loadState, setLoadState] = useState<MapLoadState>({status: "loading"});
  const [metricScale, setMetricScale] = useState<LeafletMetricScaleResult | null>(null);
  const [mapRuntimeState, setMapRuntimeState] = useState<MapRuntimeState>({status: "pending"});
  const [referenceUiState, setReferenceUiState] = useState<ReferenceUiState>({status: "pending"});
  const [drawingMode, setDrawingMode] = useState<DrawingUiModeType>("idle");
  const zoomCommandsRef = useRef<MapSurfaceZoomCommands | null>(null);

  useEffect(() => {
    setMetricScale(null);
    setMapRuntimeState({status: "pending"});
    setReferenceUiState({status: "pending"});
    setDrawingMode("idle");
    zoomCommandsRef.current = null;
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

  const handleMetricScaleChange = useCallback((nextMetricScale: LeafletMetricScaleResult): void => {
    setMetricScale(nextMetricScale);
  }, []);
  const handleZoomCommandsChange = useCallback((commands: MapSurfaceZoomCommands | null): void => {
    zoomCommandsRef.current = commands;
  }, []);
  const handleZoomIn = useCallback((): void => {
    zoomCommandsRef.current?.zoomIn();
  }, []);
  const handleZoomOut = useCallback((): void => {
    zoomCommandsRef.current?.zoomOut();
  }, []);
  const handleMapRuntimeReady = useCallback((summary: MapFlowReadySummary): void => {
    setMapRuntimeState({status: "ready", summary});
  }, []);
  const handleMapRuntimeError = useCallback((message: string): void => {
    setMapRuntimeState({status: "failed", message});
  }, []);
  const handleReferenceUiReady = useCallback((measuredHeight: number): void => {
    setReferenceUiState({status: "ready", measuredHeight});
  }, []);
  const handleReferenceUiError = useCallback((message: string): void => {
    setReferenceUiState({status: "failed", message});
  }, []);

  const browserReadySummary = useMemo<BrowserFlowReadySummary | null>(() => {
    if (mapRuntimeState.status !== "ready" || referenceUiState.status !== "ready") return null;
    return Object.freeze({
      ...mapRuntimeState.summary,
      reference_ui: "ready",
      measured_reference_ui_height: referenceUiState.measuredHeight,
    });
  }, [mapRuntimeState, referenceUiState]);

  if (loadState.status === "loading") {
    return <main className="map-page-state" role="status">Loading map data…</main>;
  }
  if (loadState.status === "error") {
    return <main className="map-page-state map-page-error" role="alert">{loadState.message}</main>;
  }

  const {payload, stylePlan} = loadState;
  const pageStyle: MapPageStyle = {
    "--geomcp-map-width": `${payload.screenshot_size[0]}px`,
    "--geomcp-reference-ui-min-width": `${UI_BUILT_IN_CONFIG.referenceUi.minWidth}px`,
    "--geomcp-reference-ui-min-height": `${UI_BUILT_IN_CONFIG.referenceUi.minHeight}px`,
    "--geomcp-reference-ui-end-block-width": `${UI_BUILT_IN_CONFIG.referenceUi.endBlockRatio * 100}%`,
    "--geomcp-reference-ui-live-feature-min-width": `${UI_BUILT_IN_CONFIG.referenceUi.liveFeatureMinWidth}px`,
    "--geomcp-reference-ui-divider-width": `${UI_BUILT_IN_CONFIG.referenceUi.dividerWidth}px`,
    "--geomcp-feature-bar-gap": `${UI_BUILT_IN_CONFIG.featureBar.gapPx}px`,
    "--geomcp-scale-max-width": `${__GEOMCP_MAX_SCALE_WIDTH_PX__}px`,
  };
  const failureMessage = mapRuntimeState.status === "failed"
    ? mapRuntimeState.message
    : referenceUiState.status === "failed" ? referenceUiState.message : null;
  const browserReadyStatus = failureMessage === null ? browserReadySummary?.status ?? "pending" : "failed";
  return (
    <main
      className="map-page"
      style={pageStyle}
      aria-busy={browserReadyStatus === "pending"}
      data-geomcp-ready-status={browserReadyStatus}
      data-geomcp-reference-ui-status={referenceUiState.status}
      data-geomcp-reference-ui-height={referenceUiState.status === "ready" ? referenceUiState.measuredHeight : undefined}
      data-geomcp-final-logical-height={referenceUiState.status === "ready" ? payload.screenshot_size[1] + referenceUiState.measuredHeight : undefined}
    >
      <div className="map-capture-frame">
        <div className="interactive-map-frame">
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
            onMetricScaleChange={handleMetricScaleChange}
            onZoomCommandsChange={handleZoomCommandsChange}
            onMapRuntimeReady={handleMapRuntimeReady}
            onMapRuntimeError={handleMapRuntimeError}
          />
          <div className="interactive-ui-root">
            <DrawingToolbar
              mode={drawingMode}
              disabled={mapRuntimeState.status !== "ready"}
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onModeChange={setDrawingMode}
            />
            <MeasurementHUD mode={drawingMode} rows={[]} />
          </div>
        </div>
        <ReferenceBar
          logicalWidth={payload.screenshot_size[0]}
          attributionText={payload.basemap.attribution}
          attributionUrl={payload.basemap.attribution_url}
          attributionDescription={payload.basemap.full_attribution ?? payload.basemap.attribution}
          metricScale={metricScale}
          feature={null}
          onReady={handleReferenceUiReady}
          onError={handleReferenceUiError}
        />
        {failureMessage === null ? null : <span className="map-ready-error" role="alert">{failureMessage}</span>}
      </div>
      <FeatureBar feature={null} />
    </main>
  );
}
