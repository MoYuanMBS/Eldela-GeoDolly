/**
 * Node 视觉与命中区域共用的 zoom 生命周期控制器。
 *
 * Overlay renderer 把同一 Node 的 Base、addon 和透明 hit Path 放进一个 FeatureGroup，再注册到这里；
 * Label layer 不持有这些 Path，但读取同一个 getNodeZoomScale，因此三条路径使用一致的显隐阈值。
 */

import {LayerGroup, type CircleMarker, type Map as LeafletMap} from "leaflet";

interface NodeCircleRegistration {
  // baseRadius 永远保存 style recipe 的原始屏幕像素值，避免连续 zoom 在上次结果上累乘误差。
  layer: CircleMarker;
  baseRadius: number;
}

interface NodeFeatureRegistration {
  group: LayerGroup;
  circles: ReadonlyArray<NodeCircleRegistration>;
}

/**
 * Node 使用屏幕像素半径，因此不能依靠 Leaflet projection 自动缩放。
 * 低 zoom 完全隐藏，较高 zoom 分级恢复尺寸，避免概览视口被大量圆点覆盖。
 */
export function getNodeZoomScale(zoom: number): number {
  if (zoom <= 13) return 0;
  if (zoom <= 15) return 0.55;
  if (zoom <= 17) return 0.8;
  return 1;
}

/**
 * 该 LayerGroup 持有全部 Node feature groups。跨越显隐阈值时直接移除整个 group，
 * 保证不可见 Node 的透明 interaction geometry 也不会继续命中。
 */
export class NodeZoomController extends LayerGroup {
  private readonly registrations: Array<NodeFeatureRegistration> = [];

  override onAdd(map: LeafletMap): this {
    super.onAdd(map);
    // 只在 zoomend 批量更新；缩放动画期间 Leaflet 自身负责 pane 变换，避免逐帧遍历全部 Node。
    map.on("zoomend", this.updateZoom, this);
    this.updateZoom();
    return this;
  }

  override onRemove(map: LeafletMap): this {
    map.off("zoomend", this.updateZoom, this);
    super.onRemove(map);
    return this;
  }

  registerFeature(group: LayerGroup, circles: ReadonlyArray<CircleMarker>): void {
    // 注册发生在单次 Overlay 遍历中；这里不再读取 Feature tags 或重新计算 style。
    const registration = {
      group,
      circles: circles.map((layer) => ({layer, baseRadius: layer.getRadius()})),
    } satisfies NodeFeatureRegistration;
    this.registrations.push(registration);
    this.applyScale(registration, getNodeZoomScale(this._map.getZoom()));
  }

  private readonly updateZoom = (): void => {
    const scale = getNodeZoomScale(this._map.getZoom());
    for (const registration of this.registrations) this.applyScale(registration, scale);
  };

  private applyScale(registration: NodeFeatureRegistration, scale: number): void {
    for (const {layer, baseRadius} of registration.circles) layer.setRadius(baseRadius * scale);
    // 半径设为 0 仍可能被 Leaflet 的 click tolerance 命中，因此隐藏时必须把整个 group 移出地图。
    if (scale === 0) {
      if (this.hasLayer(registration.group)) super.removeLayer(registration.group);
    } else if (!this.hasLayer(registration.group)) {
      super.addLayer(registration.group);
    }
  }
}
