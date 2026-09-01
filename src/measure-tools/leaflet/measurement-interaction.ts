import {
  canvas,
  circle,
  circleMarker,
  layerGroup,
  polygon,
  polyline,
  svg,
  type Circle,
  type LatLngBounds,
  type LayerGroup,
  type Map as LeafletMap,
  type Path,
  type Polyline,
  type Renderer,
} from "leaflet";
import {MEASURE_TOOL_BUILT_IN_CONFIG} from "../../built-in-config/measure-tool.js";
import type {MeasureCoordinateType} from "../../models/measure-tools/measure-tool-models.js";
import type {
  CompletedMeasurementLayers,
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
  if (value.length === 0) {
    throw new AppError("measurement_style_failed", `Measure Tool requires CSS color ${property}`);
  }
  return value;
}

function toLatLngTuple(coordinate: MeasureCoordinateType): [number, number] {
  return [coordinate.latitude, coordinate.longitude];
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

  const baseColor = readRequiredCssColor(map, "--geomcp-ui-bar-end");
  const highlightColor = readRequiredCssColor(map, "--geomcp-ui-highlight");
  const surfaceColor = readRequiredCssColor(map, "--geomcp-ui-surface");
  const visualRenderer: Renderer = canvas({pane: panes.visual.name, tolerance: 0});
  // Canvas 会用整张透明画布截断下层 Overlay hit；少量 Measurement 改用只在实际 Path 上命中的 SVG。
  const hitRenderer: Renderer = svg({pane: panes.hit.name});
  // 两个 root 各自拥有 renderer 与 layers，清理时不会碰触普通 Overlay 的 LayerGroup。
  const visualRoot: LayerGroup = layerGroup([visualRenderer]).addTo(map);
  const hitRoot: LayerGroup = layerGroup([hitRenderer]).addTo(map);
  const hitPane = map.getPane(panes.hit.name);
  if (hitPane === undefined) throw new AppError("measurement_style_failed", "Measure Tool hit pane was not created");
  let hitEnabled = true;
  let disposed = false;

  const visualOptions = {
    // visual layers 完全不接收事件，所有 hover/click 都由更宽的透明 hit Path 承担。
    renderer: visualRenderer,
    pane: panes.visual.name,
    interactive: false,
    bubblingMouseEvents: false,
    color: baseColor,
    weight: visual.weightPx,
    opacity: 1,
    fillColor: highlightColor,
    fillOpacity: visual.fillOpacity,
    lineCap: "round" as const,
    lineJoin: "round" as const,
  };
  const hitLineOptions = {
    renderer: hitRenderer,
    pane: panes.hit.name,
    interactive: true,
    bubblingMouseEvents: false,
    color: baseColor,
    opacity: 0,
    weight: hit.lineWidthPx,
    lineCap: "round" as const,
    lineJoin: "round" as const,
  };

  const createDraftPath = (coordinates: readonly MeasureCoordinateType[]): Polyline => {
    const layer = polyline(coordinates.map(toLatLngTuple), {...visualOptions, opacity: visual.draftOpacity, fill: false});
    visualRoot.addLayer(layer);
    return layer;
  };
  const createPathVertices = (coordinates: readonly MeasureCoordinateType[], opacity: number): readonly MeasurementVertexLayers[] => Object.freeze(coordinates.map((coordinate) => {
    // 双圆结构与内建 node-default 一致：外圈负责轮廓，中心点负责在复杂底图上保持辨识度。
    const latLng = toLatLngTuple(coordinate);
    const outerLayer = circleMarker(latLng, {
      renderer: visualRenderer,
      pane: panes.visual.name,
      interactive: false,
      bubblingMouseEvents: false,
      radius: vertex.outerRadiusPx,
      color: baseColor,
      opacity,
      weight: vertex.outerStrokeWidthPx,
      fill: true,
      fillColor: surfaceColor,
      fillOpacity: opacity,
    });
    const centerLayer = circleMarker(latLng, {
      renderer: visualRenderer,
      pane: panes.visual.name,
      interactive: false,
      bubblingMouseEvents: false,
      radius: vertex.centerRadiusPx,
      stroke: false,
      fill: true,
      fillColor: baseColor,
      fillOpacity: opacity,
    });
    visualRoot.addLayer(outerLayer);
    visualRoot.addLayer(centerLayer);
    return Object.freeze({outerLayer, centerLayer});
  }));
  const createDraftPathVertices = (coordinates: readonly MeasureCoordinateType[]): readonly MeasurementVertexLayers[] => createPathVertices(coordinates, visual.draftOpacity);
  const createDraftCircle = (center: MeasureCoordinateType, radiusMeters: number): Circle => {
    const layer = circle(toLatLngTuple(center), {...visualOptions, radius: radiusMeters, opacity: visual.draftOpacity});
    visualRoot.addLayer(layer);
    return layer;
  };
  const createCompletedLayers = (geometry: MeasurementGeometryType): CompletedMeasurementLayers => {
    let visualLayer: Path;
    let hitLayer: Path;
    if (geometry.kind === "line") {
      const latLngs = geometry.coordinates.map(toLatLngTuple);
      visualLayer = polyline(latLngs, {...visualOptions, fill: false});
      hitLayer = polyline(latLngs, hitLineOptions);
    } else if (geometry.kind === "polygon") {
      const latLngs = geometry.coordinates.map(toLatLngTuple);
      visualLayer = polygon(latLngs, visualOptions);
      // Polygon 内部也属于测量对象；透明 fill 让其在重叠处优先于下层 Overlay。
      hitLayer = polygon(latLngs, {...hitLineOptions, fill: true, fillColor: baseColor, fillOpacity: 0});
    } else {
      const center = toLatLngTuple(geometry.center);
      visualLayer = circle(center, {...visualOptions, radius: geometry.radiusMeters});
      hitLayer = circle(center, {...hitLineOptions, radius: geometry.radiusMeters, weight: hit.circleWidthPx, fill: true, fillColor: baseColor, fillOpacity: 0});
    }
    visualRoot.addLayer(visualLayer);
    const vertexLayers = geometry.kind === "circle" ? Object.freeze([]) : createPathVertices(geometry.coordinates, 1);
    hitRoot.addLayer(hitLayer);
    return Object.freeze({visualLayer, vertexLayers, hitLayer});
  };
  const setVisualState = (layers: Pick<CompletedMeasurementLayers, "visualLayer" | "vertexLayers">, state: "base" | "hover" | "selected"): void => {
    // 主 Path 与所有顶点必须作为同一个视觉对象切换，避免 selection 只高亮线而遗留旧色 Node。
    const activeColor = state === "base" ? baseColor : highlightColor;
    layers.visualLayer.setStyle({
      color: activeColor,
      weight: state === "selected" ? visual.selectedWeightPx : state === "hover" ? visual.hoverWeightPx : visual.weightPx,
      fillOpacity: state === "selected" ? Math.min(1, visual.fillOpacity * 1.6) : visual.fillOpacity,
    });
    for (const {outerLayer, centerLayer} of layers.vertexLayers) {
      outerLayer.setStyle({color: activeColor, fillColor: surfaceColor});
      centerLayer.setStyle({fillColor: activeColor});
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
  const removeVisualLayer = (layer: Path): void => {
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
    createDraftPathVertices,
    createDraftCircle,
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
