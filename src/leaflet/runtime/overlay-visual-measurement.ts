/**
 * Overlay Visual 的唯一视觉测量状态源。
 *
 * Canvas 与固定 Relation Path 直接读取 Leaflet options；CSS/SVG Path 挂载后批量读取
 * computed style。控制器严格执行“先全部读、再统一更新状态并通知”的两阶段同步，避免
 * getComputedStyle 与命中层/Label 的 DOM 写入交错。Snapshot 与 Interactive 共用本模块。
 */

import {CircleMarker, Layer, type Map as LeafletMap, type Path} from "leaflet";
import type {LeafletConfigType} from "../../models/config-models.js";
import type {
  OverlayCssPresentationMeasurement,
  OverlayVisualMeasurement,
  OverlayVisualMeasurementListener,
  OverlayVisualMeasurementSource,
} from "../../models/leaflet-renderer-models.js";
import type {CanvasSpatialFeatureType} from "../../models/style/base-canvas-style.js";

interface OverlayVisualMeasurementRegistration {
  featureId: string;
  featureType: CanvasSpatialFeatureType;
  visualLayers: ReadonlyArray<Path>;
  cssLayers: ReadonlySet<Path>;
}

interface MeasuredOverlayFeature {
  registration: OverlayVisualMeasurementRegistration;
  measurement: OverlayVisualMeasurement;
}

