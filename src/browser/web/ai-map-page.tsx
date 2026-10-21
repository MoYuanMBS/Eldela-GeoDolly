/// <reference path="./vite-env.d.ts" />

import {useCallback, useEffect, useRef, useState, type CSSProperties} from "react";
import {flushSync} from "react-dom";
import {SnapshotMapSurfaceView} from "../browser-map-flow/snapshot-map-surface-view.js";
import {ReferenceBar} from "../ui/reference-bar.js";
import {mcpInteractiveMapDataSchema} from "../../models/web/interactive-ui-models.js";
import type {AiMapViewCommands} from "../../models/web/map-app-models.js";
import type {SnapshotMapDataType, SnapshotRecoverableWarningType} from "../../models/web/snapshot-ui-models.js";
import type {SnapshotMapRuntimeReadyType, SnapshotMetricScaleViewType} from "./map-surface-port.js";
import type {BrowserWarningReportType} from "../../models/common/browser-warning-models.js";
import {AppError} from "../../shared/app-error.js";
import {UI_BUILT_IN_CONFIG} from "../../shared/ui.js";

export function AiMapPage({mapDataUrl}: {mapDataUrl: string | null}) {
  const [data, setData] = useState<SnapshotMapDataType | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      if (mapDataUrl === null) throw new AppError("missing_map_data_url", "AI map data URL is missing");
      const response = await fetch(mapDataUrl, {cache: "no-store", credentials: "omit", signal: controller.signal});
      if (!response.ok) throw new AppError("ai_map_data_request", response.status === 410 ? "已过期" : `AI map data request failed: ${response.status}`);
      const parsed = mcpInteractiveMapDataSchema.parse(await response.json());
      if (!controller.signal.aborted) setData({map_payload: {...parsed.map_payload, leaflet: __GEOMCP_APP_LEAFLET__}, style_payload: __GEOMCP_APP_STYLE__});
    })().catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => controller.abort();
  }, [mapDataUrl]);
  if (error !== null) return <main role="alert" data-geomcp-ai-map-status="failed">{error}</main>;
  if (data === null) return <main data-geomcp-ai-map-status="pending">Loading AI map…</main>;
  return <AiMap mapData={data} />;
}

