/**
 * Overlay display_id/name 的单 Canvas 标签层。
 *
 * Renderer 在原有 Feature 遍历中只登记候选；本层在挂载及 move/zoom/resize 结束后统一完成
 * 屏幕投影、锚点选择、碰撞和文字绘制。标签不创建逐 Feature DOM，也不参与 pointer hit testing。
 */

import {DomUtil, Layer, point, type LatLngTuple, type Map as LeafletMap, type Point} from "leaflet";
import type {LeafletConfigType} from "../models/config-models.js";
import type {LeafletSpatialGeometry, OverlayLabelCandidate} from "../models/leaflet-renderer-models.js";
import type {CanvasSpatialFeatureType} from "../models/style/base-canvas-style.js";
import {LEAFLET_INTERNAL_RENDER_CONFIG} from "../utils/leaflet-internal-render-config.js";
import {getNodeZoomScale} from "./node-zoom-controller.js";

const LABEL_CONFIG = LEAFLET_INTERNAL_RENDER_CONFIG.label;
// 字体尺寸仍是屏幕逻辑像素；Canvas bitmap 再按实际 DPR 扩大，二者不能混为同一个单位。
const LABEL_FONT = `${LABEL_CONFIG.nameFontWeight} ${LABEL_CONFIG.fontSizePx}px ${LABEL_CONFIG.fontFamily}`;
const LABEL_ID_FONT = `${LABEL_CONFIG.idFontWeight} ${LABEL_CONFIG.fontSizePx}px ${LABEL_CONFIG.fontFamily}`;

function getFeatureVisibilityKey(featureType: CanvasSpatialFeatureType, featureId: string): string {
  // canonical feature_id 只保证类型内唯一，因此 key 必须同时包含 feature_type。
  return `${featureType}\u0000${featureId}`;
}

interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface WayLabelAnchor {
  center: Point;
  angle: number;
  lineLength: number;
}

/** 屏幕网格只保存已经接受的标签框，避免高密度 Feature 做全量两两碰撞。 */
class LabelCollisionIndex {
  private readonly cells = new Map<string, Array<ScreenRect>>();

  collides(rect: ScreenRect): boolean {
    for (const key of this.getCellKeys(rect)) {
      for (const existing of this.cells.get(key) ?? []) {
        if (rect.left < existing.right && rect.right > existing.left && rect.top < existing.bottom && rect.bottom > existing.top) return true;
      }
    }
    return false;
  }

  insert(rect: ScreenRect): void {
    for (const key of this.getCellKeys(rect)) {
      const entries = this.cells.get(key);
      if (entries === undefined) this.cells.set(key, [rect]);
      else entries.push(rect);
    }
  }

  private getCellKeys(rect: ScreenRect): Array<string> {
    const keys: Array<string> = [];
    const minX = Math.floor(rect.left / LABEL_CONFIG.collisionCellSizePx);
    const maxX = Math.floor(rect.right / LABEL_CONFIG.collisionCellSizePx);
    const minY = Math.floor(rect.top / LABEL_CONFIG.collisionCellSizePx);
    const maxY = Math.floor(rect.bottom / LABEL_CONFIG.collisionCellSizePx);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) keys.push(`${x}:${y}`);
    }
    return keys;
  }
}

function isLatLngTuple(value: unknown): value is LatLngTuple {
  return Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number";
}

/** Leaflet 用数组嵌套层数区分 LineString/MultiLineString，这里统一成 lines 方便后续遍历。 */
function getWayLines(geometry: Extract<LeafletSpatialGeometry, {featureType: "way"}>): ReadonlyArray<ReadonlyArray<LatLngTuple>> {
  const first = geometry.latLngs[0];
  if (first === undefined) return [];
  return isLatLngTuple(first)
    ? [geometry.latLngs as Array<LatLngTuple>]
    : geometry.latLngs as Array<Array<LatLngTuple>>;
}

/** 同理把 Polygon/MultiPolygon 统一成 polygons，但完整保留每个 Polygon 的 outer ring 与 holes。 */
function getAreaPolygons(geometry: Extract<LeafletSpatialGeometry, {featureType: "area"}>): ReadonlyArray<ReadonlyArray<ReadonlyArray<LatLngTuple>>> {
  const first = geometry.latLngs[0];
  if (first === undefined) return [];
  return isLatLngTuple(first[0])
    ? [geometry.latLngs as Array<Array<LatLngTuple>>]
    : geometry.latLngs as Array<Array<Array<LatLngTuple>>>;
}

