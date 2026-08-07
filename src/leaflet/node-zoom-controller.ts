/**
 * Node 视觉 geometry 的 zoom 生命周期控制器。
 *
 * 这里只缩放 Base/addon/Relation 等可见圆，不直接缩放透明 interaction 圆。命中半径需要在
 * 可见圆完成缩放后按“实际外圈 + 固定容错”重算，由 OverlayInteractionMetricsController 负责。
 */

import {LayerGroup, type CircleMarker, type Map as LeafletMap} from "leaflet";
import type {LeafletConfigType} from "../models/config-models.js";

interface NodeCircleRegistration {
  // 原始半径始终来自 style recipe，避免连续 zoom 在上次缩放结果上累乘误差。
  layer: CircleMarker;
  baseRadius: number;
}

interface NodeFeatureRegistration {
  group: LayerGroup;
  circles: ReadonlyArray<NodeCircleRegistration>;
}

/** Node 使用屏幕像素半径；按已校验配置分级隐藏和恢复，避免低 zoom 被大量圆点覆盖。 */
export function getNodeZoomScale(zoom: number, config: LeafletConfigType["node_zoom"]): number {
  if (zoom <= config.hidden_max_zoom) return 0;
  if (zoom <= config.compact_max_zoom) return config.compact_scale;
  if (zoom <= config.medium_max_zoom) return config.medium_scale;
  return 1;
}

/**
 * 该 LayerGroup 持有全部 Node Feature groups。跨越显隐阈值时移除整个 group，保证隐藏 Node
 * 的 label 对应物和透明 interaction geometry 都不会继续留在地图上响应指针。
 */
export class NodeZoomController extends LayerGroup {
  private readonly registrations: Array<NodeFeatureRegistration> = [];

  constructor(private readonly config: LeafletConfigType["node_zoom"]) {
    super();
  }

  override onAdd(map: LeafletMap): this {
    super.onAdd(map);
    // 动画中由 Leaflet 变换 pane；只在 zoomend 批量设置最终屏幕像素半径。
    map.on("zoomend", this.updateZoom, this);
    this.updateZoom();
    return this;
  }

  override onRemove(map: LeafletMap): this {
    map.off("zoomend", this.updateZoom, this);
    super.onRemove(map);
    return this;
  }

  registerFeature(group: LayerGroup, visualCircles: ReadonlyArray<CircleMarker>): void {
    // interaction CircleMarker 不可传入；它必须保留固定的额外像素容错，而不是随视觉比例一起收缩。
    const registration = {
      group,
      circles: visualCircles.map((layer) => ({layer, baseRadius: layer.getRadius()})),
    } satisfies NodeFeatureRegistration;
    this.registrations.push(registration);
    this.applyScale(registration, getNodeZoomScale(this._map.getZoom(), this.config));
  }

  private readonly updateZoom = (): void => {
    const scale = getNodeZoomScale(this._map.getZoom(), this.config);
    for (const registration of this.registrations) this.applyScale(registration, scale);
  };

  private applyScale(registration: NodeFeatureRegistration, scale: number): void {
    for (const {layer, baseRadius} of registration.circles) layer.setRadius(baseRadius * scale);
    // 半径 0 仍可能被 Leaflet click tolerance 命中，因此隐藏时必须移除包含 hit Path 的整个 group。
    if (scale === 0) {
      if (this.hasLayer(registration.group)) super.removeLayer(registration.group);
    } else if (!this.hasLayer(registration.group)) {
      super.addLayer(registration.group);
    }
  }
}
