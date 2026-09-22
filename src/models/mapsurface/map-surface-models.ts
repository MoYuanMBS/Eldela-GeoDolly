/** 固定尺寸 MapSurface 的初始化输入。 */

import type {LatLngBoundsLiteral, LatLngTuple} from "leaflet";
import type {IframePaddingConfigType} from "./map-config-models.js";

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