function getPolylineLength(points: ReadonlyArray<Point>): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += points[index - 1].distanceTo(points[index]);
  return length;
}

/** Way 仅放一个标签：选择当前屏幕下最长的独立 line，并取其累计长度中点与切线方向。 */
function getWayLabelAnchor(map: LeafletMap, geometry: Extract<LeafletSpatialGeometry, {featureType: "way"}>): WayLabelAnchor | null {
  let selectedPoints: Array<Point> | null = null;
  let selectedLength = 0;
  for (const line of getWayLines(geometry)) {
    const points = line.map((latLng) => map.latLngToContainerPoint(latLng));
    const lineLength = getPolylineLength(points);
    if (lineLength > selectedLength) {
      selectedPoints = points;
      selectedLength = lineLength;
    }
  }
  if (selectedPoints === null || selectedPoints.length < 2 || selectedLength === 0) return null;

  const target = selectedLength / 2;
  let walked = 0;
  for (let index = 1; index < selectedPoints.length; index += 1) {
    const start = selectedPoints[index - 1];
    const end = selectedPoints[index];
    const segmentLength = start.distanceTo(end);
    if (walked + segmentLength < target || segmentLength === 0) {
      walked += segmentLength;
      continue;
    }
    const ratio = (target - walked) / segmentLength;
    const center = point(start.x + (end.x - start.x) * ratio, start.y + (end.y - start.y) * ratio);
    let angle = Math.atan2(end.y - start.y, end.x - start.x);
    // 文字始终保持从左到右，Way geometry 方向不会导致标签倒置。
    if (angle > Math.PI / 2) angle -= Math.PI;
    else if (angle < -Math.PI / 2) angle += Math.PI;
    return {center, angle, lineLength: selectedLength};
  }
  return null;
}

function getSignedArea(points: ReadonlyArray<Point>): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

/** 使用屏幕坐标的面积质心；退化 ring 返回 null，由后续 bounds/scanline 路径接管。 */
function getRingCentroid(points: ReadonlyArray<Point>): Point | null {
  let crossSum = 0;
  let xSum = 0;
  let ySum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current.x * next.y - next.x * current.y;
    crossSum += cross;
    xSum += (current.x + next.x) * cross;
    ySum += (current.y + next.y) * cross;
  }
  if (Math.abs(crossSum) < Number.EPSILON) return null;
  return point(xSum / (3 * crossSum), ySum / (3 * crossSum));
}

function isPointInRing(target: Point, ring: ReadonlyArray<Point>): boolean {
  let inside = false;
  for (let currentIndex = 0, previousIndex = ring.length - 1; currentIndex < ring.length; previousIndex = currentIndex, currentIndex += 1) {
    const current = ring[currentIndex];
    const previous = ring[previousIndex];
    if ((current.y > target.y) !== (previous.y > target.y)
      && target.x < (previous.x - current.x) * (target.y - current.y) / (previous.y - current.y) + current.x) inside = !inside;
  }
  return inside;
}

function isPointInArea(target: Point, rings: ReadonlyArray<ReadonlyArray<Point>>): boolean {
  // 对全部 rings 做 even-odd 翻转，使 holes 与 Canvas fillRule 的可见区域保持一致。
  let inside = false;
  for (const ring of rings) {
    if (isPointInRing(target, ring)) inside = !inside;
  }
  return inside;
}

function getRingBoundsCenter(ring: ReadonlyArray<Point>): {center: Point; minY: number; maxY: number} {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const pointValue of ring) {
    minX = Math.min(minX, pointValue.x);
    maxX = Math.max(maxX, pointValue.x);
    minY = Math.min(minY, pointValue.y);
    maxY = Math.max(maxY, pointValue.y);
  }
  return {center: point((minX + maxX) / 2, (minY + maxY) / 2), minY, maxY};
}

/**
 * 凹 Polygon 的质心可能落在外部或 hole 中；回退时在数条水平扫描线上选择最长的
 * even-odd 内部区间，保证标签仍位于实际填充区域，而不是 MultiPolygon 之间的空白。
 */
