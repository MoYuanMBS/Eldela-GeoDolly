/** Browser 侧在线 raster TileLayer runtime。 */

import {tileLayer, Util, type Map as LeafletMap, type TileLayer} from "leaflet";
import type {BasemapRuntimeOptions, BasemapRuntimeStatus} from "../models/mapsurface/basemap-runtime-models.js";
import {attachTileRequestTimeoutMonitor, mountTileLayerAndWaitForInitialReady} from "./tile-ready-controller.js";

type TileFailureReason = "tile_layer_init" | "tile_load_failed" | "tile_load_timeout";
type RuntimeProxyFallbackState = "proxy_active" | "fallback_scheduled" | "origin_active" | "disposed";

/** `{r}` 只参与部署模板兼容校验；实际请求固定清空，确保 DPR 不改变瓦片来源。 */
function prepareTileUrlForLeaflet(tileUrl: string): string {
  return tileUrl.replaceAll("{r}", "");
}

/** Map zoom 与原生瓦片 zoom 保持独立；失败图片统一替换为 Leaflet 内置透明空图。 */
function createRasterTileLayer(tileUrl: string, map: LeafletMap, maxNativeZoom: number): TileLayer {
  // 保留 payload 中的原始模板，只在这个 Leaflet 调用边界清空 `{r}`。
  const leafletTileUrl = prepareTileUrlForLeaflet(tileUrl);
  return tileLayer(leafletTileUrl, {
    maxZoom: map.getMaxZoom(),
    maxNativeZoom,
    detectRetina: false,
    errorTileUrl: Util.emptyImageUrl,
  });
}

function removeTileLayerIfMounted(layer: TileLayer, map: LeafletMap): void {
  if (map.hasLayer(layer)) map.removeLayer(layer);
}

function getFailureReason(status: Extract<BasemapRuntimeStatus, {status: "failed"}>): TileFailureReason {
  if (status.error.code === "tile_load_failed" || status.error.code === "tile_load_timeout") return status.error.code;
  return "tile_layer_init";
}

/**
 * 原始来源已经处于 ready 后，单块失败只发布长期 warning；`errorTileUrl` 负责显示透明空瓦片。
 * reporter 自己按页面/profile/phase/reason 去重，因此这里保留每次 Leaflet 事件的直接语义。
 */
function attachOriginRuntimeWarning(layer: TileLayer, options: BasemapRuntimeOptions): void {
  layer.on("tileerror", () => {
    options.warningReporter?.({
      event: "basemap_origin_tile_unavailable",
      details: {profile_id: options.basemap.id, phase: "runtime", reason_code: "tile_load_failed"},
    });
  });
}

/**
 * Proxy 首次 ready 后仍持续观察交互产生的瓦片；任一失败都永久切换整个页面生命周期到原始来源。
 *
 * 已发布的 Basemap ready status 不会被反向修改。原始 TileLayer 无法创建/挂载时只记录 warning，
 * 页面保留没有底图的 MapSurface；后续原始瓦片 HTTP 失败则由透明空瓦片和长期 warning 处理。
 */