function getFeatureKey(featureType: CanvasSpatialFeatureType, featureId: string): string {
  // canonical feature_id 只在同一 feature_type 内唯一，内部状态键必须保留类型命名空间。
  return `${featureType}\u0000${featureId}`;
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

function getOptionPresentation(featureType: CanvasSpatialFeatureType, layer: Path): OverlayCssPresentationMeasurement {
  const strokeWidthPx = getOptionStrokeWidth(layer);
  return {fillVisible: hasOptionFill(featureType, layer), strokeVisible: strokeWidthPx > 0, strokeWidthPx};
}

/**
 * presentation 只描述哪些绘制通道可见；Node extent 每次都结合当前 getRadius() 计算，确保
 * NodeZoomController 是唯一 geometry 半径来源，固定屏幕宽度的 stroke 也不会被重复缩放。
 */
function measurePresentedPath(featureType: CanvasSpatialFeatureType, layer: Path, presentation: OverlayCssPresentationMeasurement): OverlayVisualMeasurement {
  const {fillVisible, strokeVisible, strokeWidthPx} = presentation;
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

/** 从 Canvas/Leaflet options 得到当前 Path 对 Feature 可见像素的贡献。 */
function measureOptionPath(featureType: CanvasSpatialFeatureType, layer: Path): OverlayVisualMeasurement {
  return measurePresentedPath(featureType, layer, getOptionPresentation(featureType, layer));
}

function isComputedPathContainerVisible(style: CSSStyleDeclaration): boolean {
  const opacity = parseCssNumber(style.opacity, 1);
  return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && opacity > 0;
}

/**
 * 只读取 SVG 最终 presentation，不读取 CSS `r`。fill/stroke 分开判断，确保 fill:none、
 * stroke:none 与各自 opacity=0 都不会被透明命中层的最小尺寸重新托底。
 */
function measureComputedPresentation(
  featureType: CanvasSpatialFeatureType,
  style: CSSStyleDeclaration,
): OverlayCssPresentationMeasurement {
  if (!isComputedPathContainerVisible(style)) return {fillVisible: false, strokeVisible: false, strokeWidthPx: 0};
  const fillVisible = featureType !== "way" && hasVisibleColor(style.fill) && parseCssNumber(style.fillOpacity, 1) > 0;
  const parsedStrokeWidth = parseCssPixels(style.strokeWidth) ?? 0;
  const strokeVisible = hasVisibleColor(style.stroke) && parseCssNumber(style.strokeOpacity, 1) > 0 && parsedStrokeWidth > 0;
  return {fillVisible, strokeVisible, strokeWidthPx: strokeVisible ? parsedStrokeWidth : 0};
}

/**
 * 该 Layer 不创建 DOM，只借用 Leaflet 的 zoom/resize 生命周期。Node controller 会先更新
 * CircleMarker 半径；本控制器下一帧读取最终几何，并把同一测量通知给 Label 与 Interaction。
 */
export class OverlayVisualMeasurementController extends Layer implements OverlayVisualMeasurementSource {
  private readonly registrations: Array<OverlayVisualMeasurementRegistration> = [];
  private readonly registrationKeys = new Set<string>();
  private readonly measurements = new Map<string, OverlayVisualMeasurement>();
  private readonly listeners = new Map<string, Set<OverlayVisualMeasurementListener>>();
  private readonly batchCompleteListeners = new Set<() => void>();
  private readonly warnedCssLayers = new WeakSet<Path>();
  private readonly cachedCssPresentations = new WeakMap<Path, OverlayCssPresentationMeasurement>();
  private frameId: number | null = null;
  private disposed = false;

  constructor(private readonly config: Pick<LeafletConfigType, "visual_limits">) {
    super();
  }

  registerFeature(
    featureId: string,
    featureType: CanvasSpatialFeatureType,
    visualLayers: ReadonlyArray<Path>,
    cssLayers: ReadonlyArray<Path>,
  ): void {
    if (this.disposed) throw new Error("Overlay visual measurement controller has been disposed");
    const key = getFeatureKey(featureType, featureId);
    if (this.registrationKeys.has(key)) throw new Error(`Duplicate ${featureType} feature_id "${featureId}" in Overlay visual measurement`);
    this.registrationKeys.add(key);
    this.registrations.push({featureId, featureType, visualLayers, cssLayers: new Set(cssLayers)});
  }

  getMeasurement(featureType: CanvasSpatialFeatureType, featureId: string): OverlayVisualMeasurement {
    const measurement = this.measurements.get(getFeatureKey(featureType, featureId));
    if (measurement === undefined) throw new Error(`Visual measurement for ${featureType} feature_id "${featureId}" is not ready`);
    return measurement;
  }

  subscribe(featureType: CanvasSpatialFeatureType, featureId: string, listener: OverlayVisualMeasurementListener): () => void {
    if (this.disposed) throw new Error("Overlay visual measurement controller has been disposed");
    const key = getFeatureKey(featureType, featureId);
    if (!this.registrationKeys.has(key)) throw new Error(`Cannot subscribe to unregistered ${featureType} feature_id "${featureId}"`);
    const featureListeners = this.listeners.get(key);
    if (featureListeners === undefined) this.listeners.set(key, new Set([listener]));
    else featureListeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      const current = this.listeners.get(key);
      current?.delete(listener);
      if (current?.size === 0) this.listeners.delete(key);
    };
  }

  subscribeBatchComplete(listener: () => void): () => void {
    if (this.disposed) throw new Error("Overlay visual measurement controller has been disposed");
    this.batchCompleteListeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.batchCompleteListeners.delete(listener);
    };
  }

  override onAdd(map: LeafletMap): this {
    map.on("zoomend resize", this.scheduleSynchronize, this);
    return this;
  }

  override onRemove(map: LeafletMap): this {
    map.off("zoomend resize", this.scheduleSynchronize, this);
    if (this.frameId !== null) globalThis.cancelAnimationFrame(this.frameId);
    this.frameId = null;
    return this;
  }

  /** Visual layers 全部挂载后等待一帧，并在返回前建立每个 Feature 的第一份可靠测量。 */
  async synchronizeAfterMount(): Promise<void> {
    if (this.disposed) throw new Error("Overlay visual measurement controller has been disposed");
    await new Promise<void>((resolve) => {
      globalThis.requestAnimationFrame(() => resolve());
    });
    if (this.disposed) throw new Error("Overlay visual measurement controller was disposed before initial synchronization");
    if (this._map === undefined) throw new Error("Overlay visual measurement controller must be mounted before synchronization");
    this.synchronize();
  }

  /** 幂等终止生命周期；Visual result.dispose() 会调用它，再移除整个视觉 rootLayer。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this._map !== undefined) this.remove();
    if (this.frameId !== null) globalThis.cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.listeners.clear();
    this.batchCompleteListeners.clear();
    this.measurements.clear();
    this.registrationKeys.clear();
    this.registrations.length = 0;
  }

  private readonly scheduleSynchronize = (): void => {
    // zoomend 与 resize 可能在同一帧连续触发，只安排一次全量 read/write。
    if (this.frameId !== null || this.disposed) return;
    this.frameId = globalThis.requestAnimationFrame(() => {
      this.frameId = null;
      if (!this.disposed) this.synchronize();
    });
  };

  private synchronize(): void {
    // 第一阶段只读：浏览器可以在一个 layout 结果上完成全部 getComputedStyle 查询。
    const measured = this.registrations.map((registration) => ({
      registration,
      measurement: this.measureFeature(registration),
    } satisfies MeasuredOverlayFeature));

    // 第二阶段只更新控制器状态并通知订阅者；订阅者可以安全修改 Label 或透明 hit Path。
    for (const entry of measured) this.publishMeasurement(entry);
    for (const listener of this.batchCompleteListeners) listener();
  }

  private measureFeature(registration: OverlayVisualMeasurementRegistration): OverlayVisualMeasurement {
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

  private measureCssLayer(registration: OverlayVisualMeasurementRegistration, layer: Path): OverlayVisualMeasurement {
    const element = layer.getElement();
    let presentation: OverlayCssPresentationMeasurement;
    if (element === undefined || element === null) {
      // 低 zoom 会卸载 Node group。仅缓存 presentation，随后仍结合当前 getRadius() 重新测量，
      // 不能复用上一个 zoom 的 visualSizePx，否则会留下孤立标签或透明命中圆。
      presentation = this.cachedCssPresentations.get(layer) ?? getOptionPresentation(registration.featureType, layer);
    } else {
      const view = element.ownerDocument.defaultView;
      if (view === null) throw new Error("CSS Overlay layer is not attached to a browser window");
      presentation = measureComputedPresentation(registration.featureType, view.getComputedStyle(element));
      this.cachedCssPresentations.set(layer, presentation);
      this.warnIfCssLimitExceeded(registration, layer, presentation);
    }
    return measurePresentedPath(registration.featureType, layer, presentation);
  }

  private warnIfCssLimitExceeded(registration: OverlayVisualMeasurementRegistration, layer: Path, presentation: OverlayCssPresentationMeasurement): void {
    if (this.warnedCssLayers.has(layer)) return;
    const limits = this.config.visual_limits;
    if (presentation.strokeWidthPx <= limits.max_canvas_stroke_width_px) return;
    this.warnedCssLayers.add(layer);
    // CSS 已不能设置 radius；允许超宽 presentation stroke，但 Interactive 命中宽度仍按自身上限钳制。
    console.warn("css_overlay_visual_limit_exceeded", {
      feature_type: registration.featureType,
      feature_id: registration.featureId,
      stroke_width_px: presentation.strokeWidthPx,
      max_stroke_width_px: limits.max_canvas_stroke_width_px,
    });
  }

  private publishMeasurement({registration, measurement}: MeasuredOverlayFeature): void {
    const key = getFeatureKey(registration.featureType, registration.featureId);
    const previous = this.measurements.get(key);
    if (previous !== undefined
      && previous.hasVisiblePaint === measurement.hasVisiblePaint
      && previous.visualSizePx === measurement.visualSizePx) return;
    const frozenMeasurement = Object.freeze({...measurement});
    this.measurements.set(key, frozenMeasurement);
    for (const listener of this.listeners.get(key) ?? []) listener(frozenMeasurement);
  }
}