function getScanlineInteriorPoint(rings: ReadonlyArray<ReadonlyArray<Point>>, minY: number, maxY: number): Point | null {
  let bestPoint: Point | null = null;
  let bestWidth = 0;
  for (const ratio of LABEL_CONFIG.areaScanlineRatios) {
    const y = minY + (maxY - minY) * ratio;
    const intersections: Array<number> = [];
    for (const ring of rings) {
      for (let index = 0; index < ring.length; index += 1) {
        const current = ring[index];
        const next = ring[(index + 1) % ring.length];
        if ((current.y > y) === (next.y > y)) continue;
        intersections.push(current.x + (next.x - current.x) * (y - current.y) / (next.y - current.y));
      }
    }
    intersections.sort((left, right) => left - right);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const width = intersections[index + 1] - intersections[index];
      if (width > bestWidth) {
        bestWidth = width;
        bestPoint = point((intersections[index] + intersections[index + 1]) / 2, y);
      }
    }
  }
  return bestPoint;
}

/** Area 选择屏幕投影面积最大的 Polygon，避免 MultiPolygon 标签落在相隔主体之间。 */
function getAreaLabelAnchor(map: LeafletMap, geometry: Extract<LeafletSpatialGeometry, {featureType: "area"}>): Point | null {
  let selectedRings: Array<Array<Point>> | null = null;
  let selectedArea = 0;
  for (const polygonValue of getAreaPolygons(geometry)) {
    const rings = polygonValue.map((ring) => ring.map((latLng) => map.latLngToContainerPoint(latLng))).filter((ring) => ring.length >= 3);
    const outerRing = rings[0];
    if (outerRing === undefined) continue;
    const area = Math.abs(getSignedArea(outerRing));
    if (area > selectedArea) {
      selectedArea = area;
      selectedRings = rings;
    }
  }
  if (selectedRings === null) return null;
  const outerRing = selectedRings[0];
  const centroid = getRingCentroid(outerRing);
  if (centroid !== null && isPointInArea(centroid, selectedRings)) return centroid;
  const bounds = getRingBoundsCenter(outerRing);
  if (isPointInArea(bounds.center, selectedRings)) return bounds.center;
  return getScanlineInteriorPoint(selectedRings, bounds.minY, bounds.maxY);
}

function getLabelLines(candidate: OverlayLabelCandidate): ReadonlyArray<string> {
  // Node/Area 固定 display_id 在上、name 在下；没有 name 时不保留空白第二行。
  return candidate.nameText === undefined ? [candidate.displayId] : [candidate.displayId, candidate.nameText];
}

function getBlockSize(context: CanvasRenderingContext2D, lines: ReadonlyArray<string>): {width: number; height: number} {
  let width = 0;
  for (let index = 0; index < lines.length; index += 1) {
    context.font = index === 0 ? LABEL_ID_FONT : LABEL_FONT;
    width = Math.max(width, context.measureText(lines[index]).width);
  }
  return {width: width + LABEL_CONFIG.paddingPx * 2, height: lines.length * LABEL_CONFIG.lineHeightPx + LABEL_CONFIG.paddingPx * 2};
}

function getCenteredRect(center: Point, width: number, height: number): ScreenRect {
  return {left: center.x - width / 2, top: center.y - height / 2, right: center.x + width / 2, bottom: center.y + height / 2};
}

function isVisibleRect(rect: ScreenRect, width: number, height: number): boolean {
  return rect.right >= 0 && rect.bottom >= 0 && rect.left <= width && rect.top <= height;
}

function drawText(context: CanvasRenderingContext2D, text: string, x: number, y: number, font: string): void {
  context.font = font;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  // 先画浅色 halo 再画深色正文，避免文字在道路、Area fill 或未来 basemap 上失去对比度。
  context.strokeStyle = LABEL_CONFIG.haloColor;
  context.lineWidth = LABEL_CONFIG.haloWidthPx;
  context.strokeText(text, x, y);
  context.fillStyle = LABEL_CONFIG.textColor;
  context.fillText(text, x, y);
}

function drawBlockLabel(context: CanvasRenderingContext2D, candidate: OverlayLabelCandidate, center: Point): void {
  const lines = getLabelLines(candidate);
  const firstY = center.y - (lines.length - 1) * LABEL_CONFIG.lineHeightPx / 2;
  for (let index = 0; index < lines.length; index += 1) {
    drawText(context, lines[index], center.x, firstY + index * LABEL_CONFIG.lineHeightPx, index === 0 ? LABEL_ID_FONT : LABEL_FONT);
  }
}

/**
 * 一个 Canvas 承载全部标签；Feature 注册只保存轻量候选，zoom/move 后重新计算屏幕锚点和碰撞，
 * 不重新执行 tag rule、样式合并或 geometry 的连续世界转换。
 */
