/** Leaflet Overlay 的分层、样式分流与 Relation membership 绘制。 */

import {
  Canvas,
  canvas,
  circleMarker,
  layerGroup,
  polygon,
  polyline,
  svg,
  type LayerGroup,
  type Map as LeafletMap,
  type Path,
  type Renderer,
} from "leaflet";
import type {IdentifiedOverlaySpatialFeatureWithDisplayIdType} from "../models/map-data-models.js";
import type {LeafletSpatialGeometry, OverlayFeatureLayerEntry, OverlayFeatureLayerIndex, OverlayRendererOptions, OverlayRenderResult} from "../models/leaflet-renderer-models.js";
import type {CanvasBaseStyleRecipe, CanvasDrawOperation, CanvasSpatialFeatureType} from "../models/style/base-canvas-style.js";
import type {ResolvedBaseStyle, RuntimeStylePlan, RuntimeStyleRule} from "../models/style/runtime-style-models.js";
import {resolveFeatureStyle} from "./feature-style-resolver.js";
import {prepareLeafletGeometry} from "./leaflet-geometry.js";
import {buildRelationTranslucentContext} from "./relation-translucent-context.js";
import {BUILT_IN_RELATION_MEMBERSHIP_DIMENSIONS} from "./styles/built-in/built-in-style.js";

const RENDER_BATCH_SIZE = 200;

const OVERLAY_PANES = {
  areaBase: 410,
  areaSpecial: 420,
  wayBase: 430,
  waySpecial: 440,
  nodeBase: 450,
  nodeSpecial: 460,
  relationMembership: 470,
  labels: 480,
  interaction: 490,
} as const;

type BasePaneName = "areaBase" | "wayBase" | "nodeBase";
type SpecialPaneName = "areaSpecial" | "waySpecial" | "nodeSpecial";

interface FeatureRenderers {
  baseCanvas: Renderer;
  baseSvg: Renderer;
  specialCanvas: Renderer;
  specialSvg: Renderer;
}

interface RendererCollection {
  node: FeatureRenderers;
  way: FeatureRenderers;
  area: FeatureRenderers;
  relationMembership: RelationMembershipCanvas;
  activated: Set<Renderer>;
}

interface MutableLayerIndex {
  node: Record<string, OverlayFeatureLayerEntry>;
  way: Record<string, OverlayFeatureLayerEntry>;
  area: Record<string, OverlayFeatureLayerEntry>;
}

/**
 * Leaflet 先生成 Polygon 的完整 Canvas path；这里用 even-odd clip 将双倍描边裁掉外半侧，
 * 因而 options.weight 表示最终只位于 Polygon 内部的可见带宽，holes 也不会被覆盖。
 */
class RelationMembershipCanvas extends Canvas {
  private readonly innerBandLayers = new WeakSet<Path>();

  registerInnerBand(layer: Path): void {
    this.innerBandLayers.add(layer);
  }

  _fillStroke(context: CanvasRenderingContext2D, layer: Path): void {
    const {color = "#3388ff", fill = false, fillColor, fillOpacity = 0.2, fillRule = "evenodd", lineCap = "round", lineJoin = "round", opacity = 1, stroke = true, weight = 0} = layer.options;
    if (this.innerBandLayers.has(layer)) {
      if (weight <= 0 || opacity <= 0) return;
      context.save();
      context.clip("evenodd");
      context.globalAlpha = opacity;
      context.strokeStyle = color;
      context.lineWidth = weight * 2;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.stroke();
      context.restore();
      return;
    }
    // Node/Way membership 复用同一 renderer，但仍保持 Leaflet Canvas 的标准 fill/stroke 语义。
    if (fill) {
      context.globalAlpha = fillOpacity;
      context.fillStyle = fillColor ?? color;
      context.fill(fillRule === "inherit" ? "evenodd" : fillRule);
    }
    if (stroke && weight > 0) {
      context.globalAlpha = opacity;
      context.lineWidth = weight;
      context.strokeStyle = color;
      context.lineCap = lineCap === "inherit" ? "round" : lineCap;
      context.lineJoin = lineJoin === "inherit" ? "round" : lineJoin;
      context.stroke();
    }
  }
}

