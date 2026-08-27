import {useCallback, useEffect, useMemo, useRef, useState, type CSSProperties} from "react";
import {interactiveMapDataSchema, type DrawingUiModeType, type InteractiveMapDataType} from "../models/web/interactive-ui-models.js";
import {AppError} from "../utils/app-error.js";
import {UI_BUILT_IN_CONFIG} from "../built-in-config/ui.js";
import {DrawingToolbar} from "../ui/drawing-toolbar.js";
import {FeatureBar} from "../ui/feature-bar.js";
import {MeasurementHUD} from "../ui/measurement-hud.js";
import {OsmTagsPopup} from "../ui/osm-tags-popup.js";
import {StandardBar} from "../ui/standard-bar.js";
import {resolveInteractiveFeatureDetails} from "./interactive-feature-details.js";
import type {
  InteractiveFeatureTargetType,
  MapRuntimeStatusType,
  MapSurfaceInteractionCommands,
  MapSurfacePortComponentType,
  MapSurfaceZoomCommands,
  MetricScaleViewType,
} from "./map-surface-port.js";

type MapLoadState =
  | {status: "loading"}
  | {status: "ready"; data: InteractiveMapDataType}
  | {status: "error"; message: string};

interface MapPageProps {
  mapDataUrl: string | null;
  /** 由 composition root 注入的地图实现；页面本身不导入 Leaflet adapter。 */
  MapSurfaceComponent: MapSurfacePortComponentType;
}

interface MapPageStyle extends CSSProperties {
  "--geomcp-map-width": string;
  "--geomcp-standard-ui-min-width": string;
  "--geomcp-standard-ui-min-height": string;
  "--geomcp-standard-ui-end-block-width": string;
  "--geomcp-standard-ui-live-feature-min-width": string;
  "--geomcp-standard-ui-divider-width": string;
  "--geomcp-feature-bar-gap": string;
  "--geomcp-feature-ui-max-height": string;
  "--geomcp-scale-max-width": string;
}

type MapRuntimeState =
  | {status: "pending"}
  | {status: "ready"; runtimeStatus: MapRuntimeStatusType}
  | {status: "failed"; message: string};

type StandardUiState =
  | {status: "pending"}
  | {status: "ready"; measuredHeight: number}
  | {status: "failed"; message: string};

