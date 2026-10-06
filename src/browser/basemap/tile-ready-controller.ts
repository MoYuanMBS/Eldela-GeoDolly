/** Leaflet TileLayer 初始视口 ready 控制器。 */

import type {Map as LeafletMap, TileErrorEvent, TileEvent, TileLayer} from "leaflet";
import type {BasemapRuntimeStatus, SnapshotBasemapRuntimeResult, SnapshotInitialTileSummary, SnapshotTileViewController} from "../../models/mapsurface/basemap-runtime-models.js";
import {AppError} from "../../shared/app-error.js";

type InitialTileState = "pending" | "ready" | "failed";

interface InitialTileRecord {
  state: InitialTileState;
  tile: HTMLImageElement;
}

function tilePositionKey(coords: {x: number; y: number; z: number}): string {
  return `${coords.z}/${coords.x}/${coords.y}`;
}

function summarizeInitialTiles(records: ReadonlyMap<string, InitialTileRecord>, requiredRatio: number): SnapshotInitialTileSummary {
  let successCount = 0;
  for (const record of records.values()) {
    if (record.state === "ready") successCount += 1;
  }
  const totalCount = records.size;
  return {
    success_count: successCount,
    total_count: totalCount,
    success_ratio: totalCount === 0 ? 0 : successCount / totalCount,
    required_ratio: requiredRatio,
  };
}

type InitialTileCycleResult =
  | {reason: "complete"; records: ReadonlyMap<string, InitialTileRecord>}
  | {reason: "tile_error"; records: ReadonlyMap<string, InitialTileRecord>; tile: {x: number; y: number; z: number}}
  | {reason: "mount_error"; records: ReadonlyMap<string, InitialTileRecord>};

interface InitialTileCycleOptions {
  stopOnTileError: boolean;
  countTileAbortAsFailure: boolean;
  signal?: AbortSignal;
}

function createTileAbortError(signal: AbortSignal): AppError {
  if (signal.reason instanceof AppError) return signal.reason;
  const message = signal.reason instanceof Error ? signal.reason.message : "Basemap initial tile loading was aborted";
  return new AppError("tile_load_aborted", message, null, signal.reason instanceof Error ? {cause: signal.reason} : undefined);
}

/** 共享事件采集只负责首屏位置状态；Interactive 与 Snapshot 通过选项保持各自的失败语义。 */
function mountAndObserveInitialTileCycle(tileLayer: TileLayer, map: LeafletMap, options: InitialTileCycleOptions): Promise<InitialTileCycleResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const tileRecords = new Map<string, InitialTileRecord>();
    const failedTileElements = new WeakSet<HTMLImageElement>();

    const cleanup = (): void => {
      tileLayer.off("load", handleLoad);
      tileLayer.off("tileloadstart", handleTileLoadStart);
      tileLayer.off("tileload", handleTileLoad);
      tileLayer.off("tileerror", handleTileError);
      tileLayer.off("tileabort", handleTileAbort);
      options.signal?.removeEventListener("abort", handleAbort);
    };
    const finish = (result: InitialTileCycleResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (error: AppError): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const handleLoad = (): void => finish({reason: "complete", records: tileRecords});
    const handleTileLoadStart = (event: TileEvent): void => {
      // 同一坐标的新 element 表示真实重试；替换记录但不增加首屏位置总数。
      tileRecords.set(tilePositionKey(event.coords), {state: "pending", tile: event.tile});
    };
    const handleTileLoad = (event: TileEvent): void => {
      const key = tilePositionKey(event.coords);
      const current = tileRecords.get(key);
      // Leaflet 会把失败 img 的 src 改成透明 errorTileUrl；它随后发出的 load 不能算真实成功。
      if (failedTileElements.has(event.tile) || (current !== undefined && current.tile !== event.tile)) return;
      tileRecords.set(key, {state: "ready", tile: event.tile});
    };
    const recordTileFailure = (event: TileEvent): void => {
      const tile = {x: event.coords.x, y: event.coords.y, z: event.coords.z};
      failedTileElements.add(event.tile);
      tileRecords.set(tilePositionKey(tile), {state: "failed", tile: event.tile});
      if (options.stopOnTileError) finish({reason: "tile_error", records: tileRecords, tile});
    };
    const handleTileError = (event: TileErrorEvent): void => recordTileFailure(event);
    const handleTileAbort = (event: TileEvent): void => recordTileFailure(event);
    const handleAbort = (): void => {
      if (options.signal !== undefined) fail(createTileAbortError(options.signal));
    };

    if (options.signal?.aborted) {
      fail(createTileAbortError(options.signal));
      return;
    }
    tileLayer.on("load", handleLoad);
    tileLayer.on("tileloadstart", handleTileLoadStart);
    tileLayer.on("tileload", handleTileLoad);
    tileLayer.on("tileerror", handleTileError);
    if (options.countTileAbortAsFailure) tileLayer.on("tileabort", handleTileAbort);
    options.signal?.addEventListener("abort", handleAbort, {once: true});
    try {
      // 监听必须先于 addTo，避免同步创建首批瓦片时错过事件。
      tileLayer.addTo(map);
    } catch {
      finish({reason: "mount_error", records: tileRecords});
    }
  });
}