function ensureOverlayPanes(map: LeafletMap): void {
  for (const [paneName, zIndex] of Object.entries(OVERLAY_PANES)) {
    const pane = map.getPane(paneName) ?? map.createPane(paneName);
    pane.style.zIndex = String(zIndex);
    // 所有视觉重复层都不接事件；后续唯一 hit target 只放入 interaction pane。
    pane.style.pointerEvents = paneName === "interaction" ? "auto" : "none";
  }
}

function createFeatureRenderers(basePane: BasePaneName, specialPane: SpecialPaneName): FeatureRenderers {
  return {
    baseCanvas: canvas({pane: basePane}),
    baseSvg: svg({pane: basePane}),
    specialCanvas: canvas({pane: specialPane}),
    specialSvg: svg({pane: specialPane}),
  };
}

/** Renderer 实例先轻量创建，直到首条实际绘制命中才挂到 map 并分配 DOM/Canvas。 */
function createRenderers(): RendererCollection {
  const area = createFeatureRenderers("areaBase", "areaSpecial");
  const way = createFeatureRenderers("wayBase", "waySpecial");
  const node = createFeatureRenderers("nodeBase", "nodeSpecial");
  const relationMembership = new RelationMembershipCanvas({pane: "relationMembership"});
  return {node, way, area, relationMembership, activated: new Set<Renderer>()};
}

/** 根组持有所有实际启用的 renderer，失败或卸载时不会遗留空 Canvas/SVG。 */
function activateRenderer(rootLayer: LayerGroup, renderers: RendererCollection, renderer: Renderer): void {
  if (renderers.activated.has(renderer)) return;
  renderers.activated.add(renderer);
  rootLayer.addLayer(renderer);
}

function getCanvasRecipe(plan: RuntimeStylePlan, styleId: string, featureType: CanvasSpatialFeatureType): CanvasBaseStyleRecipe {
  const recipe = plan.canvasStyles[styleId];
  if (recipe === undefined) throw new Error(`Canvas style "${styleId}" was not loaded`);
  if (recipe.featureType !== featureType) throw new Error(`Canvas style "${styleId}" targets ${recipe.featureType}, not ${featureType}`);
  return recipe;
}

function basePathOptions(renderer: Renderer) {
  return {renderer, interactive: false, bubblingMouseEvents: false} as const;
}

function createCanvasOperationLayer(geometry: LeafletSpatialGeometry, operation: CanvasDrawOperation, renderer: Renderer): Path {
  if (geometry.featureType === "node") {
    if (operation.kind !== "circle") throw new Error(`Node Canvas recipe cannot contain ${operation.kind} operation`);
    return circleMarker(geometry.center, {
      ...basePathOptions(renderer),
      radius: operation.radius,
      stroke: operation.strokeWidth > 0,
      color: operation.strokeColor,
      opacity: operation.strokeOpacity,
      weight: operation.strokeWidth,
      fill: true,
      fillColor: operation.fillColor,
      fillOpacity: operation.fillOpacity,
    });
  }
  if (geometry.featureType === "way") {
    if (operation.kind !== "line") throw new Error(`Way Canvas recipe cannot contain ${operation.kind} operation`);
    return polyline(geometry.latLngs, {
      ...basePathOptions(renderer),
      color: operation.color,
      opacity: operation.opacity,
      weight: operation.width,
      lineCap: operation.lineCap,
      lineJoin: operation.lineJoin,
      ...(operation.dash === undefined ? {} : {dashArray: [...operation.dash]}),
    });
  }
  if (operation.kind !== "area") throw new Error(`Area Canvas recipe cannot contain ${operation.kind} operation`);
  return polygon(geometry.latLngs, {
    ...basePathOptions(renderer),
    stroke: operation.strokeWidth > 0,
    color: operation.strokeColor,
    opacity: operation.strokeOpacity,
    weight: operation.strokeWidth,
    fill: true,
    fillColor: operation.fillColor,
    fillOpacity: operation.fillOpacity,
    fillRule: "evenodd",
  });
}

