import {useCallback, useEffect, useState, type CSSProperties} from "react";
import {UI_BUILT_IN_CONFIG} from "../built-in-config/ui.js";
import type {BrowserWarningReportType} from "../models/common/browser-warning-models.js";
import {
  snapshotMapDataSchema,
  type SnapshotBrowserReadySummaryType,
  type SnapshotMapDataType,
  type SnapshotRecoverableWarningType,
} from "../models/web/snapshot-ui-models.js";
import {ReferenceBar} from "../ui/reference-bar.js";
import type {
  SnapshotMapRuntimeReadyType,
  SnapshotMapSurfacePortComponentType,
  SnapshotMetricScaleViewType,
} from "./map-surface-port.js";

type SnapshotMapLoadState =
  | {status: "loading"}
  | {status: "ready"; data: SnapshotMapDataType}
  | {status: "error"; message: string};

type SnapshotMapRuntimeState =
  | {status: "pending"}
  | {status: "ready"; result: SnapshotMapRuntimeReadyType}
  | {status: "failed"; message: string};

type MetricScaleState =
  | {status: "pending"; value: null}
  | {status: "ready"; value: SnapshotMetricScaleViewType}
  | {status: "omitted"; value: null};

type ReferenceUiState =
  | {status: "pending"}
  | {status: "ready"; measuredHeight: number}
  | {status: "failed"; message: string};

interface SnapshotMapPageProps {
  mapDataUrl: string | null;
  SnapshotMapSurfaceComponent: SnapshotMapSurfacePortComponentType;
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
  const [metricScaleState, setMetricScaleState] = useState<MetricScaleState>({status: "pending", value: null});
  const [mapRuntimeState, setMapRuntimeState] = useState<SnapshotMapRuntimeState>({status: "pending"});
  const [referenceUiState, setReferenceUiState] = useState<ReferenceUiState>({status: "pending"});
  const [warnings, setWarnings] = useState<SnapshotRecoverableWarningType[]>([]);
  const [diagnostics, setDiagnostics] = useState<BrowserWarningReportType[]>([]);

