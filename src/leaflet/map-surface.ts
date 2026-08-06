/**
 * 固定尺寸 MapSurface 与 Leaflet 初始视口。
 *
 * 调用位置位于浏览器样式初始化之后、Overlay renderer 之前。本模块只建立地图容器与
 * viewport，不知道 tag rule、Feature geometry、标签和交互图层，避免视口计算反向依赖渲染结果。
 */

import {
  latLngBounds,
  map as createLeafletMap,
  point,
  type LatLngBoundsLiteral,
  type LatLngTuple,
  type Map as LeafletMap,
} from "leaflet";
import type {IframePaddingConfigType} from "../models/config-models.js";

export interface MapSurfaceOptions {
  /** Leaflet 将接管的空 DOM 容器。 */
  container: HTMLElement;
  /** MapSurface 的固定 CSS 尺寸，不包含 Toolbar。 */
  screenshotSize: readonly [width: number, height: number];
  /** 后端在 EPSG:3857 中计算的 [latitude, longitude]。 */
  center: LatLngTuple;
  /** [[south, west], [north, east]]；跨日期变更线时 east 已展开。 */
  leafletBounds: LatLngBoundsLiteral;
  /** 已由 iframeAdaptiveConfigSchema 校验的对称安全距离。 */
  padding: IframePaddingConfigType;
}

/**
 * 创建固定尺寸 Leaflet map，并用 leafletBounds 求整数 zoom 后设置后端 center。
 *
 * padding 只参与 getBoundsZoom，不修改 leafletBounds 或 center。本模块不创建
 * 渲染 pane，也不接入 basemap、Overlay、样式和 ready 信号。
 */
export function createMapSurface(options: MapSurfaceOptions): LeafletMap {
  const {
    container,
    screenshotSize: [width, height],
    center,
    leafletBounds,
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

  const bounds = latLngBounds(leafletBounds);
  // getBoundsZoom 接收的是横纵总 padding，而不是单边 padding。
  const totalPadding = point(padding.left + padding.right, padding.top + padding.bottom);
  // bbox 只负责决定 zoom；跨日期变更线已经由上游展开，最终视口中心仍使用后端给出的 center。
  const initialZoom = leafletMap.getBoundsZoom(bounds, false, totalPadding);
  leafletMap.setView(center, initialZoom, {animate: false});
  return leafletMap;
}