function createCanvasRecipeLayers(geometry: LeafletSpatialGeometry, recipe: CanvasBaseStyleRecipe, renderer: Renderer): ReadonlyArray<Path> {
  if (recipe.featureType !== geometry.featureType) throw new Error(`Canvas recipe targets ${recipe.featureType}, not ${geometry.featureType}`);
  return recipe.operations.map((operation) => createCanvasOperationLayer(geometry, operation, renderer));
}

function getLargestOperation(recipe: CanvasBaseStyleRecipe): CanvasDrawOperation {
  if (recipe.operations.length === 0) throw new Error(`Default ${recipe.featureType} Canvas recipe has no operations`);
  if (recipe.featureType === "node") {
    return recipe.operations.reduce((largest, operation) => operation.kind === "circle" && (largest.kind !== "circle" || operation.radius > largest.radius) ? operation : largest);
  }
  if (recipe.featureType === "way") {
    return recipe.operations.reduce((largest, operation) => operation.kind === "line" && (largest.kind !== "line" || operation.width > largest.width) ? operation : largest);
  }
  const areaOperation = recipe.operations.find((operation) => operation.kind === "area");
  if (areaOperation === undefined) throw new Error("Default area Canvas recipe has no area operation");
  return areaOperation;
}

/** CSS path 仍需要稳定 geometry/radius；颜色等 presentation attributes 可由 class selector 覆盖。 */
function createCssLayer(geometry: LeafletSpatialGeometry, defaultRecipe: CanvasBaseStyleRecipe, className: string, renderLayer: "border" | "base" | "translucent", renderer: Renderer): Path {
  const operation = getLargestOperation(defaultRecipe);
  const commonOptions = {...basePathOptions(renderer), className: `geomcp-user-overlay ${className}`};
  const layerOpacity = renderLayer === "translucent" ? 0.35 : 1;
  if (geometry.featureType === "node" && operation.kind === "circle") {
    return circleMarker(geometry.center, {
      ...commonOptions,
      radius: operation.radius + (renderLayer === "border" ? operation.strokeWidth : 0),
      stroke: true,
      color: operation.strokeColor,
      opacity: layerOpacity,
      weight: operation.strokeWidth,
      fill: renderLayer !== "border",
      fillColor: operation.fillColor,
      fillOpacity: renderLayer === "translucent" ? operation.fillOpacity * 0.35 : operation.fillOpacity,
    });
  }
  if (geometry.featureType === "way" && operation.kind === "line") {
    return polyline(geometry.latLngs, {
      ...commonOptions,
      color: operation.color,
      opacity: layerOpacity,
      weight: operation.width + (renderLayer === "border" ? 4 : 0),
      lineCap: operation.lineCap,
      lineJoin: operation.lineJoin,
      ...(operation.dash === undefined ? {} : {dashArray: [...operation.dash]}),
    });
  }
  if (geometry.featureType === "area" && operation.kind === "area") {
    return polygon(geometry.latLngs, {
      ...commonOptions,
      stroke: true,
      color: operation.strokeColor,
      opacity: layerOpacity,
      weight: operation.strokeWidth + (renderLayer === "border" ? 2 : 0),
      fill: renderLayer !== "border",
      fillColor: operation.fillColor,
      fillOpacity: renderLayer === "translucent" ? operation.fillOpacity * 0.35 : operation.fillOpacity,
      fillRule: "evenodd",
    });
  }
  throw new Error(`Default ${defaultRecipe.featureType} Canvas recipe cannot seed a CSS ${geometry.featureType} layer`);
}

function addLayers(group: LayerGroup, layers: ReadonlyArray<Path>): void {
  for (const layer of layers) group.addLayer(layer);
}

