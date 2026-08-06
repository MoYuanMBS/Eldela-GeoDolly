/**
 * Leaflet Overlay 的总编排入口。
 *
 * 上游必须已经完成 RuntimeStylePlan、display_id、连续世界参考中心和 Relation 成员字典准备。
 * 本模块按 Area → Way → Node 单次遍历：转换 geometry、解析样式、创建视觉层、追加 Relation、
 * 注册透明 interaction geometry 与标签候选，最后返回可整体卸载的 rootLayer 和 typed index。
 *
 * Canvas 与 SVG/CSS 只在实际绘制处分流；tag 匹配、标签布局和交互命中分别委托给独立模块。
 */

import {
  Canvas,
  CircleMarker,
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
import {NodeZoomController} from "./node-zoom-controller.js";
import {createOverlayInteractionLayer} from "./overlay-interaction.js";
import {OverlayLabelLayer} from "./overlay-label-layer.js";
import {buildRelationTranslucentContext} from "./relation-translucent-context.js";
import {BUILT_IN_RELATION_MEMBERSHIP_DIMENSIONS} from "./styles/built-in/built-in-style.js";

// Leaflet layer 创建仍在主线程执行；固定批次让大结果集定期归还事件循环，避免 iframe 长时间无响应。
const RENDER_BATCH_SIZE = 200;

// z-index 是跨 renderer 的稳定层级契约，不能依靠异步批次或 Layer 创建顺序决定覆盖关系。
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
  // Base 与 Special 分 pane；Canvas recipe 和 CSS rule 再分别使用 Canvas/SVG renderer。
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
  interaction: Renderer;
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
    // WeakSet 只标记需要特殊裁切的 Area path，不延长 Feature layer 的生命周期。
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

/** 一个 Feature 类型同时准备 Canvas/SVG 两条路径，但未命中的 renderer 不会挂载 DOM。 */
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
  const interaction = canvas({pane: "interaction", tolerance: 0});
  return {node, way, area, relationMembership, interaction, activated: new Set<Renderer>()};
}

/** 根组持有所有实际启用的 renderer，失败或卸载时不会遗留空 Canvas/SVG。 */
function activateRenderer(rootLayer: LayerGroup, renderers: RendererCollection, renderer: Renderer): void {
  if (renderers.activated.has(renderer)) return;
  renderers.activated.add(renderer);
  rootLayer.addLayer(renderer);
}

function getCanvasRecipe(plan: RuntimeStylePlan, styleId: string, featureType: CanvasSpatialFeatureType): CanvasBaseStyleRecipe {
  // RuntimeStylePlan 理论上已校验默认 ID；这里继续守住 rule styleId 与 Feature 类型的运行时边界。
  const recipe = plan.canvasStyles[styleId];
  if (recipe === undefined) throw new Error(`Canvas style "${styleId}" was not loaded`);
  if (recipe.featureType !== featureType) throw new Error(`Canvas style "${styleId}" targets ${recipe.featureType}, not ${featureType}`);
  return recipe;
}

function basePathOptions(renderer: Renderer) {
  // 所有可见重复绘制都禁止事件，避免一次点击命中 casing、Base、addon 等多条 Path。
  return {renderer, interactive: false, bubblingMouseEvents: false} as const;
}

/** 把一条抽象 Canvas operation 转为对应的 Leaflet Path；不处理 rule 优先级。 */
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
  // 数组顺序即同一 Base 内的绘制顺序，例如道路 casing 必须先于内部主线。
  return recipe.operations.map((operation) => createCanvasOperationLayer(geometry, operation, renderer));
}

/** CSS rule 没有几何尺寸，选择默认 recipe 的最大 operation 作为 SVG Path 的稳定 geometry 种子。 */
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

/**
 * CSS path 仍需要稳定 geometry/radius；默认 recipe 只提供形状与兜底 presentation attributes，
 * 最终颜色等由 class selector 覆盖。Canvas 不读取这里的 CSS 计算结果。
 */
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