/** AI 页面组合共享 Snapshot 视觉与 Reference UI；Playwright 只通过纯数据命令端口驱动它。 */
function AiMap({mapData}: {mapData: SnapshotMapDataType}) {
  const [metricScale, setMetricScale] = useState<SnapshotMetricScaleViewType | null>(null);
  const [scaleSettled, setScaleSettled] = useState(false);
  const [runtime, setRuntime] = useState<SnapshotMapRuntimeReadyType | null>(null);
  const [referenceHeight, setReferenceHeight] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commandsRef = useRef<AiMapViewCommands | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const warningsRef = useRef(new Set<SnapshotRecoverableWarningType>());
  // 内部页面不经过公开 warning 代理；由持有该页面的 Server 读取结构化 console 诊断。
  const reportDiagnostic = useCallback((warning: BrowserWarningReportType): void => {
    console.warn("[GeoMCP] AI map diagnostic.", warning);
  }, []);
  const recordWarning = useCallback((warning: SnapshotRecoverableWarningType): void => {
    if (warningsRef.current.has(warning)) return;
    warningsRef.current.add(warning);
    console.warn("[GeoMCP] AI map recovered from a rendering issue.", {code: warning});
  }, []);
  const handleError = useCallback((message: string): void => {
    commandsRef.current = null;
    delete window.geomcpAiMap;
    setError(message);
  }, []);
  const handleCommands = useCallback((commands: AiMapViewCommands | null): void => {
    commandsRef.current = commands;
    if (commands === null) delete window.geomcpAiMap;
  }, []);
  const handleMetricScale = useCallback((scale: SnapshotMetricScaleViewType | null): void => {
    if (scale === null) recordWarning("scale_omitted");
    flushSync(() => { setMetricScale(scale); setScaleSettled(true); });
  }, [recordWarning]);
  const handleRuntime = useCallback((result: SnapshotMapRuntimeReadyType): void => {
    if (result.summary.status !== "ready") {
      handleError(result.summary.error?.message ?? "AI map initialization failed");
      return;
    }
    if (result.initialTiles.success_count < result.initialTiles.total_count) recordWarning("basemap_tiles_missing");
    setRuntime(result);
  }, [handleError, recordWarning]);
  const handleReferenceReady = useCallback((height: number): void => setReferenceHeight(height), []);
  const ready = error === null && runtime !== null && referenceHeight !== null && scaleSettled;

  useEffect(() => {
    const commands = commandsRef.current;
    const wrapper = wrapperRef.current;
    if (!ready || commands === null || wrapper === null) return;
    const controller = new AbortController();
    const requireAvailable = (): void => {
      controller.signal.throwIfAborted();
      if (!wrapper.isConnected) throw new AppError("ai_map_unavailable", "AI map has been released");
    };
    const port = {
      getView: () => { requireAvailable(); return commands.getView(); },
      fitBounds: commands.fitBounds,
      setCenterZoom: commands.setCenterZoom,
      waitForScreenshot: async (): Promise<void> => {
        requireAvailable();
        await commands.waitForScreenshot(controller.signal);
        await document.fonts.ready;
        const reference = wrapper.querySelector<HTMLElement>(".geomcp-reference-bar");
        const content = reference?.querySelector<HTMLElement>(".geomcp-reference-bar-content");
        if (reference === null || reference === undefined || content === null || content === undefined) throw new AppError("reference_ui_layout_failed", "AI Reference UI is missing");
        // 每次视口更新都等待真实 DOM 稳定；首屏 ready 不代表后续瓦片和 Scale 已完成。
        let previous = "";
        while (true) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          requireAvailable();
          const box = wrapper.getBoundingClientRect();
          const current = `${box.width}/${box.height}`;
          if (current === previous && reference.dataset.referenceUiStatus === "ready") {
            if (content.offsetWidth > reference.clientWidth || content.offsetHeight > reference.clientHeight) throw new AppError("reference_ui_overflow", "AI Reference UI overflowed its layout");
            return;
          }
          previous = current;
        }
      }
    };
    window.geomcpAiMap = port;
    return () => {
      controller.abort();
      if (window.geomcpAiMap === port) delete window.geomcpAiMap;
    };
  }, [ready]);

  if (error !== null) return <main role="alert" data-geomcp-ai-map-status="failed">{error}</main>;
  const payload = mapData.map_payload;
  const style: CSSProperties & Record<string, string> = {
    "--geomcp-ui-frame-width": `${UI_BUILT_IN_CONFIG.frameBorderWidthPx}px`,
    "--geomcp-map-width": `${payload.screenshot_size[0]}px`,
    "--geomcp-standard-ui-min-width": `${UI_BUILT_IN_CONFIG.referenceUi.minWidth}px`,
    "--geomcp-standard-ui-min-height": `${UI_BUILT_IN_CONFIG.referenceUi.minHeight}px`,
    "--geomcp-standard-ui-divider-width": `${UI_BUILT_IN_CONFIG.standardUi.dividerWidth}px`,
    "--geomcp-scale-max-width": `${__GEOMCP_MAX_SCALE_WIDTH_PX__}px`
  };
  return <main className="geomcp-map-page geomcp-snapshot-map-page" style={style} aria-busy={!ready} data-geomcp-ai-map-status={ready ? "ready" : "pending"}>
    <div ref={wrapperRef} className="geomcp-map-capture-frame geomcp-snapshot-wrapper">
      <div className="geomcp-snapshot-map-clip">
        <SnapshotMapSurfaceView mapPayload={payload} stylePayload={mapData.style_payload} onMetricScaleSettled={handleMetricScale} onMapRuntimeReady={handleRuntime} onRecoverableWarning={recordWarning} onSnapshotDiagnostic={reportDiagnostic} onMapRuntimeError={handleError} onAiViewCommandsChange={handleCommands} />
      </div>
      <ReferenceBar logicalWidth={payload.screenshot_size[0]} attributionText={payload.basemap.full_attribution ?? payload.basemap.attribution} metricScale={metricScale} scaleSettled={scaleSettled} onRecoverableWarning={recordWarning} onReady={handleReferenceReady} onError={handleError} />
    </div>
  </main>;
}