function renderCanvasRule(group: LayerGroup, geometry: LeafletSpatialGeometry, rule: Extract<RuntimeStyleRule, {kind: "canvas"}>, plan: RuntimeStylePlan, renderer: Renderer): CanvasBaseStyleRecipe {
  const recipe = getCanvasRecipe(plan, rule.styleId, geometry.featureType);
  addLayers(group, createCanvasRecipeLayers(geometry, recipe, renderer));
  return recipe;
}

function renderBase(rootLayer: LayerGroup, group: LayerGroup, geometry: LeafletSpatialGeometry, base: ResolvedBaseStyle, defaultRecipe: CanvasBaseStyleRecipe, plan: RuntimeStylePlan, featureRenderers: FeatureRenderers, renderers: RendererCollection): CanvasBaseStyleRecipe | null {
  if (base.kind === "css") {
    activateRenderer(rootLayer, renderers, featureRenderers.baseSvg);
    group.addLayer(createCssLayer(geometry, defaultRecipe, base.className, "base", featureRenderers.baseSvg));
    return null;
  }
  const recipe = getCanvasRecipe(plan, base.styleId, geometry.featureType);
  activateRenderer(rootLayer, renderers, featureRenderers.baseCanvas);
  addLayers(group, createCanvasRecipeLayers(geometry, recipe, featureRenderers.baseCanvas));
  return recipe;
}

function renderAddonRules(rootLayer: LayerGroup, group: LayerGroup, geometry: LeafletSpatialGeometry, rules: ReadonlyArray<RuntimeStyleRule>, defaultRecipe: CanvasBaseStyleRecipe, plan: RuntimeStylePlan, canvasRenderer: Renderer, svgRenderer: Renderer, renderers: RendererCollection): void {
  for (const rule of rules) {
    if (rule.kind === "css") {
      activateRenderer(rootLayer, renderers, svgRenderer);
      group.addLayer(createCssLayer(geometry, defaultRecipe, rule.className, rule.renderLayer, svgRenderer));
    } else {
      activateRenderer(rootLayer, renderers, canvasRenderer);
      renderCanvasRule(group, geometry, rule, plan, canvasRenderer);
    }
  }
}

