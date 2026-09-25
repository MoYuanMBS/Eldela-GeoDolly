/**
 * Node 视觉 geometry 的 zoom 生命周期控制器。
 *
 * 这里只缩放 Base/addon/Relation 等可见圆，不接触透明 interaction 圆。可见圆更新后，
 * OverlayVisualMeasurementController 在下一帧发布实际外圈；Interactive 再据此更新命中半径。
 */

import {LayerGroup, type CircleMarker, type Map as LeafletMap} from "leaflet";
import type {OverlayNodeIconLayer} from "../../../models/mapsurface/leaflet-renderer-models.js";
import type {LeafletConfigType} from "../../../models/mapsurface/map-config-models.js";

interface NodeCircleRegistration {
  // 原始半径始终来自 style recipe，避免连续 zoom 在上次缩放结果上累乘误差。
  layer: CircleMarker;
  baseRadius: number;
}

interface NodeFeatureRegistration {
  group: LayerGroup;
  circles: ReadonlyArray<NodeCircleRegistration>;
  icons: ReadonlyArray<OverlayNodeIconLayer>;
}

/** Node 使用屏幕像素半径；按已校验配置分级隐藏和恢复，避免低 zoom 被大量圆点覆盖。 */
export function getNodeZoomScale(zoom: number, config: LeafletConfigType["node_zoom"]): number {
  if (zoom <= config.hidden_max_zoom) return 0;
  if (zoom <= config.compact_max_zoom) return config.compact_scale;
  if (zoom <= config.medium_max_zoom) return config.medium_scale;
  return 1;
}

/**
 * 该 LayerGroup 只持有全部 Node Visual groups。跨越显隐阈值时移除视觉 group；随后统一
 * measurement 会发布不可见状态，Label 与独立 Interaction 生命周期各自隐藏对应对象。
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

  registerFeature(group: LayerGroup, visualCircles: ReadonlyArray<CircleMarker>, visualIcons: ReadonlyArray<OverlayNodeIconLayer> = []): void {
    // interaction CircleMarker 不属于 Visual group，也不能传入这里随视觉比例一起收缩。
    const registration = {
      group,
      circles: visualCircles.map((layer) => ({layer, baseRadius: layer.getRadius()})),
      icons: visualIcons,
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
    for (const icon of registration.icons) icon.setZoomScale(scale);
    // 半径 0 的 Visual group 直接卸载；透明 hit Path 由 measurement 订阅者在自己的 root 中移除。
    if (scale === 0) {
      if (this.hasLayer(registration.group)) super.removeLayer(registration.group);
    } else if (!this.hasLayer(registration.group)) {
      super.addLayer(registration.group);
    }
  }
}
