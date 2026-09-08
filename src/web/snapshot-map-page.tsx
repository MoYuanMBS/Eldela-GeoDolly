import {useCallback, useEffect, useState, type ComponentType, type CSSProperties} from "react";
import {UI_BUILT_IN_CONFIG} from "../built-in-config/ui.js";
import type {CommonVisualMapPayloadType} from "../models/mapsurface/map-payload-models.js";
import type {RenderStylePayload} from "../models/mapsurface/style/user-css-style-models.js";
import {snapshotMapDataSchema, type SnapshotMapDataType} from "../models/web/snapshot-ui-models.js";
import {ReferenceBar} from "../ui/reference-bar.js";
import type {MapRuntimeStatusType, MetricScaleViewType} from "./map-surface-port.js";

type SnapshotMapLoadState =
  | {status: "loading"}
  | {status: "ready"; data: SnapshotMapDataType}
  | {status: "error"; message: string};

type SnapshotMapRuntimeState =
  | {status: "pending"}
  | {status: "ready"; runtimeStatus: MapRuntimeStatusType}
  | {status: "failed"; message: string};

type ReferenceUiState =
  | {status: "pending"}
  | {status: "ready"; measuredHeight: number}
  | {status: "failed"; message: string};

export interface SnapshotMapSurfacePortProps {
  mapPayload: CommonVisualMapPayloadType;
  stylePayload: RenderStylePayload;
  onMetricScaleReady(metricScale: MetricScaleViewType): void;
  onMapRuntimeReady(status: MapRuntimeStatusType): void;
  onMapRuntimeError(message: string): void;
}

interface SnapshotMapPageProps {
  mapDataUrl: string | null;
  SnapshotMapSurfaceComponent: ComponentType<SnapshotMapSurfacePortProps>;
}

interface SnapshotMapPageStyle extends CSSProperties {
  "--geomcp-ui-frame-width": string;
  "--geomcp-map-width": string;
  "--geomcp-standard-ui-min-width": string;
  "--geomcp-standard-ui-min-height": string;
  "--geomcp-standard-ui-divider-width": string;
  "--geomcp-scale-max-width": string;
}

/** Snapshot 页面只组合 MapSurface 与 Reference Bar，不读取 Interactive 数据或挂载交互 UI。 */
export function SnapshotMapPage({mapDataUrl, SnapshotMapSurfaceComponent}: SnapshotMapPageProps) {
  const [loadState, setLoadState] = useState<SnapshotMapLoadState>({status: "loading"});
  const [metricScale, setMetricScale] = useState<MetricScaleViewType | null>(null);
  const [mapRuntimeState, setMapRuntimeState] = useState<SnapshotMapRuntimeState>({status: "pending"});
  const [referenceUiState, setReferenceUiState] = useState<ReferenceUiState>({status: "pending"});

  useEffect(() => {
    setMetricScale(null);
    setMapRuntimeState({status: "pending"});
    setReferenceUiState({status: "pending"});
    if (mapDataUrl === null) {
      setLoadState({status: "error", message: "Snapshot map data URL is missing"});
      return;
    }

    const dataUrl = mapDataUrl;
    const abortController = new AbortController();
    async function loadMapData(): Promise<void> {
      try {
        const response = await fetch(dataUrl, {cache: "no-store", signal: abortController.signal});
        if (!response.ok) throw new Error(`Snapshot map data request failed with HTTP ${response.status}`);
        setLoadState({status: "ready", data: snapshotMapDataSchema.parse(await response.json())});
      } catch (error) {
        if (abortController.signal.aborted) return;
        setLoadState({status: "error", message: error instanceof Error ? error.message : String(error)});
      }
    }
    void loadMapData();
    return () => abortController.abort();
  }, [mapDataUrl]);

  const handleMetricScaleReady = useCallback((nextMetricScale: MetricScaleViewType): void => setMetricScale(nextMetricScale), []);
  const handleMapRuntimeReady = useCallback((runtimeStatus: MapRuntimeStatusType): void => setMapRuntimeState({status: "ready", runtimeStatus}), []);
  const handleMapRuntimeError = useCallback((message: string): void => setMapRuntimeState({status: "failed", message}), []);
  const handleReferenceUiReady = useCallback((measuredHeight: number): void => setReferenceUiState({status: "ready", measuredHeight}), []);
  const handleReferenceUiError = useCallback((message: string): void => setReferenceUiState({status: "failed", message}), []);

  if (loadState.status === "loading") return <main className="geomcp-map-page-state" role="status">Loading snapshot map data…</main>;
  if (loadState.status === "error") return <main className="geomcp-map-page-state geomcp-map-page-error" role="alert">{loadState.message}</main>;

  const {data} = loadState;
  const payload = data.map_payload;
  const pageStyle: SnapshotMapPageStyle = {
    "--geomcp-ui-frame-width": `${UI_BUILT_IN_CONFIG.frameBorderWidthPx}px`,
    "--geomcp-map-width": `${payload.screenshot_size[0]}px`,
    "--geomcp-standard-ui-min-width": `${UI_BUILT_IN_CONFIG.referenceUi.minWidth}px`,
    "--geomcp-standard-ui-min-height": `${UI_BUILT_IN_CONFIG.referenceUi.minHeight}px`,
    "--geomcp-standard-ui-divider-width": `${UI_BUILT_IN_CONFIG.standardUi.dividerWidth}px`,
    "--geomcp-scale-max-width": `${__GEOMCP_MAX_SCALE_WIDTH_PX__}px`,
  };
  const failureMessage = mapRuntimeState.status === "failed"
    ? mapRuntimeState.message
    : referenceUiState.status === "failed" ? referenceUiState.message : null;
  const browserReadyStatus = failureMessage !== null
    ? "failed"
    : mapRuntimeState.status === "ready" && referenceUiState.status === "ready" ? mapRuntimeState.runtimeStatus : "pending";
  const basemapAttribution = payload.basemap.full_attribution ?? payload.basemap.attribution;

  return (
    <main
      className="geomcp-map-page geomcp-snapshot-map-page"
      style={pageStyle}
      aria-busy={browserReadyStatus === "pending"}
      data-geomcp-ready-status={browserReadyStatus}
      data-geomcp-reference-ui-status={referenceUiState.status}
      data-geomcp-reference-ui-height={referenceUiState.status === "ready" ? referenceUiState.measuredHeight : undefined}
      data-geomcp-final-logical-height={referenceUiState.status === "ready" ? payload.screenshot_size[1] + referenceUiState.measuredHeight : undefined}
    >
      <div className="geomcp-map-capture-frame geomcp-snapshot-wrapper">
        <div className="geomcp-snapshot-map-clip">
          <SnapshotMapSurfaceComponent
            mapPayload={payload}
            stylePayload={data.style_payload}
            onMetricScaleReady={handleMetricScaleReady}
            onMapRuntimeReady={handleMapRuntimeReady}
            onMapRuntimeError={handleMapRuntimeError}
          />
        </div>
        <ReferenceBar
          logicalWidth={payload.screenshot_size[0]}
          attributionText={basemapAttribution}
          metricScale={metricScale}
          onReady={handleReferenceUiReady}
          onError={handleReferenceUiError}
        />
        {failureMessage === null ? null : <span className="geomcp-map-ready-error" role="alert">{failureMessage}</span>}
      </div>
    </main>
  );
}
