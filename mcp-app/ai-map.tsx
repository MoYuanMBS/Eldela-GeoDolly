/// <reference path="../src/browser/web/vite-env.d.ts" />

import {useCallback, useEffect, useMemo, useRef, useState, type CSSProperties} from "react";
import {SnapshotMapSurfaceView} from "../src/browser/browser-map-flow/snapshot-map-surface-view.js";
import {createBrowserWarningReporter} from "../src/browser/browser-map-flow/browser-warning-reporter.js";
import {ReferenceBar} from "../src/browser/ui/reference-bar.js";
import type {AiMapViewCommands, SnapshotMapRuntimeReadyType, SnapshotMetricScaleViewType} from "../src/browser/web/map-surface-port.js";
import type {SnapshotMapDataType, SnapshotRecoverableWarningType} from "../src/models/web/snapshot-ui-models.js";
import {UI_BUILT_IN_CONFIG} from "../src/shared/ui.js";

interface AiMapProps {
  mapData: SnapshotMapDataType;
  onAiViewCommandsChange(commands: AiMapViewCommands | null): void;
}

/** AI 页面只组合独立视觉实例与 Reference UI，不接入 User 详情或测量状态。 */
export function AiMap({mapData, onAiViewCommandsChange}: AiMapProps) {
  const [metricScale, setMetricScale] = useState<SnapshotMetricScaleViewType | null>(null);
  // null 既可能表示尚未计算，也可能表示可恢复的 Scale omitted；单独记录是否已完成首轮计算。
  const [scaleSettled, setScaleSettled] = useState(false);
  const [runtime, setRuntime] = useState<SnapshotMapRuntimeReadyType | null>(null);
  const [referenceHeight, setReferenceHeight] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commandsRef = useRef<AiMapViewCommands | null>(null);
  const warningsRef = useRef(new Set<SnapshotRecoverableWarningType>());
  const reportDiagnostic = useMemo(() => createBrowserWarningReporter(), []);

  const recordWarning = useCallback((warning: SnapshotRecoverableWarningType): void => {
    // 同一实例后续多次视口更新可能再次触发恢复路径，按 code 去重避免重复诊断。
    if (warningsRef.current.has(warning)) return;
    warningsRef.current.add(warning);
    console.warn("[GeoMCP] AI map recovered from a rendering issue.", {code: warning});
  }, []);
  const handleError = useCallback((message: string): void => {
    // 先撤销宿主能调用的命令，再让 React 展示错误并卸载 adapter，避免渲染提交前仍可操作失败实例。
    commandsRef.current = null;
    onAiViewCommandsChange(null);
    setError(message);
  }, [onAiViewCommandsChange]);
  const handleCommands = useCallback((commands: AiMapViewCommands | null): void => {
    // adapter 的地图 ready 早于 Reference UI ready；命令暂存到页面首屏完整就绪，释放信号则立即透传。
    commandsRef.current = commands;
    if (commands === null) onAiViewCommandsChange(null);
  }, [onAiViewCommandsChange]);
  const handleMetricScale = useCallback((scale: SnapshotMetricScaleViewType | null): void => {
    if (scale === null) recordWarning("scale_omitted");
    setMetricScale(scale);
    setScaleSettled(true);
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
  // 瓦片/视觉、比例尺终态和 Reference 布局全部完成后才启用工具；Scale omitted 也是合法终态。
  const ready = error === null && runtime !== null && referenceHeight !== null && scaleSettled;

  useEffect(() => {
    // ready 失效或组件卸载均撤销绑定；入口再按结果代次过滤旧组件迟到的清理回调。
    onAiViewCommandsChange(ready ? commandsRef.current : null);
    return () => onAiViewCommandsChange(null);
  }, [ready, onAiViewCommandsChange]);

  if (error !== null) return <main className="geomcp-map-page-state geomcp-map-page-error" role="alert" data-geomcp-ai-map-status="failed">{error}</main>;

  const payload = mapData.map_payload;
  const style: CSSProperties & Record<string, string> = {
    "--geomcp-ui-frame-width": `${UI_BUILT_IN_CONFIG.frameBorderWidthPx}px`,
    "--geomcp-map-width": `${payload.screenshot_size[0]}px`,
    "--geomcp-standard-ui-min-width": `${UI_BUILT_IN_CONFIG.referenceUi.minWidth}px`,
    "--geomcp-standard-ui-min-height": `${UI_BUILT_IN_CONFIG.referenceUi.minHeight}px`,
    "--geomcp-standard-ui-divider-width": `${UI_BUILT_IN_CONFIG.standardUi.dividerWidth}px`,
    "--geomcp-scale-max-width": `${__GEOMCP_MAX_SCALE_WIDTH_PX__}px`,
  };
  return (
    <main className="geomcp-map-page geomcp-snapshot-map-page" style={style} aria-busy={!ready} data-geomcp-ai-map-status={ready ? "ready" : "pending"}>
      <div className="geomcp-map-capture-frame geomcp-snapshot-wrapper">
        <div className="geomcp-snapshot-map-clip">
          <SnapshotMapSurfaceView
            mapPayload={payload}
            stylePayload={mapData.style_payload}
            onMetricScaleSettled={handleMetricScale}
            onMapRuntimeReady={handleRuntime}
            onRecoverableWarning={recordWarning}
            onSnapshotDiagnostic={reportDiagnostic}
            onMapRuntimeError={handleError}
            onAiViewCommandsChange={handleCommands}
          />
        </div>
        <ReferenceBar
          logicalWidth={payload.screenshot_size[0]}
          attributionText={payload.basemap.full_attribution ?? payload.basemap.attribution}
          metricScale={metricScale}
          scaleSettled={scaleSettled}
          onRecoverableWarning={recordWarning}
          onReady={handleReferenceReady}
          onError={handleError}
        />
      </div>
    </main>
  );
}
