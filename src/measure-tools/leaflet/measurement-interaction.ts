import {
  canvas,
  circle,
  circleMarker,
  divIcon,
  latLng,
  layerGroup,
  marker,
  point,
  polygon,
  polyline,
  svg,
  type Circle,
  type LatLng,
  type LatLngBounds,
  type Layer,
  type LayerGroup,
  type Map as LeafletMap,
  type Marker,
  type Path,
  type Polyline,
  type Renderer,
} from "leaflet";
import {MEASURE_TOOL_BUILT_IN_CONFIG} from "../../built-in-config/measure-tool.js";
import {InnerBandCanvas} from "../../leaflet/runtime/inner-band-canvas.js";
import type {MeasureCoordinateType} from "../../models/measure-tools/measure-tool-models.js";
import type {
  CompletedMeasurementLayers,
  MeasurementCircleVisualLayers,
  MeasurementDraftPathLayers,
  MeasurementGeometryType,
  MeasurementLayerRuntime,
  MeasurementVertexLayers,
} from "../../models/measure-tools/measure-tool-runtime-models.js";
import {AppError} from "../../utils/app-error.js";

type BoundedMeasurementPath = Path & {getBounds(): LatLngBounds};

function ensurePane(map: LeafletMap, name: string, zIndex: number, pointerEvents: "none" | "auto"): void {
  const pane = map.getPane(name) ?? map.createPane(name);
  pane.style.zIndex = String(zIndex);
  pane.style.pointerEvents = pointerEvents;
}

function readRequiredCssColor(map: LeafletMap, property: string): string {
  const value = getComputedStyle(map.getContainer()).getPropertyValue(property).trim();
  if (value.length === 0) throw new AppError("measurement_style_failed", `Measure Tool requires CSS color ${property}`);
  return value;
}

function readRequiredCssNumber(map: LeafletMap, property: string): number {
  const rawValue = getComputedStyle(map.getContainer()).getPropertyValue(property).trim();
  if (rawValue.length === 0) throw new AppError("measurement_style_failed", `Measure Tool requires CSS number ${property}`);
  const value = Number(rawValue);
  if (!Number.isFinite(value)) throw new AppError("measurement_style_failed", `Measure Tool requires CSS number ${property}`);
  return value;
}

function toLatLngTuple(coordinate: MeasureCoordinateType): [number, number] {
  return [coordinate.latitude, coordinate.longitude];
}

function formatLinearMeasurement(value: number): string {
  return `${value.toFixed(2)} m`;
}

/** 找到当前屏幕投影下的累计长度中点，使标签始终压在可见虚线上。 */
function pathMidpoint(map: LeafletMap, coordinates: readonly MeasureCoordinateType[], closed: boolean): LatLng {
  if (coordinates.length === 0) throw new AppError("measurement_geometry_failed", "Measurement label requires at least one coordinate");
  const pathCoordinates = closed && coordinates.length > 1 ? [...coordinates, coordinates[0]] : [...coordinates];
  if (pathCoordinates.length === 1) return latLng(toLatLngTuple(pathCoordinates[0]));
  const layerPoints = pathCoordinates.map((coordinate) => map.latLngToLayerPoint(toLatLngTuple(coordinate)));
  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let index = 1; index < layerPoints.length; index += 1) {
    const segmentLength = layerPoints[index - 1].distanceTo(layerPoints[index]);
    segmentLengths.push(segmentLength);
    totalLength += segmentLength;
  }
  if (totalLength <= 0) return latLng(toLatLngTuple(pathCoordinates[0]));
  const targetLength = totalLength / 2;
  let traversed = 0;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const segmentLength = segmentLengths[index];
    if (traversed + segmentLength < targetLength) {
      traversed += segmentLength;
      continue;
    }
    const ratio = segmentLength === 0 ? 0 : (targetLength - traversed) / segmentLength;
    const start = layerPoints[index];
    const end = layerPoints[index + 1];
    return map.layerPointToLatLng(point(start.x + (end.x - start.x) * ratio, start.y + (end.y - start.y) * ratio));
  }
  return latLng(toLatLngTuple(pathCoordinates.at(-1) ?? pathCoordinates[0]));
}