  useEffect(() => {
    setMetricScaleState({status: "pending", value: null});
    setMapRuntimeState({status: "pending"});
    setReferenceUiState({status: "pending"});
    setWarnings([]);
    setDiagnostics([]);
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

  const recordWarning = useCallback((warning: SnapshotRecoverableWarningType): void => {
    setWarnings((current) => current.includes(warning) ? current : [...current, warning]);
  }, []);
  const recordDiagnostic = useCallback((diagnostic: BrowserWarningReportType): void => {
    const diagnosticKey = JSON.stringify(diagnostic);
    setDiagnostics((current) => current.some((existing) => JSON.stringify(existing) === diagnosticKey) ? current : [...current, diagnostic]);
  }, []);
  const handleMetricScaleSettled = useCallback((nextMetricScale: SnapshotMetricScaleViewType | null): void => {
    if (nextMetricScale === null) {
      recordWarning("scale_omitted");
      setMetricScaleState({status: "omitted", value: null});
    } else {
      setMetricScaleState({status: "ready", value: nextMetricScale});
    }
  }, [recordWarning]);
  const handleMapRuntimeReady = useCallback((result: SnapshotMapRuntimeReadyType): void => {
    if (result.initialTiles.success_count < result.initialTiles.total_count && result.summary.status === "ready") {
      recordWarning("basemap_tiles_missing");
    }
    setMapRuntimeState({status: "ready", result});
  }, [recordWarning]);
  const handleMapRuntimeError = useCallback((message: string): void => setMapRuntimeState({status: "failed", message}), []);
  const handleReferenceUiReady = useCallback((measuredHeight: number): void => setReferenceUiState({status: "ready", measuredHeight}), []);
  const handleReferenceUiError = useCallback((message: string): void => setReferenceUiState({status: "failed", message}), []);

  if (loadState.status === "loading") return <main className="geomcp-map-page-state" role="status" data-geomcp-ready-status="pending" data-geomcp-snapshot-diagnostics="[]">Loading snapshot map data…</main>;
  if (loadState.status === "error") return <main className="geomcp-map-page-state geomcp-map-page-error" role="alert" data-geomcp-ready-status="failed" data-geomcp-ready-error={loadState.message} data-geomcp-snapshot-diagnostics="[]">{loadState.message}</main>;

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
  const mapRuntimeResult = mapRuntimeState.status === "ready" ? mapRuntimeState.result : null;
  const mapSummary = mapRuntimeResult?.summary ?? null;
  const failureMessage = mapRuntimeState.status === "failed"
    ? mapRuntimeState.message
    : mapSummary?.status === "failed" ? mapSummary.error?.message ?? "Snapshot map runtime failed"
    : referenceUiState.status === "failed" ? referenceUiState.message : null;
  const browserReadyStatus = failureMessage !== null
    ? "failed"
    : mapSummary?.status === "ready" && referenceUiState.status === "ready" && metricScaleState.status !== "pending" ? "ready" : "pending";
  let readySummary: SnapshotBrowserReadySummaryType | null = null;
  if (
    browserReadyStatus === "ready"
    && referenceUiState.status === "ready"
    && metricScaleState.status !== "pending"
    && mapSummary !== null
    && mapSummary.status === "ready"
    && mapSummary.basemap.status === "ready"
    && mapRuntimeResult !== null
  ) {
    readySummary = {
      status: mapSummary.status,
      error: null,
      initial_view: mapSummary.initial_view,
      basemap: mapSummary.basemap,
      overlay: {status: mapSummary.overlay, rendered: mapRuntimeResult.renderedFeatureCounts.overlay},
      core_overlay: {status: mapSummary.core_overlay, rendered: mapRuntimeResult.renderedFeatureCounts.core},
      reference_ui: {status: "ready", measured_height: referenceUiState.measuredHeight},
      scale: metricScaleState.status === "omitted"
        ? {status: "omitted"}
        : {
            status: "ready",
            label: metricScaleState.value.label,
            distance_meters: metricScaleState.value.distanceMeters,
            width_px: metricScaleState.value.widthPx,
          },
      final_logical_height: payload.screenshot_size[1] + referenceUiState.measuredHeight,
      initial_tiles: mapRuntimeResult.initialTiles,
      warnings,
    };
  }
  const basemapAttribution = payload.basemap.full_attribution ?? payload.basemap.attribution;

  return (
    <main
      className="geomcp-map-page geomcp-snapshot-map-page"
      style={pageStyle}
      aria-busy={browserReadyStatus === "pending"}
      data-geomcp-ready-status={browserReadyStatus}
      data-geomcp-ready-error={failureMessage ?? undefined}
      data-geomcp-ready-summary={readySummary === null ? undefined : JSON.stringify(readySummary)}
      data-geomcp-snapshot-diagnostics={JSON.stringify(diagnostics)}
      data-geomcp-reference-ui-status={referenceUiState.status}
      data-geomcp-reference-ui-height={referenceUiState.status === "ready" ? referenceUiState.measuredHeight : undefined}
      data-geomcp-final-logical-height={referenceUiState.status === "ready" ? payload.screenshot_size[1] + referenceUiState.measuredHeight : undefined}
    >
      <div className="geomcp-map-capture-frame geomcp-snapshot-wrapper">
        <div className="geomcp-snapshot-map-clip">
          <SnapshotMapSurfaceComponent
            mapPayload={payload}
            stylePayload={data.style_payload}
            onMetricScaleSettled={handleMetricScaleSettled}
            onMapRuntimeReady={handleMapRuntimeReady}
            onRecoverableWarning={recordWarning}
            onSnapshotDiagnostic={recordDiagnostic}
            onMapRuntimeError={handleMapRuntimeError}
          />
        </div>
        <ReferenceBar
          logicalWidth={payload.screenshot_size[0]}
          attributionText={basemapAttribution}
          metricScale={metricScaleState.value}
          scaleSettled={metricScaleState.status !== "pending"}
          onRecoverableWarning={recordWarning}
          onReady={handleReferenceUiReady}
          onError={handleReferenceUiError}
        />
        {failureMessage === null ? null : <span className="geomcp-map-ready-error" role="alert">{failureMessage}</span>}
      </div>
    </main>
  );
}
