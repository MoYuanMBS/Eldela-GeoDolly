/** Interactive 专属的部署级 raster PMTiles Basemap runtime。 */

import {PMTiles, TileType} from "pmtiles";
import type {JsonValueType} from "../models/backend/bridge-models.js";
import type {BasemapRuntimeOptions, BasemapRuntimeStatus} from "../models/mapsurface/basemap-runtime-models.js";
import {mountTileLayerAndWaitForInitialReady} from "./tile-ready-controller.js";
import {PmtilesRasterLayer} from "./pmtiles-raster-layer.js";

/** 将 archive/runtime 局部失败收敛为 Basemap 状态；它们不属于 Browser Flow 的 AppError throw 路径。 */
function createFailedStatus(code: string, message: string, details: JsonValueType = null): BasemapRuntimeStatus {
  return {status: "failed", error: {code, message, details}};
}

/**
 * 将 PMTiles header 的 raster tile type 转换成 Blob MIME。
 * Vector MVT/MLT 不在本 Basemap runtime 职责内，调用方会把 null 转换成明确失败状态。
 */
function getRasterMimeType(tileType: TileType): string | null {
  if (tileType === TileType.Png) return "image/png";
  if (tileType === TileType.Jpeg) return "image/jpeg";
  if (tileType === TileType.Webp) return "image/webp";
  if (tileType === TileType.Avif) return "image/avif";
  return null;
}

/**
 * 创建并挂载 Interactive PMTiles layer，等待初始视口内全部必要 raster tiles 到达终态。
 *
 * 本 runtime 只读取 resolved profile，不读取 YAML、不处理 attribution，也不重新计算 center、bounds
 * 或 map zoom。ready 的 GridLayer 交给唯一 MapSurface 持有并随其 dispose；failed 的尝试会在返回前
 * 移除自身，保证 Interactive Flow 可以安全挂载在线 fallback，而不叠加两层底图。
 *
 * @param options 已创建的 MapSurface，以及 Node 侧解析完成的 basemap profile 快照。
 * @returns 初始视口瓦片的 ready/failed 状态；archive 或 tile 失败不会从本函数 throw AppError。
 */
export async function createPmtilesBasemapRuntime(options: BasemapRuntimeOptions): Promise<BasemapRuntimeStatus> {
  const pmtilesConfig = options.basemap.interactive_pmtiles;
  // Interactive Flow 正常不会在 null 时调用本函数；保留守卫以维持 runtime 自身输入边界。
  if (pmtilesConfig === null) {
    return createFailedStatus("pmtiles_profile_missing", "Interactive PMTiles source is not configured");
  }

  const archive = new PMTiles(pmtilesConfig.url);
  let header;
  try {
    // PMTiles reader 先通过 Range Request 获取 header/directory；不可访问、CORS 或格式错误都属于底图失败。
    header = await archive.getHeader();
  } catch {
    return createFailedStatus("pmtiles_header_failed", "Interactive PMTiles archive header could not be loaded");
  }

  // Basemap 只接受浏览器能够直接解码成 <img> 的 raster 内容。
  const mimeType = getRasterMimeType(header.tileType);
  if (mimeType === null) {
    return createFailedStatus("pmtiles_tile_type", "Interactive PMTiles archive must contain raster tiles", {tile_type: header.tileType});
  }
  // archive 必须覆盖 MapSurface 允许的最低层级，并覆盖 profile 声明的全部原生层级。
  if (header.minZoom > options.mapSurface.map.getMinZoom() || header.maxZoom < pmtilesConfig.max_native_zoom) {
    return createFailedStatus("pmtiles_zoom_range", "Interactive PMTiles archive does not cover the configured native zoom range", {
      archive_min_zoom: header.minZoom,
      archive_max_zoom: header.maxZoom,
      configured_min_zoom: options.mapSurface.map.getMinZoom(),
      configured_max_native_zoom: pmtilesConfig.max_native_zoom,
    });
  }

  try {
    const map = options.mapSurface.map;
    // MapSurface 使用 viewport zoom 范围；只有 archive 请求层级在 maxNativeZoom 截止并向上放大。
    // tileSize 不显式传入，统一使用 Leaflet GridLayer 默认的 256px。
    const layer = new PmtilesRasterLayer(archive, mimeType, {
      minZoom: map.getMinZoom(),
      maxZoom: map.getMaxZoom(),
      maxNativeZoom: pmtilesConfig.max_native_zoom,
    });
    // 与在线 TileLayer 共用首次 load/tileerror 契约，避免 Browser Flow 感知两种底图实现。
    const status = await mountTileLayerAndWaitForInitialReady(layer, map);
    // failed layer 不属于最终 MapSurface 内容；先移除并触发 tileunload 清理，再允许 Flow 挂载在线 fallback。
    if (status.status === "failed") layer.remove();
    return status;
  } catch {
    // 构造或挂载的同步异常同样只终止 Basemap 分支，由 Flow 汇总最终地图状态。
    return createFailedStatus("pmtiles_layer_init", "Interactive PMTiles layer failed to initialize");
  }
}