function sameColor(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function renderRelationMembership(rootLayer: LayerGroup, group: LayerGroup, geometry: LeafletSpatialGeometry, mainAreaColor: string | undefined, options: OverlayRendererOptions, renderers: RendererCollection): void {
  const style = options.stylePlan.relationMembershipStyle;
  const dimensions = BUILT_IN_RELATION_MEMBERSHIP_DIMENSIONS;
  const renderer = renderers.relationMembership;
  activateRenderer(rootLayer, renderers, renderer);
  if (geometry.featureType === "node") {
    group.addLayer(circleMarker(geometry.center, {
      ...basePathOptions(renderer),
      radius: dimensions.nodeRadius,
      stroke: true,
      color: style.defaultColor,
      opacity: style.opacity,
      weight: dimensions.nodeStrokeWidth,
      fill: false,
    }));
    return;
  }
  if (geometry.featureType === "way") {
    group.addLayer(polyline(geometry.latLngs, {
      ...basePathOptions(renderer),
      color: style.defaultColor,
      opacity: style.opacity,
      weight: dimensions.wayWidth,
      lineCap: "round",
      lineJoin: "round",
    }));
    return;
  }

  const hasMainColor = mainAreaColor !== undefined;
  const mergedColor = hasMainColor && sameColor(mainAreaColor, style.defaultColor);
  const relationWidth = dimensions.areaBandWidth * (hasMainColor ? 2 : 1);
  const relationBand = polygon(geometry.latLngs, {
    ...basePathOptions(renderer),
    stroke: true,
    color: style.defaultColor,
    opacity: style.opacity,
    weight: relationWidth,
    fill: false,
    fillRule: "evenodd",
  });
  renderer.registerInnerBand(relationBand);
  group.addLayer(relationBand);
  // 主色放在最靠近边界的一带；同色时上面的总宽度绘制已经完成视觉合并。
  if (hasMainColor && !mergedColor) {
    const mainColorBand = polygon(geometry.latLngs, {
      ...basePathOptions(renderer),
      stroke: true,
      color: mainAreaColor,
      opacity: style.opacity,
      weight: dimensions.areaBandWidth,
      fill: false,
      fillRule: "evenodd",
    });
    renderer.registerInnerBand(mainColorBand);
    group.addLayer(mainColorBand);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Overlay rendering was aborted");
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function freezeLayerIndex(index: MutableLayerIndex): OverlayFeatureLayerIndex {
  return Object.freeze({
    node: Object.freeze(index.node),
    way: Object.freeze(index.way),
    area: Object.freeze(index.area),
  });
}

/**
 * 按 Area → Way → Node 顺序分批渲染；每个 Feature 当场完成 projection、rule resolve、
 * Base/addon/membership 绘制和 typed layer index 注册，不保存全量中间命令。
 */
export async function renderOverlay(options: OverlayRendererOptions): Promise<OverlayRenderResult> {
  ensureOverlayPanes(options.map);
  const renderers = createRenderers();
  const rootLayer = layerGroup().addTo(options.map);
  const relationContext = buildRelationTranslucentContext(options.overlayOutput.relation, options.relationMemberFeaturesByRelation, options.stylePlan);
  const mutableLayerIndex: MutableLayerIndex = {
    node: Object.create(null) as Record<string, OverlayFeatureLayerEntry>,
    way: Object.create(null) as Record<string, OverlayFeatureLayerEntry>,
    area: Object.create(null) as Record<string, OverlayFeatureLayerEntry>,
  };

  const renderFeature = (feature: IdentifiedOverlaySpatialFeatureWithDisplayIdType): void => {
    const typeIndex = mutableLayerIndex[feature.feature_type];
    if (typeIndex[feature.feature_id] !== undefined) throw new Error(`Duplicate ${feature.feature_type} feature_id "${feature.feature_id}" in Overlay renderer`);
    const geometry = prepareLeafletGeometry(feature, options.centerLongitude);
    const resolvedStyle = resolveFeatureStyle(feature, options.stylePlan);
    const featureRenderers = renderers[feature.feature_type];
    const defaultRecipe = getCanvasRecipe(options.stylePlan, options.stylePlan.defaultBaseStyleIds[feature.feature_type], feature.feature_type);
    const featureLayer = layerGroup();

    renderAddonRules(rootLayer, featureLayer, geometry, resolvedStyle.border, defaultRecipe, options.stylePlan, featureRenderers.baseCanvas, featureRenderers.baseSvg, renderers);
    const selectedBaseRecipe = renderBase(rootLayer, featureLayer, geometry, resolvedStyle.base, defaultRecipe, options.stylePlan, featureRenderers, renderers);
    renderAddonRules(rootLayer, featureLayer, geometry, resolvedStyle.translucent, defaultRecipe, options.stylePlan, featureRenderers.specialCanvas, featureRenderers.specialSvg, renderers);

    const relationFeatureIds = relationContext.membershipByFeatureId[feature.feature_type][feature.feature_id];
    if (relationFeatureIds !== undefined && relationFeatureIds.length > 0) {
      renderRelationMembership(rootLayer, featureLayer, geometry, feature.feature_type === "area" ? selectedBaseRecipe?.mainColor : undefined, options, renderers);
    }

    rootLayer.addLayer(featureLayer);
    typeIndex[feature.feature_id] = Object.freeze({featureId: feature.feature_id, displayId: feature.display_id, layer: featureLayer});
  };

  try {
    const groups = [options.overlayOutput.area, options.overlayOutput.way, options.overlayOutput.node] as const;
    for (const features of groups) {
      for (let index = 0; index < features.length; index += 1) {
        throwIfAborted(options.signal);
        renderFeature(features[index]);
        if ((index + 1) % RENDER_BATCH_SIZE === 0 && index + 1 < features.length) await yieldToBrowser();
      }
    }
    throwIfAborted(options.signal);
    return Object.freeze({rootLayer, layerIndex: freezeLayerIndex(mutableLayerIndex), relationContext});
  } catch (error) {
    rootLayer.remove();
    throw error;
  }
}