export class OverlayLabelLayer extends Layer {
  private readonly candidates: Record<CanvasSpatialFeatureType, Array<OverlayLabelCandidate>> = {node: [], way: [], area: []};
  private readonly hiddenGeometryFeatures = new Set<string>();
  private canvas: HTMLCanvasElement | null = null;
  private frameId: number | null = null;
  private fontReady = false;

  constructor(private readonly nodeZoomConfig: LeafletConfigType["node_zoom"]) {
    super();
  }

  /**
   * `document.fonts.load()` 会同时触发打包 WOFF2 的实际下载/解码。Renderer 在挂载本层前等待它，
   * 这样第一次 measureText、碰撞框和最终截图都不会先使用 fallback 字体再发生二次位移。
   */
  async prepareFont(targetDocument: Document = document): Promise<void> {
    const fontLoads = [LABEL_FONT, LABEL_ID_FONT].map((font) => targetDocument.fonts.load(font, LABEL_CONFIG.fontLoadSample));
    const loadedFaces = await Promise.all(fontLoads);
    if (loadedFaces.some((faces) => faces.length === 0)) throw new Error(`Leaflet label font "${LABEL_CONFIG.fontFaceFamily}" could not be loaded`);
    this.fontReady = true;
  }

  addCandidate(candidate: OverlayLabelCandidate): void {
    // 分类型保存同时固定碰撞优先级，不需要每次 redraw 重新排序整张候选表。
    this.candidates[candidate.geometry.featureType].push(candidate);
  }

  /**
   * interaction 同步器在 computed style 确定后回写几何可见性。完全没有 fill/stroke/Relation
   * 可见像素的 Feature 不应留下孤立文字；状态可以先于 Canvas 挂载写入，首帧直接使用最终结果。
   */
  setFeatureGeometryVisible(featureType: CanvasSpatialFeatureType, featureId: string, visible: boolean): void {
    const key = getFeatureVisibilityKey(featureType, featureId);
    const changed = visible ? this.hiddenGeometryFeatures.delete(key) : !this.hiddenGeometryFeatures.has(key);
    if (!visible) this.hiddenGeometryFeatures.add(key);
    if (changed && this.canvas !== null) this.scheduleRedraw();
  }

  override onAdd(map: LeafletMap): this {
    if (!this.fontReady) throw new Error("Overlay label font must be prepared before the label layer is mounted");
    const pane = map.getPane("labels");
    if (pane === undefined) throw new Error('Leaflet pane "labels" was not created');
    const canvas = DomUtil.create("canvas", "geomcp-overlay-label-canvas") as HTMLCanvasElement;
    canvas.style.position = "absolute";
    canvas.style.pointerEvents = "none";
    canvas.setAttribute("aria-hidden", "true");
    pane.appendChild(canvas);
    this.canvas = canvas;
    // 只监听结束事件；手势过程中 canvas 随 Leaflet pane 变换，结束后才重新布局文字。
    map.on("moveend zoomend resize", this.scheduleRedraw, this);
    this.redraw();
    return this;
  }

  override onRemove(map: LeafletMap): this {
    // rootLayer 卸载时同时解除事件和未执行的 animation frame，避免旧地图闭包滞留。
    map.off("moveend zoomend resize", this.scheduleRedraw, this);
    if (this.frameId !== null) globalThis.cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.canvas?.remove();
    this.canvas = null;
    return this;
  }

  private readonly scheduleRedraw = (): void => {
    // resize/zoomend/moveend 可能在同一帧连续到达，只合并成一次布局。
    if (this.frameId !== null) return;
    this.frameId = globalThis.requestAnimationFrame(() => {
      this.frameId = null;
      this.redraw();
    });
  };

  private redraw(): void {
    const canvas = this.canvas;
    if (canvas === null) return;
    const map = this._map;
    const size = map.getSize();
    // 使用浏览器实际 DPR；snapshot worker 负责在浏览器边界约束合法值，Renderer 不再静默钳制。
    const pixelRatio = globalThis.devicePixelRatio;
    if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) throw new Error(`Invalid browser devicePixelRatio: ${String(pixelRatio)}`);
    canvas.width = Math.max(1, Math.round(size.x * pixelRatio));
    canvas.height = Math.max(1, Math.round(size.y * pixelRatio));
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;
    DomUtil.setPosition(canvas, map.containerPointToLayerPoint(point(0, 0)));

    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Overlay label canvas does not provide a 2D context");
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const collisions = new LabelCollisionIndex();

