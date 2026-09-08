/**
 * Interactive flow 的透明 Canvas 命中层。
 *
 * 本模块不重新解析 tag/style/relation，也不重新投影 geometry；它只消费 Visual result 中已经
 * 展开的 geometry 与 measurement controller 的可靠测量。Snapshot 不导入或调用本模块。
 */

import {CircleMarker, canvas, circleMarker, layerGroup, polygon, polyline, svg, type Map as LeafletMap, type Path, type Renderer} from "leaflet";
import type {LeafletConfigType} from "../../models/backend/config-models.js";
import type {
  AttachOverlayInteractionOptions,
  LeafletSpatialGeometry,
  OverlayFeatureLayerEntry,
  OverlayInteractionLayerEntry,
  OverlayInteractionLayerIndex,
  OverlayInteractionTarget,
  OverlayInteractionResult,
  OverlayRenderResult,
  OverlayVisualMeasurement,
} from "../../models/mapsurface/leaflet-renderer-models.js";
import type {CanvasSpatialFeatureType} from "../../models/mapsurface/style/base-canvas-style.js";
import {AppError} from "../../utils/app-error.js";
import {LEAFLET_INTERNAL_RENDER_CONFIG} from "../../built-in-config/leaflet.js";

interface MutableOverlayInteractionLayerIndex {
  node: Record<string, OverlayInteractionLayerEntry>;
  way: Record<string, OverlayInteractionLayerEntry>;
  area: Record<string, OverlayInteractionLayerEntry>;
}