export function MapPage({mapDataUrl, MapSurfaceComponent}: MapPageProps) {
  const [loadState, setLoadState] = useState<MapLoadState>({status: "loading"});
  const [metricScale, setMetricScale] = useState<MetricScaleViewType | null>(null);
  const [mapRuntimeState, setMapRuntimeState] = useState<MapRuntimeState>({status: "pending"});
  const [standardUiState, setStandardUiState] = useState<StandardUiState>({status: "pending"});
  const [hoveredFeature, setHoveredFeature] = useState<InteractiveFeatureTargetType | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<InteractiveFeatureTargetType | null>(null);
  const [drawingMode, setDrawingMode] = useState<DrawingUiModeType>("idle");
  const zoomCommandsRef = useRef<MapSurfaceZoomCommands | null>(null);
  const interactionCommandsRef = useRef<MapSurfaceInteractionCommands | null>(null);

  useEffect(() => {
    setMetricScale(null);
    setMapRuntimeState({status: "pending"});
    setStandardUiState({status: "pending"});
    setHoveredFeature(null);
    setSelectedFeature(null);
    setDrawingMode("idle");
    zoomCommandsRef.current = null;
    interactionCommandsRef.current = null;
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
        const data = interactiveMapDataSchema.parse(await response.json());
        // UI 只校验并保存传输数据；运行时样式与地图对象均由注入的 MapSurface adapter 创建。
        setLoadState({status: "ready", data});
      } catch (error) {
        if (abortController.signal.aborted) return;
        setLoadState({status: "error", message: error instanceof Error ? error.message : String(error)});
      }
    }
    void loadMapData();
    return () => abortController.abort();
  }, [mapDataUrl]);

  const handleMetricScaleChange = useCallback((nextMetricScale: MetricScaleViewType): void => {
    setMetricScale(nextMetricScale);
  }, []);
  const handleZoomCommandsChange = useCallback((commands: MapSurfaceZoomCommands | null): void => {
    zoomCommandsRef.current = commands;
  }, []);
  const handleInteractionCommandsChange = useCallback((commands: MapSurfaceInteractionCommands | null): void => {
    interactionCommandsRef.current = commands;
  }, []);
  const handleZoomIn = useCallback((): void => {
    zoomCommandsRef.current?.zoomIn();
  }, []);
  const handleZoomOut = useCallback((): void => {
    zoomCommandsRef.current?.zoomOut();
  }, []);
  const handleMapRuntimeReady = useCallback((runtimeStatus: MapRuntimeStatusType): void => {
    setMapRuntimeState({status: "ready", runtimeStatus});
  }, []);
  const handleMapRuntimeError = useCallback((message: string): void => {
    setMapRuntimeState({status: "failed", message});
  }, []);
  const handleStandardUiReady = useCallback((measuredHeight: number): void => {
    setStandardUiState({status: "ready", measuredHeight});
  }, []);
  const handleStandardUiError = useCallback((message: string): void => {
    setStandardUiState({status: "failed", message});
  }, []);
  const handleCloseTagsPopup = useCallback((): void => {
    if (interactionCommandsRef.current === null) setSelectedFeature(null);
    else interactionCommandsRef.current.clearSelection();
  }, []);

  const activeFeatureDetails = useMemo(() => {
    if (loadState.status !== "ready") return null;
    const payload = loadState.data.map_payload;
    return resolveInteractiveFeatureDetails(
      selectedFeature ?? hoveredFeature,
      loadState.data.ai_output,
      payload.overlay_output,
      loadState.data.display_id_by_feature_id,
      payload.relation_member_features_by_relation,
      loadState.data.relation_membership_by_feature_id,
    );
  }, [loadState, hoveredFeature, selectedFeature]);
  const selectedFeatureDetails = useMemo(() => {
    if (loadState.status !== "ready") return null;
    const payload = loadState.data.map_payload;
    return resolveInteractiveFeatureDetails(
      selectedFeature,
      loadState.data.ai_output,
      payload.overlay_output,
      loadState.data.display_id_by_feature_id,
      payload.relation_member_features_by_relation,
      loadState.data.relation_membership_by_feature_id,
    );
  }, [loadState, selectedFeature]);

  if (loadState.status === "loading") {
    return <main className="map-page-state" role="status">Loading map data…</main>;
  }
  if (loadState.status === "error") {
    return <main className="map-page-state map-page-error" role="alert">{loadState.message}</main>;
  }

  const {data} = loadState;
  const payload = data.map_payload;
  const pageStyle: MapPageStyle = {
    "--geomcp-map-width": `${payload.screenshot_size[0]}px`,
    "--geomcp-standard-ui-min-width": `${UI_BUILT_IN_CONFIG.standardUi.minWidth}px`,
    "--geomcp-standard-ui-min-height": `${UI_BUILT_IN_CONFIG.standardUi.minHeight}px`,
    "--geomcp-standard-ui-end-block-width": `${UI_BUILT_IN_CONFIG.standardUi.endBlockRatio * 100}%`,
    "--geomcp-standard-ui-live-feature-min-width": `${UI_BUILT_IN_CONFIG.standardUi.liveFeatureMinWidth}px`,
    "--geomcp-standard-ui-divider-width": `${UI_BUILT_IN_CONFIG.standardUi.dividerWidth}px`,
    "--geomcp-feature-bar-gap": `${UI_BUILT_IN_CONFIG.featureBar.gapPx}px`,
    "--geomcp-feature-ui-max-height": `${__GEOMCP_FEATURE_UI_MAX_HEIGHT_PX__}px`,
    "--geomcp-scale-max-width": `${__GEOMCP_MAX_SCALE_WIDTH_PX__}px`,
  };
  const failureMessage = mapRuntimeState.status === "failed"
    ? mapRuntimeState.message
    : standardUiState.status === "failed" ? standardUiState.message : null;
  const browserReadyStatus = failureMessage !== null
    ? "failed"
    : mapRuntimeState.status === "ready" && standardUiState.status === "ready" ? mapRuntimeState.runtimeStatus : "pending";
  return (
    <main
      className="map-page"
      style={pageStyle}
      aria-busy={browserReadyStatus === "pending"}
      data-geomcp-ready-status={browserReadyStatus}
      data-geomcp-standard-ui-status={standardUiState.status}
      data-geomcp-standard-ui-height={standardUiState.status === "ready" ? standardUiState.measuredHeight : undefined}
      data-geomcp-final-logical-height={standardUiState.status === "ready" ? payload.screenshot_size[1] + standardUiState.measuredHeight : undefined}
    >
      <div className="map-capture-frame">
        <div className="interactive-map-frame">
          <MapSurfaceComponent
            mapPayload={payload}
            stylePayload={data.style_payload}
            onMetricScaleChange={handleMetricScaleChange}
            onZoomCommandsChange={handleZoomCommandsChange}
            onInteractionCommandsChange={handleInteractionCommandsChange}
            onHoveredFeatureChange={setHoveredFeature}
            onSelectedFeatureChange={setSelectedFeature}
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
            {selectedFeatureDetails === null ? null : <OsmTagsPopup details={selectedFeatureDetails} onClose={handleCloseTagsPopup} />}
          </div>
        </div>
        <StandardBar
          logicalWidth={payload.screenshot_size[0]}
          attributionText={payload.basemap.attribution}
          attributionUrl={payload.basemap.attribution_url}
          attributionDescription={payload.basemap.full_attribution ?? payload.basemap.attribution}
          metricScale={metricScale}
          feature={activeFeatureDetails === null ? null : {
            featureType: activeFeatureDetails.featureType,
            displayId: activeFeatureDetails.displayId,
            name: activeFeatureDetails.name,
          }}
          onReady={handleStandardUiReady}
          onError={handleStandardUiError}
        />
        {failureMessage === null ? null : <span className="map-ready-error" role="alert">{failureMessage}</span>}
      </div>
      <FeatureBar selectedLocationName={data.selected_location_name} aiOutput={data.ai_output} />
    </main>
  );
}