/** 共享 Basemap 保持原契约：首个初始瓦片失败即发布 failed，不附加 Snapshot 统计。 */
export async function mountTileLayerAndWaitForInitialReady(tileLayer: TileLayer, map: LeafletMap): Promise<BasemapRuntimeStatus> {
  const result = await mountAndObserveInitialTileCycle(tileLayer, map, {stopOnTileError: true, countTileAbortAsFailure: false});
  if (result.reason === "complete") return {status: "ready", error: null};
  if (result.reason === "tile_error") {
    return {status: "failed", error: {code: "tile_load_failed", message: "A required basemap tile failed to load", details: {tile: result.tile}}};
  }
  return {status: "failed", error: {code: "tile_layer_init", message: "Basemap tile layer failed to mount", details: null}};
}

/** Snapshot 等待整个首屏周期完成后再应用成功率；Flow signal 到期直接向上抛为 Flow timeout。 */
export async function mountTileLayerAndWaitForSnapshotReady(
  tileLayer: TileLayer,
  map: LeafletMap,
  minimumSuccessRatio: number,
  signal: AbortSignal,
): Promise<SnapshotBasemapRuntimeResult> {
  const result = await mountAndObserveInitialTileCycle(tileLayer, map, {stopOnTileError: false, countTileAbortAsFailure: true, signal});
  const initialTiles = summarizeInitialTiles(result.records, minimumSuccessRatio);
  if (result.reason === "mount_error") {
    return {status: {status: "failed", error: {code: "tile_layer_init", message: "Basemap tile layer failed to mount", details: null}}, initialTiles};
  }
  if (initialTiles.total_count === 0) {
    return {status: {status: "failed", error: {code: "tile_initial_empty", message: "Basemap initial view did not request any tiles", details: null}}, initialTiles};
  }
  if (initialTiles.success_ratio < minimumSuccessRatio) {
    return {status: {status: "failed", error: {code: "tile_success_ratio", message: "Basemap initial tile success ratio is below the required threshold", details: null}}, initialTiles};
  }
  return {status: {status: "ready", error: null}, initialTiles};
}