interface OverlayInteractionRegistration {
  visualEntry: OverlayFeatureLayerEntry;
  interactionLayer: Path;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Interaction pane 只在 Interactive attach 时创建；Snapshot 不承担它的 DOM 与事件边界。 */
function ensureInteractionPane(map: LeafletMap): "interaction" {
  const {name, zIndex} = LEAFLET_INTERNAL_RENDER_CONFIG.panes.interaction;
  const pane = map.getPane(name) ?? map.createPane(name);
  pane.style.zIndex = String(zIndex);
  pane.style.pointerEvents = "auto";
  return name;
}

/**
 * opacity=0 只隐藏实际像素，不会绕过 Leaflet Canvas 的 containsPoint 检查，因此完全不可见的
 * Feature 必须由外层不挂载/移除 Path；这里仅负责创建对应 geometry 的稳定命中形状。
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
    // MultiLine 始终使用连续透明粗线，视觉 dash 不在 hit geometry 上制造无法点击的空洞。
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

function freezeInteractionLayerIndex(index: MutableOverlayInteractionLayerIndex): OverlayInteractionLayerIndex {
  return Object.freeze({
    node: Object.freeze(index.node),
    way: Object.freeze(index.way),
    area: Object.freeze(index.area),
  });
}

/**
 * 根据最新视觉范围更新透明命中尺寸。配置中的 min 值只在 hasVisiblePaint=true 后使用，
 * 因而 fill:none / stroke:none / opacity:0 不会被最小命中尺寸重新变成“看不见但能点”。
 */
function synchronizeInteractionLayer(
  rootLayer: ReturnType<typeof layerGroup>,
  registration: OverlayInteractionRegistration,
  measurement: OverlayVisualMeasurement,
  config: LeafletConfigType["interaction"],
): boolean {
  const {featureType} = registration.visualEntry;
  const hitLayer = registration.interactionLayer;
  if (!measurement.hasVisiblePaint) {
    if (rootLayer.hasLayer(hitLayer)) rootLayer.removeLayer(hitLayer);
    return false;
  }

  if (!rootLayer.hasLayer(hitLayer)) rootLayer.addLayer(hitLayer);
  if (featureType === "node") {
    if (!(hitLayer instanceof CircleMarker)) throw new AppError("invalid_overlay_interaction", "Node interaction layer must be a CircleMarker");
    hitLayer.setRadius(clamp(
      measurement.visualSizePx + config.node_extra_radius_px,
      config.min_node_radius_px,
      config.max_node_radius_px,
    ));
  } else if (featureType === "way") {
    hitLayer.setStyle({weight: clamp(
      measurement.visualSizePx + config.way_extra_width_px,
      config.min_way_width_px,
      config.max_way_width_px,
    )});
  }
  // Area 命中 geometry 不依赖视觉描边宽度；只需要同步上面的显隐状态。
  return true;
}

function isSameInteractionTarget(left: OverlayInteractionTarget | null, right: OverlayInteractionTarget | null): boolean {
  return left === right || (left !== null && right !== null && left.featureType === right.featureType && left.featureId === right.featureId);
}

/**
 * 在同一个 Canvas renderer 中，Path 被移除后重新加入会排到最上层。每个测量批次结束后按
 * Area → Way → Node、并保持各类型原 Overlay 顺序统一 bringToFront，确保 Node 始终拥有最高
 * 点击优先级，而且显隐切换不会悄悄改变重叠 Feature 的事件目标。
 */
function normalizeInteractionOrder(
  rootLayer: ReturnType<typeof layerGroup>,
  registrations: Readonly<Record<CanvasSpatialFeatureType, ReadonlyArray<OverlayInteractionRegistration>>>,
): void {
  for (const featureType of ["area", "way", "node"] as const) {
    for (const registration of registrations[featureType]) {
      if (rootLayer.hasLayer(registration.interactionLayer)) registration.interactionLayer.bringToFront();
    }
  }
}

/**
 * 在 Visual 首次测量完成后附加 Interactive 命中层。
 *
 * 创建过程只遍历 Visual result 的显式有序数组；measurement 更新也只调整现有 hit geometry。
 * 返回结果拥有独立幂等 dispose，调用方必须按 interaction → visual → mapSurface 顺序清理。
 */
export function attachOverlayInteraction(options: AttachOverlayInteractionOptions): OverlayInteractionResult {
  const {map, visualResult, config, handlers} = options;
  const interactionPane = ensureInteractionPane(map);
  const interactionPaneElement = map.getPane(interactionPane);
  if (interactionPaneElement === undefined) throw new AppError("overlay_interaction", "Overlay interaction pane was not created");
  const renderer = canvas({pane: interactionPane, tolerance: 0});
  const rootLayer = layerGroup().addTo(map);
  rootLayer.addLayer(renderer);
  const highlightPaneConfig = LEAFLET_INTERNAL_RENDER_CONFIG.panes.highlight;
  const highlightPane = map.getPane(highlightPaneConfig.name) ?? map.createPane(highlightPaneConfig.name);
  highlightPane.style.zIndex = String(highlightPaneConfig.zIndex);
  highlightPane.style.pointerEvents = "none";
  const highlightRenderer = svg({pane: highlightPaneConfig.name});
  rootLayer.addLayer(highlightRenderer);
  const highlightRoot = layerGroup();
  rootLayer.addLayer(highlightRoot);
  const mutableLayerIndex: MutableOverlayInteractionLayerIndex = {
    node: Object.create(null) as Record<string, OverlayInteractionLayerEntry>,
    way: Object.create(null) as Record<string, OverlayInteractionLayerEntry>,
    area: Object.create(null) as Record<string, OverlayInteractionLayerEntry>,
  };
  const registrations: Record<CanvasSpatialFeatureType, Array<OverlayInteractionRegistration>> = {node: [], way: [], area: []};
  const unsubscribeCallbacks: Array<() => void> = [];
  let hoverTarget: OverlayInteractionTarget | null = null;
  let selectedTarget: OverlayInteractionTarget | null = null;
  let enabled = true;
  let disposed = false;

  const refreshHighlights = (): void => {
    highlightRoot.clearLayers();
    if (disposed || !enabled) return;
    const size = LEAFLET_INTERNAL_RENDER_CONFIG.interactionHighlight;
    // 最多两个纯显示 Path；同一对象 hover + selected 时只画 selected，避免叠色。
    const draw = (target: OverlayInteractionTarget | null, state: "hover" | "selected"): void => {
      if (target === null) return;
      const entry = mutableLayerIndex[target.featureType][target.featureId];
      if (entry === undefined) return;
      const measurement = visualResult.measurementController.getMeasurement(target.featureType, target.featureId);
      if (!measurement.hasVisiblePaint) return;
      const geometry = entry.visualEntry.geometry;
      const options = {
        renderer: highlightRenderer,
        pane: highlightPaneConfig.name,
        interactive: false,
        bubblingMouseEvents: false,
        className: `geomcp-overlay-highlight geomcp-overlay-highlight-${state} geomcp-overlay-highlight-${target.featureType}`,
        fill: false,
        weight: Math.max(size.minStrokeWidthPx, measurement.visualSizePx + size.lineExtraWidthPx),
        lineCap: "round" as const,
        lineJoin: "round" as const,
      };
      // 沿用已展开的世界坐标；Area 保留外环/孔洞，只描边，原透明面命中不变。
      const layer = geometry.featureType === "node"
        ? circleMarker(geometry.center, {...options, radius: measurement.visualSizePx + size.nodeExtraRadiusPx, stroke: false, fill: true})
        : geometry.featureType === "way" ? polyline(geometry.latLngs, options) : polygon(geometry.latLngs, options);
      highlightRoot.addLayer(layer);
    };
    if (!isSameInteractionTarget(hoverTarget, selectedTarget)) draw(hoverTarget, "hover");
    draw(selectedTarget, "selected");
  };

  const publishHover = (target: OverlayInteractionTarget | null): void => {
    if (disposed || (!enabled && target !== null)) return;
    if (isSameInteractionTarget(hoverTarget, target)) return;
    hoverTarget = target;
    refreshHighlights();
    handlers?.onHoverChange(target);
  };
  const publishSelection = (target: OverlayInteractionTarget | null): void => {
    if (disposed || (!enabled && target !== null)) return;
    if (isSameInteractionTarget(selectedTarget, target)) return;
    selectedTarget = target;
    refreshHighlights();
    handlers?.onSelectionChange(target);
  };
  const clearHover = (): void => publishHover(null);
  const clearSelection = (): void => publishSelection(null);

  try {
    // 三段显式循环保留 Area → Way → Node 优先级；不能改为遍历 layerIndex 普通对象。
    for (const featureType of ["area", "way", "node"] as const) {
      for (const visualEntry of visualResult.orderedLayers[featureType]) {
        const measurement = visualResult.measurementController.getMeasurement(featureType, visualEntry.featureId);
        const interactionLayer = createOverlayInteractionLayer(visualEntry.geometry, measurement, renderer, config);
        const registration = {visualEntry, interactionLayer} satisfies OverlayInteractionRegistration;
        const target: OverlayInteractionTarget = Object.freeze({
          featureType,
          featureId: visualEntry.featureId,
        });
        registrations[featureType].push(registration);
        synchronizeInteractionLayer(rootLayer, registration, measurement, config);
        const handleMouseOver = (): void => publishHover(target);
        const handleMouseOut = (): void => {
          if (isSameInteractionTarget(hoverTarget, target)) publishHover(null);
        };
        const handleClick = (): void => publishSelection(isSameInteractionTarget(selectedTarget, target) ? null : target);
        interactionLayer.on("mouseover", handleMouseOver);
        interactionLayer.on("mouseout", handleMouseOut);
        interactionLayer.on("click", handleClick);
        unsubscribeCallbacks.push(() => {
          interactionLayer.off("mouseover", handleMouseOver);
          interactionLayer.off("mouseout", handleMouseOut);
          interactionLayer.off("click", handleClick);
        });
        unsubscribeCallbacks.push(visualResult.measurementController.subscribe(featureType, visualEntry.featureId, (nextMeasurement) => {
          if (disposed) return;
          if (!synchronizeInteractionLayer(rootLayer, registration, nextMeasurement, config)) {
            if (isSameInteractionTarget(hoverTarget, target)) publishHover(null);
            if (isSameInteractionTarget(selectedTarget, target)) publishSelection(null);
          }
        }));
        mutableLayerIndex[featureType][visualEntry.featureId] = Object.freeze({
          featureId: visualEntry.featureId,
          featureType,
          visualEntry,
          interactionLayer,
        });
      }
    }

    normalizeInteractionOrder(rootLayer, registrations);
    // Feature listener 完成全部增删/改尺寸后，再做一次批量顺序归一化，避免每条更新都 O(N)。
    unsubscribeCallbacks.push(visualResult.measurementController.subscribeBatchComplete(() => {
      if (!disposed) {
        normalizeInteractionOrder(rootLayer, registrations);
        refreshHighlights();
      }
    }));
    const handleMapClick = (): void => {
      if (enabled) clearSelection();
    };
    map.on("click", handleMapClick);
    unsubscribeCallbacks.push(() => map.off("click", handleMapClick));

    const setEnabled = (nextEnabled: boolean): void => {
      if (disposed || enabled === nextEnabled) return;
      enabled = nextEnabled;
      if (!enabled) {
        clearHover();
        clearSelection();
        // Canvas renderer 覆盖整张 MapSurface；只暂停 pane 命中，避免 remove/add 后丢失事件状态。
        interactionPaneElement.style.pointerEvents = "none";
        return;
      }
      interactionPaneElement.style.pointerEvents = "auto";
    };
    const getEnabled = (): boolean => !disposed && enabled;

    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      for (const unsubscribe of unsubscribeCallbacks.splice(0)) unsubscribe();
      highlightRoot.clearLayers();
      if (hoverTarget !== null) {
        hoverTarget = null;
        handlers?.onHoverChange(null);
      }
      if (selectedTarget !== null) {
        selectedTarget = null;
        handlers?.onSelectionChange(null);
      }
      rootLayer.remove();
    };
    return Object.freeze({rootLayer, layerIndex: freezeInteractionLayerIndex(mutableLayerIndex), clearSelection, clearHover, setEnabled, getEnabled, dispose});
  } catch (error) {
    // attach 中途失败时撤销已经建立的订阅，不能把半成品 Interaction 留给 Visual 生命周期。
    disposed = true;
    for (const unsubscribe of unsubscribeCallbacks.splice(0)) unsubscribe();
    highlightRoot.clearLayers();
    rootLayer.remove();
    throw AppError.fromUnknown(error, "overlay_interaction", "Overlay interaction initialization failed");
  }
}