/**
 * Base 只绘制 resolver 选中的唯一结果。返回 Canvas recipe 是为了让 Area Relation 复用 mainColor；
 * CSS Base 不反读 computed style，因此返回 null，保持 CSS/Canvas 数据边界。
 */
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

/** Border/Translucent 已在 resolver 中按 effectType 去重，这里只按 planOrder 顺序执行绘制。 */
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

/**
 * Relation 自身没有 geometry；当前函数只复用成员 Feature geometry 追加固定 Canvas addon。
 * 多个 Relation 已在 context 中合并成一次“是否存在 membership”判断，不按 relation 数量重复绘制。
 */
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

  const totalWidth = dimensions.areaBandTotalWidth;
  const hasMainColor = mainAreaColor !== undefined;
  const mergedColor = hasMainColor && sameColor(mainAreaColor, style.defaultColor);
  const relationBand = polygon(geometry.latLngs, {
    ...basePathOptions(renderer),
    stroke: true,
    color: style.defaultColor,
    opacity: style.opacity,
    weight: totalWidth,
    fill: false,
    fillRule: "evenodd",
  });
  renderer.registerInnerBand(relationBand);
  group.addLayer(relationBand);
  // Relation 先占满总宽度，再用主色覆盖靠近边界的一半；最终两种颜色各占总宽度一半。
  if (hasMainColor && !mergedColor) {
    const mainColorBand = polygon(geometry.latLngs, {
      ...basePathOptions(renderer),
      stroke: true,
      color: mainAreaColor,
      opacity: style.opacity,
      weight: totalWidth / 2,
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

/** setTimeout(0) 建立新的 task，让浏览器有机会处理绘制、输入和 React 生命周期。 */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function freezeLayerIndex(index: MutableLayerIndex): OverlayFeatureLayerIndex {
  // feature_type 是第一层命名空间，避免 node/way/area 的 canonical feature_id 相互碰撞。
  return Object.freeze({
    node: Object.freeze(index.node),
    way: Object.freeze(index.way),
    area: Object.freeze(index.area),
  });
}

/** properties 已是 Overlay 聚合结果；这里只做稳定去重，不从 AI Output 恢复 name。 */
function getFeatureNameText(feature: IdentifiedOverlaySpatialFeatureWithDisplayIdType): string | undefined {
  const values = feature.properties.name ?? [];
  const names: Array<string> = [];
  const seen = new Set<string>();
  for (const value of values) {
    const name = value.trim();
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names.length === 0 ? undefined : names.join(" / ");
}

/** 收集一个 Node 的全部可见/命中 CircleMarker，交给 zoom controller 使用相同比例缩放。 */
function getNodeCircleLayers(group: LayerGroup): Array<CircleMarker> {
  const circles: Array<CircleMarker> = [];
  group.eachLayer((layer) => {
    if (layer instanceof CircleMarker) circles.push(layer);
  });
  return circles;
}

/**
 * 按 Area → Way → Node 顺序分批渲染；每个 Feature 当场完成 projection、rule resolve、
 * Base/addon/membership、透明 hit geometry、Label candidate 和 typed layer index 注册，
 * 不保存全量样式匹配中间结果，也不额外遍历 Overlay。
 */
export async function renderOverlay(options: OverlayRendererOptions): Promise<OverlayRenderResult> {
  // 先固定 pane 和共享生命周期根节点；后续任一步失败都只需移除 rootLayer。
  ensureOverlayPanes(options.map);
  const renderers = createRenderers();
  const rootLayer = layerGroup().addTo(options.map);
  const nodeZoomController = new NodeZoomController();
  const labelLayer = new OverlayLabelLayer();
  rootLayer.addLayer(nodeZoomController);
  // Relation 反向索引只构建一次，renderFeature 内只按 type + feature_id 查询。
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
    // 一个 FeatureGroup 聚合它跨 pane 的所有视觉和 hit Paths，便于 typed index 与卸载保持一对一。
    const featureLayer = layerGroup();

    // Pane 决定跨层覆盖关系；同一阶段内仍保持 Border → Base → Translucent 的稳定创建顺序。
    renderAddonRules(rootLayer, featureLayer, geometry, resolvedStyle.border, defaultRecipe, options.stylePlan, featureRenderers.baseCanvas, featureRenderers.baseSvg, renderers);
    const selectedBaseRecipe = renderBase(rootLayer, featureLayer, geometry, resolvedStyle.base, defaultRecipe, options.stylePlan, featureRenderers, renderers);
    renderAddonRules(rootLayer, featureLayer, geometry, resolvedStyle.translucent, defaultRecipe, options.stylePlan, featureRenderers.specialCanvas, featureRenderers.specialSvg, renderers);

    const relationFeatureIds = relationContext.membershipByFeatureId[feature.feature_type][feature.feature_id];
    if (relationFeatureIds !== undefined && relationFeatureIds.length > 0) {
      renderRelationMembership(rootLayer, featureLayer, geometry, feature.feature_type === "area" ? selectedBaseRecipe?.mainColor : undefined, options, renderers);
    }

    const nodeVisualCircles = feature.feature_type === "node" ? getNodeCircleLayers(featureLayer) : [];
    const nodeVisualRadius = nodeVisualCircles.reduce((largest, layer) => Math.max(largest, layer.getRadius()), 0);
    // interactionLayer 是唯一 interactive Path；尺寸参考最终 Canvas Base，CSS Base 则回退到默认 recipe。
    activateRenderer(rootLayer, renderers, renderers.interaction);
    const interactionLayer = createOverlayInteractionLayer(geometry, selectedBaseRecipe ?? defaultRecipe, renderers.interaction, nodeVisualRadius);
    featureLayer.addLayer(interactionLayer);

    const nameText = getFeatureNameText(feature);
    // Label layer 仅缓存已投影 geometry 与文字，不保存 tag rule 或绘制 layer 的副本。
    labelLayer.addCandidate(Object.freeze({
      featureId: feature.feature_id,
      displayId: feature.display_id,
      ...(nameText === undefined ? {} : {nameText}),
      geometry,
      ...(feature.feature_type === "node" ? {nodeBaseRadius: nodeVisualRadius} : {}),
    }));

    // Node group 由 controller 持有，保证视觉、Relation、标签可见性与 hit geometry 同步；其余类型直接入 root。
    if (feature.feature_type === "node") nodeZoomController.registerFeature(featureLayer, getNodeCircleLayers(featureLayer));
    else rootLayer.addLayer(featureLayer);
    typeIndex[feature.feature_id] = Object.freeze({featureId: feature.feature_id, displayId: feature.display_id, layer: featureLayer, interactionLayer});
  };

  try {
    // Area 先铺底、Way 居中、Node 最上层；批次之间让出主线程，但三类之间不并行乱序。
    const groups = [options.overlayOutput.area, options.overlayOutput.way, options.overlayOutput.node] as const;
    for (const features of groups) {
      for (let index = 0; index < features.length; index += 1) {
        throwIfAborted(options.signal);
        renderFeature(features[index]);
        if ((index + 1) % RENDER_BATCH_SIZE === 0 && index + 1 < features.length) await yieldToBrowser();
      }
    }
    throwIfAborted(options.signal);
    // 所有候选注册完成后再挂载 Label Canvas，避免批量导入期间每个 Feature 都触发重排。
    rootLayer.addLayer(labelLayer);
    return Object.freeze({rootLayer, layerIndex: freezeLayerIndex(mutableLayerIndex), relationContext});
  } catch (error) {
    // 包括 AbortSignal、样式契约错误和 Canvas 初始化错误；失败不保留半张地图。
    rootLayer.remove();
    throw error;
  }
}
