/**
 * 透明 Canvas interaction geometry 与实际视觉可见性同步。
 *
 * 每个空间 Feature 只有一个 interactive Path。Canvas/Relation 层可以直接读取 Leaflet options；
 * CSS 层必须在 SVG 挂载后读取 computed style。同步器严格分成“批量读”和“批量写”两阶段，
 * 既避免大量 Feature 交替触发布局，也不把 CSS presentation 反向混入 Canvas 样式解析。
 */

import {CircleMarker, Layer, circleMarker, polygon, polyline, type LayerGroup, type Map as LeafletMap, type Path, type Renderer} from "leaflet";
import type {LeafletConfigType} from "../models/config-models.js";
import type {
  LeafletSpatialGeometry,
  MeasuredOverlayInteraction,
  OverlayCssVisualMeasurement,
  OverlayInteractionRegistration,
  OverlayVisualMeasurement,
} from "../models/leaflet-renderer-models.js";
import type {CanvasSpatialFeatureType} from "../models/style/base-canvas-style.js";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function parseCssNumber(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return value.trim().endsWith("%") ? parsed / 100 : parsed;
}

function parseCssPixels(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * computed style 通常已经把颜色归一为 rgb/rgba；同时兼容 Leaflet options 中可能出现的
 * transparent、四/八位 hex 与现代 rgb(... / alpha) 写法，防止透明颜色被误认为可见。
 */
function hasVisibleColor(value: string | undefined | null): boolean {
  if (value === undefined || value === null) return true;
  const color = value.trim().toLowerCase();
  if (color === "" || color === "none" || color === "transparent") return false;
  const shortHex = /^#[0-9a-f]{3}([0-9a-f])$/i.exec(color);
  if (shortHex !== null) return Number.parseInt(shortHex[1], 16) > 0;
  const longHex = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(color);
  if (longHex !== null) return Number.parseInt(longHex[1], 16) > 0;
  const functionalColor = /^rgba?\((.*)\)$/i.exec(color);
  if (functionalColor === null) return true;
  const body = functionalColor[1];
  const slashIndex = body.lastIndexOf("/");
  if (slashIndex >= 0) return parseCssNumber(body.slice(slashIndex + 1), 1) > 0;
  const components = body.split(",");
  return components.length < 4 || parseCssNumber(components[3], 1) > 0;
}

function getOptionNodeRadius(layer: Path): number {
  return layer instanceof CircleMarker ? Math.max(0, layer.getRadius()) : 0;
}

function getOptionStrokeWidth(layer: Path): number {
  const opacity = layer.options.opacity ?? 1;
  const width = layer.options.weight ?? 0;
  if (layer.options.stroke === false || !Number.isFinite(opacity) || opacity <= 0 || !Number.isFinite(width) || width <= 0) return 0;
  return hasVisibleColor(layer.options.color) ? width : 0;
}

function hasOptionFill(featureType: CanvasSpatialFeatureType, layer: Path): boolean {
  if (featureType === "way" || layer.options.fill === false) return false;
  const opacity = layer.options.fillOpacity ?? 0.2;
  return Number.isFinite(opacity) && opacity > 0 && hasVisibleColor(layer.options.fillColor ?? layer.options.color);
}

/** 从 Canvas/Leaflet options 得到当前 Path 对 Feature 可见像素的贡献。 */
function measureOptionPath(featureType: CanvasSpatialFeatureType, layer: Path): OverlayVisualMeasurement {
  const strokeWidthPx = getOptionStrokeWidth(layer);
  const fillVisible = hasOptionFill(featureType, layer);
  const strokeVisible = strokeWidthPx > 0;
  if (featureType === "node") {
    const radiusPx = getOptionNodeRadius(layer);
    return {
      hasVisiblePaint: (fillVisible || strokeVisible) && radiusPx > 0,
      visualSizePx: Math.max(fillVisible ? radiusPx : 0, strokeVisible ? radiusPx + strokeWidthPx / 2 : 0),
    };
  }
  if (featureType === "way") return {hasVisiblePaint: strokeVisible, visualSizePx: strokeWidthPx};
  // Area 的 fill 不需要宽度也能可见；visualSizePx 只记录边缘描边供诊断使用。
  return {hasVisiblePaint: fillVisible || strokeVisible, visualSizePx: strokeWidthPx};
}

/**
 * SVG 尚未挂载时使用 options 建立首帧状态。CSS 挂载后会以 computed style 覆盖对应 Path，
 * 但 Canvas 与固定 Relation addon 始终只按自身 options 判断，不读取 CSS。
 */
export function getInitialOverlayVisualMeasurement(
  geometry: LeafletSpatialGeometry,
  visualLayers: ReadonlyArray<Path>,
): OverlayVisualMeasurement {
  let hasVisiblePaint = false;
  let visualSizePx = 0;
  for (const layer of visualLayers) {
    const measurement = measureOptionPath(geometry.featureType, layer);
    hasVisiblePaint ||= measurement.hasVisiblePaint;
    visualSizePx = Math.max(visualSizePx, measurement.visualSizePx);
  }
  return {hasVisiblePaint, visualSizePx};
}

/**
 * opacity=0 只隐藏实际像素，不会绕过 Leaflet Canvas 的 containsPoint 检查，因此 interaction
 * Path 必须在外层根据 hasVisiblePaint 决定是否加入 Feature group。这里仅负责构造稳定命中形状。
 */
export function createOverlayInteractionLayer(
  geometry: LeafletSpatialGeometry,
  measurement: OverlayVisualMeasurement,
  renderer: Renderer,
  config: LeafletConfigType["interaction"],
): Path {
  const commonOptions = {renderer, interactive: true, bubblingMouseEvents: false} as const;
  if (geometry.featureType === "node") {
    return circleMarker(geometry.center, {
      ...commonOptions,
      radius: clamp(measurement.visualSizePx + config.node_extra_radius_px, config.min_node_radius_px, config.max_node_radius_px),
      stroke: false,
      fill: true,
      fillColor: "#000000",
      fillOpacity: 0,
    });
  }
  if (geometry.featureType === "way") {
    // 完整 MultiLine geometry 始终使用连续透明粗线，视觉 dash 不在命中路径上制造空洞。
    return polyline(geometry.latLngs, {
      ...commonOptions,
      color: "#000000",
      opacity: 0,
      weight: clamp(measurement.visualSizePx + config.way_extra_width_px, config.min_way_width_px, config.max_way_width_px),
      lineCap: "round",
      lineJoin: "round",
    });
  }
  // Area 可见时整个 even-odd 填充区域都可命中；边缘容错不随视觉描边继续膨胀。
  return polygon(geometry.latLngs, {
    ...commonOptions,
    stroke: true,
    color: "#000000",
    opacity: 0,
    weight: Math.min(config.area_edge_width_px, config.max_area_edge_width_px),
    fill: true,
    fillColor: "#000000",
    fillOpacity: 0,
    fillRule: "evenodd",
  });
}

function isComputedPathContainerVisible(style: CSSStyleDeclaration): boolean {
  const opacity = parseCssNumber(style.opacity, 1);
  return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && opacity > 0;
}

/**
 * 读取 SVG 最终 presentation。fill/stroke 分开判断，确保 fill:none、stroke:none 与各自 opacity=0
 * 都不会被 interaction 的最小尺寸重新托底；Node/Area 任一通道可见即可保留命中层。
 */
function measureComputedPath(
  featureType: CanvasSpatialFeatureType,
  layer: Path,
  style: CSSStyleDeclaration,
): OverlayCssVisualMeasurement {
  if (!isComputedPathContainerVisible(style)) return {hasVisiblePaint: false, visualSizePx: 0, radiusPx: 0, strokeWidthPx: 0};
  const fillVisible = featureType !== "way" && hasVisibleColor(style.fill) && parseCssNumber(style.fillOpacity, 1) > 0;
  const parsedStrokeWidth = parseCssPixels(style.strokeWidth) ?? 0;
  const strokeVisible = hasVisibleColor(style.stroke) && parseCssNumber(style.strokeOpacity, 1) > 0 && parsedStrokeWidth > 0;
  if (featureType === "node") {
    const radiusPx = parseCssPixels(style.getPropertyValue("r")) ?? getOptionNodeRadius(layer);
    return {
      hasVisiblePaint: (fillVisible || strokeVisible) && radiusPx > 0,
      visualSizePx: Math.max(fillVisible ? radiusPx : 0, strokeVisible ? radiusPx + parsedStrokeWidth / 2 : 0),
      radiusPx,
      strokeWidthPx: strokeVisible ? parsedStrokeWidth : 0,
    };
  }
  if (featureType === "way") {
    return {hasVisiblePaint: strokeVisible, visualSizePx: strokeVisible ? parsedStrokeWidth : 0, radiusPx: 0, strokeWidthPx: strokeVisible ? parsedStrokeWidth : 0};
  }
  return {
    hasVisiblePaint: fillVisible || strokeVisible,
    visualSizePx: strokeVisible ? parsedStrokeWidth : 0,
    radiusPx: 0,
    strokeWidthPx: strokeVisible ? parsedStrokeWidth : 0,
  };
}

/**
 * 该 Layer 不创建自己的 DOM，只借用 Leaflet 生命周期监听 zoom/resize。Node controller 会先调整
 * 可见圆半径；本同步器随后在下一 animation frame 读取最终 SVG/Leaflet 几何并回写透明 hit Path。
 */
export class OverlayInteractionMetricsController extends Layer {
  private readonly registrations: Array<OverlayInteractionRegistration> = [];
  private readonly warnedCssLayers = new WeakSet<Path>();
  private readonly cachedCssMeasurements = new WeakMap<Path, OverlayCssVisualMeasurement>();
  private readonly lastVisibility = new WeakMap<Path, boolean>();
  private frameId: number | null = null;

  constructor(private readonly config: Pick<LeafletConfigType, "interaction" | "visual_limits">) {
    super();
  }

  registerFeature(
    featureId: string,
    featureType: CanvasSpatialFeatureType,
    featureLayer: LayerGroup,
    visualLayers: ReadonlyArray<Path>,
    cssLayers: ReadonlyArray<Path>,
    interactionLayer: Path,
    onGeometryVisibilityChange: (visible: boolean) => void,
  ): void {
    this.registrations.push({featureId, featureType, featureLayer, visualLayers, cssLayers: new Set(cssLayers), interactionLayer, onGeometryVisibilityChange});
  }

  override onAdd(map: LeafletMap): this {
    // CSS 可能受 zoom class 或容器尺寸影响，因此两类生命周期结束后都重新测量。
    map.on("zoomend resize", this.scheduleSynchronize, this);
    return this;
  }

  override onRemove(map: LeafletMap): this {
    map.off("zoomend resize", this.scheduleSynchronize, this);
    if (this.frameId !== null) globalThis.cancelAnimationFrame(this.frameId);
    this.frameId = null;
    return this;
  }

  /** 所有 SVG Path 挂载后等待一帧，供首次 ready 流程显式等待命中状态完成同步。 */
  async synchronizeAfterMount(): Promise<void> {
    await new Promise<void>((resolve) => {
      globalThis.requestAnimationFrame(() => resolve());
    });
    if (this._map !== undefined) this.synchronize();
  }

  private readonly scheduleSynchronize = (): void => {
    // zoomend 与 resize 可能在同一帧连续触发，只安排一次全量 read/write。
    if (this.frameId !== null) return;
    this.frameId = globalThis.requestAnimationFrame(() => {
      this.frameId = null;
      this.synchronize();
    });
  };

  private synchronize(): void {
    // 第一阶段只读：浏览器可以在一个 layout 结果上完成全部 getComputedStyle 查询。
    const measured = this.registrations.map((registration) => ({
      registration,
      measurement: this.measureFeature(registration),
    } satisfies MeasuredOverlayInteraction));

    // 第二阶段才增删/修改 hit geometry，避免 getComputedStyle 与 DOM 写入交错造成强制 reflow。
    for (const entry of measured) this.applyMeasurement(entry);
  }

  private measureFeature(registration: OverlayInteractionRegistration): OverlayVisualMeasurement {
    let hasVisiblePaint = false;
    let visualSizePx = 0;
    for (const layer of registration.visualLayers) {
      const measurement = registration.cssLayers.has(layer)
        ? this.measureCssLayer(registration, layer)
        : measureOptionPath(registration.featureType, layer);
      hasVisiblePaint ||= measurement.hasVisiblePaint;
      visualSizePx = Math.max(visualSizePx, measurement.visualSizePx);
    }
    return {hasVisiblePaint, visualSizePx};
  }

  private measureCssLayer(registration: OverlayInteractionRegistration, layer: Path): OverlayCssVisualMeasurement {
    const element = layer.getElement();
    if (element === undefined || element === null) {
      // Node 在低 zoom 会连同 SVG group 暂时卸载；沿用最后一次计算值，避免退回 seed options 后误启用。
      const cached = this.cachedCssMeasurements.get(layer);
      if (cached !== undefined) return cached;
      const fallback = measureOptionPath(registration.featureType, layer);
      return {...fallback, radiusPx: registration.featureType === "node" ? getOptionNodeRadius(layer) : 0, strokeWidthPx: getOptionStrokeWidth(layer)};
    }
    const view = element.ownerDocument.defaultView;
    if (view === null) throw new Error("CSS Overlay layer is not attached to a browser window");
    const measurement = measureComputedPath(registration.featureType, layer, view.getComputedStyle(element));
    this.cachedCssMeasurements.set(layer, measurement);
    this.warnIfCssLimitExceeded(registration, layer, measurement);
    return measurement;
  }

  private warnIfCssLimitExceeded(registration: OverlayInteractionRegistration, layer: Path, measurement: OverlayCssVisualMeasurement): void {
    if (this.warnedCssLayers.has(layer)) return;
    const limits = this.config.visual_limits;
    const exceedsRadius = registration.featureType === "node" && measurement.radiusPx > limits.max_canvas_node_radius_px;
    const exceedsStroke = measurement.strokeWidthPx > limits.max_canvas_stroke_width_px;
    if (!exceedsRadius && !exceedsStroke) return;
    this.warnedCssLayers.add(layer);
    // CSS 是用户可扩展的 presentation 层，超限不阻断地图；interaction 自身仍按硬上限钳制。
    console.warn("css_overlay_visual_limit_exceeded", {
      feature_type: registration.featureType,
      feature_id: registration.featureId,
      radius_px: measurement.radiusPx,
      stroke_width_px: measurement.strokeWidthPx,
      max_node_radius_px: limits.max_canvas_node_radius_px,
      max_stroke_width_px: limits.max_canvas_stroke_width_px,
    });
  }

  private applyMeasurement({registration, measurement}: MeasuredOverlayInteraction): void {
    const wasVisible = this.lastVisibility.get(registration.interactionLayer);
    if (!measurement.hasVisiblePaint) {
      // 不能只把尺寸设为 0：Leaflet click tolerance 与配置最小值仍可能让零尺寸 Path 被命中。
      if (registration.featureLayer.hasLayer(registration.interactionLayer)) registration.featureLayer.removeLayer(registration.interactionLayer);
      if (wasVisible !== false) registration.onGeometryVisibilityChange(false);
      this.lastVisibility.set(registration.interactionLayer, false);
      return;
    }

    if (!registration.featureLayer.hasLayer(registration.interactionLayer)) registration.featureLayer.addLayer(registration.interactionLayer);
    if (wasVisible !== true) registration.onGeometryVisibilityChange(true);
    this.lastVisibility.set(registration.interactionLayer, true);

    const interaction = this.config.interaction;
    if (registration.featureType === "node") {
      if (!(registration.interactionLayer instanceof CircleMarker)) throw new Error("Node interaction layer must be a CircleMarker");
      registration.interactionLayer.setRadius(clamp(
        measurement.visualSizePx + interaction.node_extra_radius_px,
        interaction.min_node_radius_px,
        interaction.max_node_radius_px,
      ));
    } else if (registration.featureType === "way") {
      registration.interactionLayer.setStyle({weight: clamp(
        measurement.visualSizePx + interaction.way_extra_width_px,
        interaction.min_way_width_px,
        interaction.max_way_width_px,
      )});
    }
    // Area 命中 geometry 不依赖视觉描边宽度；只有上面的显隐状态需要同步。
  }
}