    // 碰撞优先级集中在内部配置；改变视觉策略时不需要在绘制流程里寻找三段独立循环。
    for (const featureType of LABEL_CONFIG.featurePriority) {
      for (const candidate of this.candidates[featureType]) {
        if (this.hiddenGeometryFeatures.has(getFeatureVisibilityKey(featureType, candidate.featureId))) continue;
        if (featureType === "node") this.drawNodeLabel(context, collisions, candidate, size.x, size.y, map);
        else if (featureType === "way") this.drawWayLabel(context, collisions, candidate, size.x, size.y, map);
        else this.drawAreaLabel(context, collisions, candidate, size.x, size.y, map);
      }
    }
  }

  private drawNodeLabel(context: CanvasRenderingContext2D, collisions: LabelCollisionIndex, candidate: OverlayLabelCandidate, viewportWidth: number, viewportHeight: number, map: LeafletMap): void {
    if (candidate.geometry.featureType !== "node") return;
    const scale = getNodeZoomScale(map.getZoom(), this.nodeZoomConfig);
    if (scale === 0) return;
    const anchor = map.latLngToContainerPoint(candidate.geometry.center);
    const lines = getLabelLines(candidate);
    const block = getBlockSize(context, lines);
    // 两行文字整体置于实际缩放后外圈上方，name 行比 display_id 更靠近 Node。
    const center = point(
      anchor.x,
      anchor.y - (candidate.nodeBaseRadius ?? LABEL_CONFIG.nodeFallbackRadiusPx) * scale - LABEL_CONFIG.nodeGapPx - block.height / 2,
    );
    const rect = getCenteredRect(center, block.width, block.height);
    if (!isVisibleRect(rect, viewportWidth, viewportHeight) || collisions.collides(rect)) return;
    collisions.insert(rect);
    drawBlockLabel(context, candidate, center);
  }

  private drawWayLabel(context: CanvasRenderingContext2D, collisions: LabelCollisionIndex, candidate: OverlayLabelCandidate, viewportWidth: number, viewportHeight: number, map: LeafletMap): void {
    if (candidate.geometry.featureType !== "way") return;
    const anchor = getWayLabelAnchor(map, candidate.geometry);
    if (anchor === null) return;
    const text = candidate.nameText === undefined ? candidate.displayId : `${candidate.displayId}   ${candidate.nameText}`;
    context.font = LABEL_ID_FONT;
    const textWidth = context.measureText(text).width;
    // 线在当前 zoom 下放不下完整文字时直接省略，避免标签明显越过 Feature 两端。
    if (anchor.lineLength < textWidth + LABEL_CONFIG.paddingPx * 4) return;
    const width = textWidth + LABEL_CONFIG.paddingPx * 2;
    const height = LABEL_CONFIG.lineHeightPx + LABEL_CONFIG.paddingPx * 2;
    // 碰撞索引使用旋转矩形的轴对齐包围盒，计算便宜且不会漏掉斜向 Way 标签重叠。
    const rotatedWidth = Math.abs(Math.cos(anchor.angle)) * width + Math.abs(Math.sin(anchor.angle)) * height;
    const rotatedHeight = Math.abs(Math.sin(anchor.angle)) * width + Math.abs(Math.cos(anchor.angle)) * height;
    const rect = getCenteredRect(anchor.center, rotatedWidth, rotatedHeight);
    if (!isVisibleRect(rect, viewportWidth, viewportHeight) || collisions.collides(rect)) return;
    collisions.insert(rect);
    context.save();
    context.translate(anchor.center.x, anchor.center.y);
    context.rotate(anchor.angle);
    drawText(context, text, 0, 0, LABEL_ID_FONT);
    context.restore();
  }

  private drawAreaLabel(context: CanvasRenderingContext2D, collisions: LabelCollisionIndex, candidate: OverlayLabelCandidate, viewportWidth: number, viewportHeight: number, map: LeafletMap): void {
    if (candidate.geometry.featureType !== "area") return;
    const center = getAreaLabelAnchor(map, candidate.geometry);
    if (center === null) return;
    const block = getBlockSize(context, getLabelLines(candidate));
    const rect = getCenteredRect(center, block.width, block.height);
    if (!isVisibleRect(rect, viewportWidth, viewportHeight) || collisions.collides(rect)) return;
    collisions.insert(rect);
    drawBlockLabel(context, candidate, center);
  }
}
