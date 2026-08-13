/**
 * 固定尺寸 MapSurface 与 Leaflet 初始视口。
 *
 * 调用位置位于浏览器样式初始化之后、Overlay renderer 之前。本模块只建立地图容器与
 * viewport，不知道 tag rule、Feature geometry、标签和交互图层，避免视口计算反向依赖渲染结果。
 */

import {
  latLng,
  latLngBounds,
  map as createLeafletMap,
  point,
  type LatLngBoundsLiteral,
  type LatLngTuple,
} from "leaflet";
import type {IframePaddingConfigType} from "../../models/config-models.js";
import type {MapSurfaceHandle} from "../../models/leaflet-renderer-models.js";

/** MapSurface 只接受已经由上游校验、且足以确定初始视口的稳定输入。 */
export interface MapSurfaceOptions {
  /** Leaflet 将接管的空 DOM 容器。 */
  container: HTMLElement;
  /** MapSurface 的固定 CSS 尺寸，不包含 Toolbar。 */
  screenshotSize: readonly [width: number, height: number];
  /** 后端在 EPSG:3857 中计算的 [latitude, longitude]。 */
  center: LatLngTuple;
  /** [[south, west], [north, east]]；跨日期变更线时 east 已展开。 */
  requestedLeafletBounds: LatLngBoundsLiteral;
  /** 已由 leafletConfigSchema 校验的地图视觉 zoom 上限。 */
  maxZoom: number;
  /** 已由 iframeAdaptiveConfigSchema 校验的对称安全距离。 */
  padding: IframePaddingConfigType;
}

/**
 * 创建固定尺寸 Leaflet map，并用 requestedLeafletBounds 求整数 zoom 后设置后端 center。
 *
 * padding 只参与 getBoundsZoom，不修改请求 bbox 或 center。返回 handle 同时保存请求 bbox
 * 与 setView 后的实际初始视口；本模块不创建 pane，也不接入 basemap、Overlay 或 ready 信号。
 */
export function createMapSurface(options: MapSurfaceOptions): MapSurfaceHandle {
  const {
    container,
    screenshotSize: [width, height],
    center,
    requestedLeafletBounds,
    maxZoom,
    padding,
  } = options;

  // 先固定容器尺寸，Leaflet 才能用真实 MapSurface 像素计算初始 zoom。
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;

  const leafletMap = createLeafletMap(container, {
    preferCanvas: true,
    attributionControl: false,
    zoomSnap: 1,
  });

  const requestedBounds = latLngBounds(requestedLeafletBounds);
  // getBoundsZoom 接收的是横纵总 padding，而不是单边 padding。
  const totalPadding = point(padding.left + padding.right, padding.top + padding.bottom);
  // 先取得未受 Map maxZoom 影响的 bbox zoom，再显式应用部署期视觉上限。
  const rawMapZoom = leafletMap.getBoundsZoom(requestedBounds, false, totalPadding);
  const mapZoom = Math.min(rawMapZoom, maxZoom);
  // Map 本身使用同一上限，确保后续交互缩放也不能越过 viewport.max_zoom。
  leafletMap.setMaxZoom(maxZoom);
  // bbox 只负责决定 zoom；跨日期变更线已经由上游展开，最终视口中心仍使用后端给出的 center。
  leafletMap.setView(center, mapZoom, {animate: false});
  // 捕获 setView 后 Leaflet 实际采用的状态；后续 map 拖动缩放不得反向修改这些初始快照。
  const initialCenterValue = leafletMap.getCenter();
  const initialCenter = latLng(initialCenterValue.lat, initialCenterValue.lng, initialCenterValue.alt);
  const initialZoom = leafletMap.getZoom();
  const actualViewBounds = leafletMap.getBounds();
  const initialViewBounds = latLngBounds(actualViewBounds.getSouthWest(), actualViewBounds.getNorthEast());
  const logicalSize = leafletMap.getSize().clone();
  let disposed = false;
  // React cleanup、Flow 异常清理可能先后到达；幂等保护避免重复 remove 触发 Leaflet 错误。
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    leafletMap.remove();
  };
  return Object.freeze({
    map: leafletMap,
    requestedLeafletBounds: requestedBounds,
    initialCenter,
    initialZoom,
    initialViewBounds,
    logicalSize,
    dispose,
  });
}