function attachRuntimeProxyFallback(proxyLayer: TileLayer, options: BasemapRuntimeOptions): void {
  const map = options.mapSurface.map;
  let state: RuntimeProxyFallbackState = "proxy_active";
  let detachTileTimeout = (): void => {};

  // 失败观察者与状态分离清理：触发方先同步改状态，再解绑，才能抵御同一批瓦片的并发回调。
  const detachProxyFailureObservers = (): void => {
    proxyLayer.off("tileerror", handleProxyTileError);
    detachTileTimeout();
  };
  const handleMapUnload = (): void => {
    if (state === "disposed") return;
    state = "disposed";
    detachProxyFailureObservers();
    map.off("unload", handleMapUnload);
  };

  const triggerFallback = (reasonCode: Exclude<TileFailureReason, "tile_layer_init">): void => {
    if (state !== "proxy_active") return;
    // 必须在任何 await/microtask 之前完成唯一状态转换，使同时到达的 error/timeout 只能调度一次。
    state = "fallback_scheduled";
    detachProxyFailureObservers();
    // Leaflet 在 `_tileReady()` 中途同步触发 tileerror；延后一拍切层，避免事件返回后访问已移除 Layer。
    queueMicrotask(() => {
      if (state !== "fallback_scheduled") return;
      map.off("unload", handleMapUnload);
      // 进入终态后即使 reporter 或 Leaflet 同步抛错，也不会重新启动第二次 fallback。
      state = "origin_active";
      removeTileLayerIfMounted(proxyLayer, map);
      options.warningReporter?.({
        event: "basemap_proxy_fallback",
        details: {profile_id: options.basemap.id, phase: "runtime", reason_code: reasonCode},
      });

      let originLayer: TileLayer | null = null;
      try {
        originLayer = createRasterTileLayer(options.basemap.url, map, options.basemap.max_native_zoom);
        attachOriginRuntimeWarning(originLayer, options);
        originLayer.addTo(map);
      } catch {
        // addTo 部分成功后仍可能抛错；主动移除，确保页面只留下明确的空底图状态。
        if (originLayer !== null) {
          originLayer.off("tileerror");
          removeTileLayerIfMounted(originLayer, map);
        }
        // ready 后的 fallback 失败不再拥有可返回的 Promise 终态，只保留 warning 并让底图区域为空。
        options.warningReporter?.({
          event: "basemap_origin_tile_unavailable",
          details: {profile_id: options.basemap.id, phase: "runtime", reason_code: "tile_layer_init"},
        });
      }
    });
  };
  const handleProxyTileError = (): void => {
    triggerFallback("tile_load_failed");
  };

  proxyLayer.on("tileerror", handleProxyTileError);
  detachTileTimeout = attachTileRequestTimeoutMonitor(proxyLayer, options.proxyTileTimeoutMs, () => {
    triggerFallback("tile_load_timeout");
  });
  // MapSurface.dispose() 最终触发 unload；先解绑长期监听，避免销毁期间误启动 fallback。
  map.once("unload", handleMapUnload);
}

/** 创建原始来源并等待初始终态；只有 ready 后才开始长期空瓦片 warning。 */
async function mountOriginForInitialReady(options: BasemapRuntimeOptions): Promise<BasemapRuntimeStatus> {
  const map = options.mapSurface.map;
  let originLayer: TileLayer;
  try {
    originLayer = createRasterTileLayer(options.basemap.url, map, options.basemap.max_native_zoom);
  } catch {
    return {
      status: "failed",
      error: {code: "tile_layer_init", message: "Basemap tile layer failed to initialize", details: null},
    };
  }
  const status = await mountTileLayerAndWaitForInitialReady(originLayer, map);
  if (status.status === "ready") attachOriginRuntimeWarning(originLayer, options);
  return status;
}

/**
 * 优先创建已解析的 Proxy TileLayer；Proxy 初始化或首屏瓦片失败时 warning 并切换原始来源。
 *
 * 初始原始来源也失败才返回 failed。首次 ready 后的 Proxy/原始来源错误由长期 warning 与透明空瓦片
 * 处理，不反向修改 ready summary。TileLayer 最终随 MapSurface 统一销毁，本 runtime 不返回 handle。
 */
export async function createBasemapRuntime(options: BasemapRuntimeOptions): Promise<BasemapRuntimeStatus> {
  if (options.basemap.proxy_tile_url === null) {
    return mountOriginForInitialReady(options);
  }

  const map = options.mapSurface.map;
  let proxyLayer: TileLayer;
  try {
    proxyLayer = createRasterTileLayer(options.basemap.proxy_tile_url, map, options.basemap.max_native_zoom);
  } catch {
    options.warningReporter?.({
      event: "basemap_proxy_fallback",
      details: {profile_id: options.basemap.id, phase: "initial", reason_code: "tile_layer_init"},
    });
    return mountOriginForInitialReady(options);
  }

  const proxyStatus = await mountTileLayerAndWaitForInitialReady(proxyLayer, map, options.proxyTileTimeoutMs);
  if (proxyStatus.status === "ready") {
    attachRuntimeProxyFallback(proxyLayer, options);
    return proxyStatus;
  }

  removeTileLayerIfMounted(proxyLayer, map);
  options.warningReporter?.({
    event: "basemap_proxy_fallback",
    details: {profile_id: options.basemap.id, phase: "initial", reason_code: getFailureReason(proxyStatus)},
  });
  return mountOriginForInitialReady(options);
}
