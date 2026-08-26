import type {ComponentType} from "react";
import type {CommonVisualMapPayloadType} from "../models/mapsurface/map-payload-models.js";
import type {RenderStylePayload} from "../models/mapsurface/style/user-css-style-models.js";
import type {InteractiveSpatialFeatureType} from "../models/web/interactive-ui-models.js";

/** UI 事件只携带后端 canonical identity；display_id 必须临时从后端字典查询。 */
export interface InteractiveFeatureTargetType {
  featureType: InteractiveSpatialFeatureType;
  featureId: string;
}

/** Standard UI 只消费已经格式化的比例尺展示值，不接触 Leaflet 的测量结果。 */
export interface MetricScaleViewType {
  label: string;
  widthPx: number;
}

export type MapRuntimeStatusType = "ready" | "degraded" | "failed";

/** React Toolbar 保存的命令句柄；实际地图对象仍由地图适配层独占。 */
export interface MapSurfaceZoomCommands {
  zoomIn(): void;
  zoomOut(): void;
}

export interface MapSurfaceInteractionCommands {
  clearSelection(): void;
}

/**
 * UI 与地图实现之间的唯一接线契约。
 * 这里刻意只允许可序列化 payload、纯数据事件和命令函数，禁止 Leaflet Map/Layer/Event 泄漏到 UI。
 */
export interface MapSurfacePortProps {
  mapPayload: CommonVisualMapPayloadType;
  stylePayload: RenderStylePayload;
  onMetricScaleChange(metricScale: MetricScaleViewType): void;
  onZoomCommandsChange(commands: MapSurfaceZoomCommands | null): void;
  onInteractionCommandsChange(commands: MapSurfaceInteractionCommands | null): void;
  onHoveredFeatureChange(target: InteractiveFeatureTargetType | null): void;
  onSelectedFeatureChange(target: InteractiveFeatureTargetType | null): void;
  onMapRuntimeReady(status: MapRuntimeStatusType): void;
  onMapRuntimeError(message: string): void;
}

/** MapPage 依赖 port component，而不是某个 Leaflet React 组件。 */
export type MapSurfacePortComponentType = ComponentType<MapSurfacePortProps>;
