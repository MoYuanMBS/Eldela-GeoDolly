/** Browser Map Flow 的统一 timeout 与精简终态汇总。 */

import type {CoreOverlayRenderResult} from "../models/mapsurface/core-render-models.js";
import type {BasemapRuntimeStatus, MapFlowReadySummary} from "../models/mapsurface/basemap-runtime-models.js";
import type {MapSurfaceHandle, OverlayRenderResult} from "../models/mapsurface/leaflet-renderer-models.js";
import {AppError} from "../utils/app-error.js";

/** 保留调用方取消语义，同时让统一 timeout 可以中断正在分批执行的 Visual。 */
export function combineMapFlowAbortSignal(signal: AbortSignal | undefined, timeoutSignal: AbortSignal): AbortSignal {
  return signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
}

/** 在统一上限内等待 Map Flow 的异步子流程；超时时同步中断 Visual signal。 */
export function waitForMapFlowReady<T>(promise: Promise<T>, timeoutMs: number, timeoutController: AbortController): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeoutId);
      callback();
    };
    const timeoutId = globalThis.setTimeout(() => {
      const error = new AppError("map_ready_timeout", "Browser map flow did not reach initial ready before timeout", {timeout_ms: timeoutMs});
      timeoutController.abort(error);
      finish(() => reject(error));
    }, timeoutMs);
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

/** 汇总当前 Flow 已完成的必要子流程；Reference UI 暂时是无内容的 ready 占位。 */
export function createMapFlowReadySummary(
  mapSurface: MapSurfaceHandle,
  basemapStatus: BasemapRuntimeStatus,
  visualResult: OverlayRenderResult | null,
  coreResult: CoreOverlayRenderResult | null,
): MapFlowReadySummary {
  const southWest = mapSurface.initialViewBounds.getSouthWest();
  const northEast = mapSurface.initialViewBounds.getNorthEast();
  const error = basemapStatus.status === "failed" ? Object.freeze({...basemapStatus.error}) : null;
  return Object.freeze({
    status: error === null ? "ready" : "failed",
    error,
    initial_view: Object.freeze({
      center: [mapSurface.initialCenter.lat, mapSurface.initialCenter.lng] as [number, number],
      zoom: mapSurface.initialZoom,
      bounds: [[southWest.lat, southWest.lng], [northEast.lat, northEast.lng]] as [[number, number], [number, number]],
    }),
    basemap: basemapStatus,
    overlay: visualResult === null ? "skipped" : "ready",
    core_overlay: coreResult === null ? "skipped" : "ready",
    reference_ui: "ready",
  });
}
