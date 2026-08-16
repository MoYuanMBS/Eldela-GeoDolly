/** 将 raster PMTiles archive 适配为能够发布真实 tileerror 的 Leaflet GridLayer。 */

import {GridLayer, type Coords, type DoneCallback, type GridLayerOptions, type TileEvent} from "leaflet";
import type {PMTiles} from "pmtiles";

/**
 * 把 PMTiles reader 适配为 Leaflet raster GridLayer。
 *
 * 这里不使用只负责显示的通用 adapter：Browser Flow 需要缺失瓦片、Range Request 失败和图片解码失败
 * 都通过 Leaflet `tileerror` 进入统一初始 ready 状态。Layer 不拥有 Map 或 archive 生命周期；最终仍由
 * MapSurface 移除 Layer，并通过 `tileunload` 触发逐瓦片资源清理。
 */
export class PmtilesRasterLayer extends GridLayer {
  /** 每个活动 <img> 对应一次可取消读取及至多一个 Blob URL；WeakMap 不延长 DOM 节点生命周期。 */
  private readonly tileStates = new WeakMap<HTMLImageElement, {abortController: AbortController; objectUrl: string | null}>();

  /**
   * @param archive 已完成 header 校验的 PMTiles reader。
   * @param mimeType header tile type 对应的 raster MIME。
   * @param options Leaflet GridLayer 选项，其中 maxZoom/maxNativeZoom 由 Basemap runtime 明确给出。
   */
  constructor(
    private readonly archive: PMTiles,
    private readonly mimeType: string,
    options: GridLayerOptions,
  ) {
    super(options);
    this.on("tileunload", this.handleTileUnload, this);
  }

  /**
   * 为一个 Leaflet tile 创建展示节点并异步填充内容。
   * `done` 只会在图片真正解码成功或出现可报告错误时调用；已卸载 tile 不再回调 Leaflet。
   */
  protected override createTile(coords: Coords, done: DoneCallback): HTMLElement {
    const image = document.createElement("img");
    image.alt = "";
    image.setAttribute("role", "presentation");
    const abortController = new AbortController();
    this.tileStates.set(image, {abortController, objectUrl: null});
    void this.loadTile(image, coords, done, abortController);
    return image;
  }

  /** 读取单个 archive tile、创建 Blob URL，并将读取/解码终态转交 Leaflet。 */
  private async loadTile(image: HTMLImageElement, coords: Coords, done: DoneCallback, abortController: AbortController): Promise<void> {
    let settled = false;
    // Leaflet 的 done(error, tile) 会发布 tileerror；无 error 则参与本轮 GridLayer load 判定。
    const finish = (error?: Error): void => {
      // tileunload 已让 Leaflet 放弃该节点，此时不能用迟到结果污染后续视口的 ready 状态。
      if (settled || abortController.signal.aborted) return;
      settled = true;
      image.onload = null;
      image.onerror = null;
      done(error, image);
    };

    try {
      // PMTiles reader 按 z/x/y 定位目录并发起 Range Request，signal 用于视口变化或 Map dispose 时取消。
      const response = await this.archive.getZxy(coords.z, coords.x, coords.y, abortController.signal);
      if (response === undefined) {
        // archive 覆盖范围内缺瓦片属于真实底图失败，不能用透明空图伪装成 ready。
        finish(new Error(`PMTiles archive does not contain tile ${coords.z}/${coords.x}/${coords.y}`));
        return;
      }
      const state = this.tileStates.get(image);
      if (state === undefined || abortController.signal.aborted) return;
      // Blob URL 在 tileunload 前保持有效；等待 img.onload 确保“读取成功但无法解码”不会被发布为 ready。
      const objectUrl = URL.createObjectURL(new Blob([response.data], {type: this.mimeType}));
      state.objectUrl = objectUrl;
      image.onload = () => finish();
      image.onerror = () => finish(new Error(`PMTiles raster tile failed to decode at ${coords.z}/${coords.x}/${coords.y}`));
      image.src = objectUrl;
    } catch (error) {
      // 主动 abort 是正常生命周期事件；其他网络、目录或解压错误必须进入 tileerror。
      if (abortController.signal.aborted) return;
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** 视口换瓦片或 MapSurface dispose 时，终止未完成读取并释放浏览器 Blob 资源。 */
  private handleTileUnload(event: TileEvent): void {
    if (!(event.tile instanceof HTMLImageElement)) return;
    const state = this.tileStates.get(event.tile);
    if (state === undefined) return;
    state.abortController.abort();
    event.tile.onload = null;
    event.tile.onerror = null;
    if (state.objectUrl !== null) URL.revokeObjectURL(state.objectUrl);
    this.tileStates.delete(event.tile);
  }
}