function createMeasurementLabelIcon(label: string) {
  const text = document.createElement("span");
  text.className = "geomcp-measurement-map-label";
  text.textContent = label;
  return divIcon({
    className: "geomcp-measurement-map-label-marker",
    html: text,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

/**
 * Measure Tool 拥有独立 visual/hit renderer。Overlay 只能被暂停，不会被移入此处的
 * LayerGroup；Snapshot 也不会 import 本模块。
 */
export function createMeasurementLayerRuntime(map: LeafletMap): MeasurementLayerRuntime {
  const {panes, visual, vertex, hit} = MEASURE_TOOL_BUILT_IN_CONFIG;
  ensurePane(map, panes.visual.name, panes.visual.zIndex, "none");
  ensurePane(map, panes.hit.name, panes.hit.zIndex, "auto");
  ensurePane(map, panes.deleteMarker.name, panes.deleteMarker.zIndex, "auto");

  const strokeColor = readRequiredCssColor(map, "--geomcp-measurement-stroke");
  const bandColor = readRequiredCssColor(map, "--geomcp-measurement-band");
  const bandOpacity = readRequiredCssNumber(map, "--geomcp-measurement-band-opacity");
  const surfaceColor = readRequiredCssColor(map, "--geomcp-ui-surface");
  const bandRenderer = new InnerBandCanvas({pane: panes.visual.name, tolerance: 0});
  const visualRenderer: Renderer = canvas({pane: panes.visual.name, tolerance: 0});
  // Canvas 会用整张透明画布截断下层 Overlay hit；少量 Measurement 改用只在实际 Path 上命中的 SVG。
  const hitRenderer: Renderer = svg({pane: panes.hit.name});
  // 内侧色带先于虚线外框加入同一 pane，避免半透明色覆盖外框和数值标注。
  const visualRoot: LayerGroup = layerGroup([bandRenderer, visualRenderer]).addTo(map);
  const hitRoot: LayerGroup = layerGroup([hitRenderer]).addTo(map);
  const hitPane = map.getPane(panes.hit.name);
  if (hitPane === undefined) throw new AppError("measurement_style_failed", "Measure Tool hit pane was not created");
  let hitEnabled = true;
  let disposed = false;

  const outlineOptions = {
    renderer: visualRenderer,
    pane: panes.visual.name,
    interactive: false,
    bubblingMouseEvents: false,
    color: strokeColor,
    weight: visual.weightPx,
    opacity: 1,
    fill: false,
    dashArray: visual.dashArray,
    lineCap: "round" as const,
    lineJoin: "round" as const,
  };
  const innerBandOptions = {
    renderer: bandRenderer,
    pane: panes.visual.name,
    interactive: false,
    bubblingMouseEvents: false,
    color: bandColor,
    weight: visual.innerBandWidthPx,
    opacity: bandOpacity,
    fill: false,
    lineCap: "round" as const,
    lineJoin: "round" as const,
  };
  const hitLineOptions = {
    renderer: hitRenderer,
    pane: panes.hit.name,
    interactive: true,
    bubblingMouseEvents: false,
    color: strokeColor,
    opacity: 0,
    weight: hit.lineWidthPx,
    fill: false,
    lineCap: "round" as const,
    lineJoin: "round" as const,
  };

  const createLabelLayer = (coordinate: LatLng, label: string, visible = true): Marker => {
    const labelLayer = marker(coordinate, {
      icon: createMeasurementLabelIcon(label),
      pane: panes.visual.name,
      interactive: false,
      keyboard: false,
      opacity: visible ? 1 : 0,
    });
    visualRoot.addLayer(labelLayer);
    return labelLayer;
  };
  const updateLabelLayer = (labelLayer: Marker, coordinate: LatLng, label: string, visible = true): void => {
    labelLayer.setLatLng(coordinate);
    labelLayer.setIcon(createMeasurementLabelIcon(label));
    labelLayer.setOpacity(visible ? 1 : 0);
  };
  const createPathVertices = (coordinates: readonly MeasureCoordinateType[], opacity: number): readonly MeasurementVertexLayers[] => Object.freeze(coordinates.map((coordinate) => {
    // 双圆结构与内建 node-default 一致：外圈负责轮廓，中心点负责在复杂底图上保持辨识度。
    const latLngValue = toLatLngTuple(coordinate);
    const outerLayer = circleMarker(latLngValue, {
      renderer: visualRenderer,
      pane: panes.visual.name,
      interactive: false,
      bubblingMouseEvents: false,
      radius: vertex.outerRadiusPx,
      color: strokeColor,
      opacity,
      weight: vertex.outerStrokeWidthPx,
      fill: true,
      fillColor: surfaceColor,
      fillOpacity: opacity,
    });
    const centerLayer = circleMarker(latLngValue, {
      renderer: visualRenderer,
      pane: panes.visual.name,
      interactive: false,
      bubblingMouseEvents: false,
      radius: vertex.centerRadiusPx,
      stroke: false,
      fill: true,
      fillColor: strokeColor,
      fillOpacity: opacity,
    });
    visualRoot.addLayer(outerLayer);
    visualRoot.addLayer(centerLayer);
    return Object.freeze({outerLayer, centerLayer});
  }));

  const createDraftPath = (coordinates: readonly MeasureCoordinateType[], lengthMeters: number): MeasurementDraftPathLayers => {
    const pathLayer = polyline(coordinates.map(toLatLngTuple), {...outlineOptions, opacity: visual.draftOpacity});
    visualRoot.addLayer(pathLayer);
    const visible = coordinates.length > 1 && lengthMeters > 0;
    const labelLayer = createLabelLayer(pathMidpoint(map, coordinates, false), formatLinearMeasurement(lengthMeters), visible);
    return Object.freeze({pathLayer, labelLayer});
  };
  const updateDraftPath = (layers: MeasurementDraftPathLayers, coordinates: readonly MeasureCoordinateType[], lengthMeters: number): void => {
    layers.pathLayer.setLatLngs(coordinates.map(toLatLngTuple));
    updateLabelLayer(layers.labelLayer, pathMidpoint(map, coordinates, false), formatLinearMeasurement(lengthMeters), coordinates.length > 1 && lengthMeters > 0);
  };
  const createDraftPathVertices = (coordinates: readonly MeasureCoordinateType[]): readonly MeasurementVertexLayers[] => createPathVertices(coordinates, visual.draftOpacity);

  const circleRadiusCoordinates = (center: MeasureCoordinateType, outlineLayer: Circle): readonly [MeasureCoordinateType, MeasureCoordinateType] => Object.freeze([
    center,
    Object.freeze({latitude: center.latitude, longitude: outlineLayer.getBounds().getEast()}),
  ]);
  const createCircleVisual = (center: MeasureCoordinateType, radiusMeters: number, opacity: number): MeasurementCircleVisualLayers => {
    const innerBandLayer = circle(toLatLngTuple(center), {...innerBandOptions, radius: radiusMeters});
    bandRenderer.registerInnerBand(innerBandLayer);
    visualRoot.addLayer(innerBandLayer);
    const outlineLayer = circle(toLatLngTuple(center), {...outlineOptions, radius: radiusMeters, opacity});
    visualRoot.addLayer(outlineLayer);
    const radiusCoordinates = circleRadiusCoordinates(center, outlineLayer);
    const radiusLayer = polyline(radiusCoordinates.map(toLatLngTuple), {...outlineOptions, opacity});
    visualRoot.addLayer(radiusLayer);
    const labelLayer = createLabelLayer(pathMidpoint(map, radiusCoordinates, false), formatLinearMeasurement(radiusMeters));
    return Object.freeze({outlineLayer, innerBandLayer, radiusLayer, labelLayer});
  };
  const createDraftCircle = (center: MeasureCoordinateType, radiusMeters: number): MeasurementCircleVisualLayers => createCircleVisual(center, radiusMeters, visual.draftOpacity);
  const updateDraftCircle = (layers: MeasurementCircleVisualLayers, radiusMeters: number): void => {
    layers.outlineLayer.setRadius(radiusMeters);
    layers.innerBandLayer.setRadius(radiusMeters);
    const centerLatLng = layers.outlineLayer.getLatLng();
    const center = Object.freeze({latitude: centerLatLng.lat, longitude: centerLatLng.lng});
    const radiusCoordinates = circleRadiusCoordinates(center, layers.outlineLayer);
    layers.radiusLayer.setLatLngs(radiusCoordinates.map(toLatLngTuple));
    updateLabelLayer(layers.labelLayer, pathMidpoint(map, radiusCoordinates, false), formatLinearMeasurement(radiusMeters));
  };

  const createCompletedLayers = (geometry: MeasurementGeometryType, labelMeters: number): CompletedMeasurementLayers => {
    let visualLayer: Path;
    let innerBandLayer: Path | null = null;
    let radiusLayer: Polyline | null = null;
    let labelLayer: Marker;
    let hitLayer: Path;
    if (geometry.kind === "line") {
      const latLngs = geometry.coordinates.map(toLatLngTuple);
      visualLayer = polyline(latLngs, outlineOptions);
      visualRoot.addLayer(visualLayer);
      labelLayer = createLabelLayer(pathMidpoint(map, geometry.coordinates, false), formatLinearMeasurement(labelMeters));
      hitLayer = polyline(latLngs, hitLineOptions);
    } else if (geometry.kind === "polygon") {
      const latLngs = geometry.coordinates.map(toLatLngTuple);
      innerBandLayer = polygon(latLngs, innerBandOptions);
      bandRenderer.registerInnerBand(innerBandLayer);
      visualRoot.addLayer(innerBandLayer);
      visualLayer = polygon(latLngs, outlineOptions);
      visualRoot.addLayer(visualLayer);
      labelLayer = createLabelLayer(pathMidpoint(map, geometry.coordinates, true), formatLinearMeasurement(labelMeters));
      hitLayer = polygon(latLngs, hitLineOptions);
    } else {
      const circleVisual = createCircleVisual(geometry.center, geometry.radiusMeters, 1);
      visualLayer = circleVisual.outlineLayer;
      innerBandLayer = circleVisual.innerBandLayer;
      radiusLayer = circleVisual.radiusLayer;
      labelLayer = circleVisual.labelLayer;
      hitLayer = circle(toLatLngTuple(geometry.center), {...hitLineOptions, radius: geometry.radiusMeters, weight: hit.circleWidthPx});
    }
    const vertexLayers = geometry.kind === "circle" ? createPathVertices([geometry.center], 1) : createPathVertices(geometry.coordinates, 1);
    hitRoot.addLayer(hitLayer);
    return Object.freeze({visualLayer, innerBandLayer, radiusLayer, labelLayer, vertexLayers, hitLayer});
  };
  const setVisualState = (layers: Pick<CompletedMeasurementLayers, "visualLayer" | "radiusLayer" | "vertexLayers">, state: "base" | "hover" | "selected"): void => {
    // Measurement 的约定色不随 hover/selection 改变，只用线宽表达交互状态。
    const weight = state === "selected" ? visual.selectedWeightPx : state === "hover" ? visual.hoverWeightPx : visual.weightPx;
    layers.visualLayer.setStyle({color: strokeColor, weight});
    layers.radiusLayer?.setStyle({color: strokeColor, weight});
    for (const {outerLayer, centerLayer} of layers.vertexLayers) {
      outerLayer.setStyle({color: strokeColor, fillColor: surfaceColor});
      centerLayer.setStyle({fillColor: strokeColor});
    }
  };
  const getVisualNorthEast = (layer: Path): MeasureCoordinateType => {
    if (!("getBounds" in layer) || typeof layer.getBounds !== "function") {
      throw new AppError("measurement_geometry_failed", "Measurement visual layer does not expose bounds");
    }
    const northEast = (layer as BoundedMeasurementPath).getBounds().getNorthEast();
    return Object.freeze({latitude: northEast.lat, longitude: northEast.lng});
  };
  const setCompletedInteractionEnabled = (enabled: boolean): void => {
    if (disposed || enabled === hitEnabled) return;
    hitEnabled = enabled;
    // 保留 SVG 与事件绑定，仅关闭 pane 命中；恢复时无需重新挂载 Path 或重排优先级。
    hitPane.style.pointerEvents = enabled ? "auto" : "none";
  };
  const getCompletedInteractionEnabled = (): boolean => !disposed && hitEnabled;
  const removeVisualLayer = (layer: Layer): void => {
    visualRoot.removeLayer(layer);
  };
  const removeHitLayer = (layer: Path): void => {
    hitRoot.removeLayer(layer);
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    // 先移除 hit，确保 teardown 期间不会再把 hover/click 发布给已卸载的 React 订阅者。
    hitRoot.remove();
    visualRoot.remove();
  };

  return Object.freeze({
    createDraftPath,
    updateDraftPath,
    createDraftPathVertices,
    createDraftCircle,
    updateDraftCircle,
    createCompletedLayers,
    setVisualState,
    getVisualNorthEast,
    setCompletedInteractionEnabled,
    getCompletedInteractionEnabled,
    removeVisualLayer,
    removeHitLayer,
    dispose,
  });
}
