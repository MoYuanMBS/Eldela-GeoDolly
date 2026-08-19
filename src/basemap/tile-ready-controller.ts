/** Leaflet TileLayer 初始视口 ready 控制器。 */

import type {Map as LeafletMap, TileErrorEvent, TileEvent, TileLayer} from "leaflet";
import type {BasemapRuntimeStatus} from "../models/mapsurface/basemap-runtime-models.js";

/**
 * 为 TileLayer 中每个已发起的请求维护独立计时器。
 *
 * Leaflet 没有为单块图片提供请求超时；断网、Proxy 接口挂起或浏览器长时间不收到
 * HTTP 响应时，只依赖 `tileerror` 会使整个 ready/fallback 链路一直等待。这个监视器从
 * `tileloadstart` 开始计时，并在 load/error/abort/unload 的任一终态清理对应计时器。
 *
 * 返回的 detach 是幂等的：它同时解绑监听并清空所有未完成计时，供 ready 终态、fallback
 * 状态转换和 MapSurface 销毁共用。
 */
export function attachTileRequestTimeoutMonitor(
  tileLayer: TileLayer,
  timeoutMs: number,
  onTimeout: (coords: {x: number; y: number; z: number}) => void,
): () => void {
  const pendingTimers = new Map<HTMLImageElement, ReturnType<typeof setTimeout>>();
  let detached = false;

  const clearTileTimer = (tile: HTMLImageElement): void => {
    const timer = pendingTimers.get(tile);
    if (timer === undefined) return;
    clearTimeout(timer);
    pendingTimers.delete(tile);
  };
  const handleTileLoadStart = (event: TileEvent): void => {
    if (detached) return;
    // Leaflet 可能复用 tile element；重新开始前必须取消旧计时，避免过期回调误触发 fallback。
    clearTileTimer(event.tile);
    const coords = {x: event.coords.x, y: event.coords.y, z: event.coords.z};
    const timer = setTimeout(() => {
      pendingTimers.delete(event.tile);
      if (!detached) onTimeout(coords);
    }, timeoutMs);
    pendingTimers.set(event.tile, timer);
  };
  const handleTileFinished = (event: TileEvent): void => {
    clearTileTimer(event.tile);
  };

  tileLayer.on("tileloadstart", handleTileLoadStart);
  tileLayer.on("tileload", handleTileFinished);
  tileLayer.on("tileerror", handleTileFinished);
  tileLayer.on("tileabort", handleTileFinished);
  tileLayer.on("tileunload", handleTileFinished);

  return (): void => {
    if (detached) return;
    detached = true;
    tileLayer.off("tileloadstart", handleTileLoadStart);
    tileLayer.off("tileload", handleTileFinished);
    tileLayer.off("tileerror", handleTileFinished);
    tileLayer.off("tileabort", handleTileFinished);
    tileLayer.off("tileunload", handleTileFinished);
    for (const timer of pendingTimers.values()) clearTimeout(timer);
    pendingTimers.clear();
  };
}

/**
 * 在挂载 TileLayer 前绑定监听，并把第一次初始加载周期收敛为唯一终态。
 *
 * 第一个 `tileerror` 会立即失败；全部必要瓦片结束后发布的 `load` 则代表 ready。终态发布后立即移除
 * 本控制器的监听，后续拖动或缩放产生的瓦片事件不会反向修改已经发布的状态。本函数不拥有 Layer，
 * 因此不提供独立 dispose，也不会在失败时从 MapSurface 移除它。
 *
 * @param tileLayer 已完成来源和 zoom 配置、尚未挂载的在线 raster TileLayer。
 * @param map Browser Flow 创建并持有的唯一 Leaflet Map。
 * @param tileTimeoutMs 可选的单瓦片超时；只为 Proxy 初始周期启用。
 * @returns 初始视口瓦片唯一的 ready/failed 状态。
 */
export function mountTileLayerAndWaitForInitialReady(
  tileLayer: TileLayer,
  map: LeafletMap,
  tileTimeoutMs?: number,
): Promise<BasemapRuntimeStatus> {
  return new Promise((resolve) => {
    let settled = false;
    const detachTileTimeout = tileTimeoutMs === undefined
      ? (): void => {}
      : attachTileRequestTimeoutMonitor(tileLayer, tileTimeoutMs, (coords) => {
          settle({
            status: "failed",
            error: {code: "tile_load_timeout", message: "A required basemap tile timed out", details: {tile: coords}},
          });
        });
    // 本控制器只观察首次加载周期；终态之后由 Leaflet 自己继续管理交互产生的瓦片。
    const cleanup = (): void => {
      tileLayer.off("load", handleLoad);
      tileLayer.off("tileerror", handleTileError);
      detachTileTimeout();
    };
    const settle = (status: BasemapRuntimeStatus): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(status);
    };
    // TileLayer 的 load 只在当前可见范围没有待加载瓦片时触发。
    const handleLoad = (): void => {
      settle({status: "ready", error: null});
    };
    // 只向汇总层暴露定位失败瓦片所需的坐标，不泄漏 provider URL 或底层异常对象。
    const handleTileError = (event: TileErrorEvent): void => {
      settle({
        status: "failed",
        error: {code: "tile_load_failed", message: "A required basemap tile failed to load", details: {tile: {x: event.coords.x, y: event.coords.y, z: event.coords.z}}},
      });
    };

    tileLayer.on("load", handleLoad);
    tileLayer.on("tileerror", handleTileError);
    try {
      // 监听必须先于 addTo，避免同步创建首批瓦片时错过事件。
      tileLayer.addTo(map);
    } catch {
      settle({
        status: "failed",
        error: {code: "tile_layer_init", message: "Basemap tile layer failed to mount", details: null},
      });
    }
  });
}