/** 从挂载前持续记录所属层的状态；卸载即删除，缓存命中和相同命令不依赖新的 load 事件。 */
export function observeSnapshotTileViews(layer: TileLayer, map: LeafletMap, requiredRatio: number): SnapshotTileViewController {
  const records = new Map<string, InitialTileRecord>();
  const lifetime = new AbortController();
  const start = (event: TileEvent): void => { records.set(tilePositionKey(event.coords), {state: "pending", tile: event.tile}); };
  const loaded = (event: TileEvent): void => {
    const record = records.get(tilePositionKey(event.coords));
    // 透明 fallback 的 load 和已替换 element 的迟到事件都不能算真实成功。
    if (record?.tile === event.tile && record.state === "pending") record.state = "ready";
  };
  const failed = (event: TileEvent): void => {
    const record = records.get(tilePositionKey(event.coords));
    if (record?.tile === event.tile) record.state = "failed";
  };
  const removed = (event: TileEvent): void => {
    const key = tilePositionKey(event.coords);
    if (records.get(key)?.tile === event.tile) records.delete(key);
  };
  layer.on("tileloadstart", start);
  layer.on("tileload", loaded);
  layer.on("tileerror", failed);
  layer.on("tileunload", removed);
  layer.on("tileabort", removed);

  return {
    async waitForCurrentView(signal) {
      const waitingSignal = AbortSignal.any([signal, lifetime.signal]);
      const zoom = map.getZoom();
      const center = map.getCenter();
      const tileZoom = Math.max(layer.options.minNativeZoom ?? 0, Math.min(layer.options.maxNativeZoom ?? zoom, Math.round(zoom)));
      const size = layer.getTileSize();
      const pixelCenter = map.project(center, tileZoom).floor();
      const halfSize = map.getSize().divideBy(map.getZoomScale(zoom, tileZoom) * 2);
      const min = pixelCenter.subtract(halfSize).unscaleBy(size).floor();
      const max = pixelCenter.add(halfSize).unscaleBy(size).ceil().subtract([1, 1]);
      const world = map.getPixelWorldBounds(tileZoom);
      const worldMin = world?.min?.unscaleBy(size).floor();
      const worldMax = world?.max?.unscaleBy(size).ceil().subtract([1, 1]);
      const keys: string[] = [];
      // 使用未 wrap 的屏幕位置计数；同 URL 的不同世界副本仍是两个位置。排除 Mercator 世界外的空白。
      for (let y = min.y; y <= max.y; y += 1) {
        if (worldMin !== undefined && worldMax !== undefined && (y < worldMin.y || y > worldMax.y)) continue;
        for (let x = min.x; x <= max.x; x += 1) {
          if (!map.options.crs?.wrapLng && worldMin !== undefined && worldMax !== undefined && (x < worldMin.x || x > worldMax.x)) continue;
          keys.push(tilePositionKey({x, y, z: tileZoom}));
        }
      }
      if (keys.length === 0) throw new AppError("tile_view_empty", "The current basemap view has no required tiles");
      while (true) {
        waitingSignal.throwIfAborted();
        if (map.getZoom() !== zoom || !map.getCenter().equals(center)) throw new AppError("ai_map_view_changed", "The AI map view changed while waiting for its tiles");
        const visible = new Map<string, InitialTileRecord>();
        let pending = false;
        for (const key of keys) {
          const record = records.get(key);
          if (record === undefined || record.state === "pending") { pending = true; continue; }
          visible.set(key, record);
          // Leaflet 的 tileload 先于淡入结束；读取公开 DOM 样式等待真实显示，不固定 sleep 或访问 _tiles。
          if (record.state === "ready" && (!record.tile.isConnected || Number(getComputedStyle(record.tile).opacity) < 1)) pending = true;
        }
        if (!pending) {
          const summary = summarizeInitialTiles(visible, requiredRatio);
          if (summary.success_ratio < requiredRatio) throw new AppError("tile_success_ratio", "Current basemap tile success ratio is below the required threshold", {...summary});
          return {...summary, tiles: [...visible.values()].filter((record) => record.state === "ready").map((record) => record.tile)};
        }
        await new Promise<void>((resolve, reject) => {
          const abort = (): void => { cancelAnimationFrame(frame); reject(waitingSignal.reason); };
          const frame = requestAnimationFrame(() => { waitingSignal.removeEventListener("abort", abort); resolve(); });
          waitingSignal.addEventListener("abort", abort, {once: true});
        });
      }
    },
    dispose() {
      lifetime.abort(new AppError("ai_map_unavailable", "Basemap runtime has been released"));
      layer.off("tileloadstart", start);
      layer.off("tileload", loaded);
      layer.off("tileerror", failed);
      layer.off("tileunload", removed);
      layer.off("tileabort", removed);
      records.clear();
    }
  };
}
