/**
 * Leaflet Overlay 的总编排入口。
 *
 * 上游必须已经完成 RuntimeStylePlan、display_id、连续世界参考中心和 Relation 成员字典准备。
 * 本模块按 Area → Way → Node 单次遍历：转换 geometry、解析样式、创建视觉层、追加 Relation、
 * 注册视觉测量与标签候选，并在首次可靠测量完成后返回纯 Visual result。
 *
 * Canvas 与 SVG/CSS 只在实际绘制处分流；透明 hit geometry 由 Interactive flow 后续独立附加。
 */

import {
  CircleMarker,
  Path,
  canvas,
  circleMarker,
  layerGroup,
  polygon,
  polyline,
  svg,
  type LayerGroup,
  type Map as LeafletMap,
  type Renderer,
} from "leaflet";
import type {IdentifiedOverlaySpatialFeatureWithDisplayIdType} from "../../../models/common/map-data-models.js";
import type {
  LeafletSpatialGeometry,
  MutableOverlayFeatureLayerIndex,
  MutableOrderedOverlayFeatureLayers,
  OverlayBasePaneName,
  OverlayFeatureLayerEntry,
  OverlayFeatureLayerIndex,
  OverlayFeatureRenderers,
  OverlayRendererCollection,
  OverlayRendererOptions,
  OverlayRenderResult,
  OverlaySpecialPaneName,
  OrderedOverlayFeatureLayers,
} from "../../../models/mapsurface/leaflet-renderer-models.js";
import type {CanvasBaseStyleRecipe, CanvasDrawOperation, CanvasSpatialFeatureType} from "../../../models/mapsurface/style/base-canvas-style.js";
import type {ResolvedBaseStyle, RuntimeStylePlan, RuntimeStyleRule} from "../../../models/mapsurface/style/runtime-style-models.js";
import {AppError} from "../../../shared/app-error.js";
import {LEAFLET_INTERNAL_RENDER_CONFIG} from "../../built-in-config/leaflet.js";
import {resolveFeatureStyle} from "./feature-style-resolver.js";
import {InnerBandCanvas} from "./inner-band-canvas.js";
import {prepareLeafletGeometry} from "./leaflet-geometry.js";
import {NodeZoomController} from "./node-zoom-controller.js";
import {OverlayLabelLayer} from "./overlay-label-layer.js";
import {OverlayVisualMeasurementController} from "./overlay-visual-measurement.js";
import {buildRelationTranslucentContext} from "./relation-translucent-context.js";

/**
 * 只建立 Snapshot 与 Interactive 共用的视觉 panes。
 * Interaction pane 必须延迟到 attach 阶段创建，否则截图流程会无意引入命中层的 DOM 边界。
 */
function ensureVisualPanes(map: LeafletMap): void {
  for (const [paneName, zIndex] of Object.entries(LEAFLET_INTERNAL_RENDER_CONFIG.panes.visual)) {
    // Core renderer 独立创建自己的 pane；Non-core 不能因普通 Overlay 初始化而出现空 Core pane。
    if (paneName === "coreOverlay") continue;
    const pane = map.getPane(paneName) ?? map.createPane(paneName);
    pane.style.zIndex = String(zIndex);
    // Snapshot 与 Interactive 共用的视觉层一律不接事件；interaction pane 由 attach 阶段另建。
    pane.style.pointerEvents = "none";
  }
}

/** 一个 Feature 类型同时准备 Canvas/SVG 两条路径，但未命中的 renderer 不会挂载 DOM。 */
function createFeatureRenderers(basePane: OverlayBasePaneName, specialPane: OverlaySpecialPaneName): OverlayFeatureRenderers {
  return {
    baseCanvas: canvas({pane: basePane}),
    baseSvg: svg({pane: basePane}),
    specialCanvas: canvas({pane: specialPane}),
    specialSvg: svg({pane: specialPane}),
  };
}

/** Renderer 实例先轻量创建，直到首条实际绘制命中才挂到 map 并分配 DOM/Canvas。 */
function createRenderers(): OverlayRendererCollection {
  const area = createFeatureRenderers("areaBase", "areaSpecial");
  const way = createFeatureRenderers("wayBase", "waySpecial");
  const node = createFeatureRenderers("nodeBase", "nodeSpecial");
  const relationMembership = new InnerBandCanvas({pane: "relationMembership"});
  return {node, way, area, relationMembership, activated: new Set<Renderer>()};
}

/** 根组持有所有实际启用的 renderer，失败或卸载时不会遗留空 Canvas/SVG。 */
function activateRenderer(rootLayer: LayerGroup, renderers: OverlayRendererCollection, renderer: Renderer): void {
  if (renderers.activated.has(renderer)) return;
  renderers.activated.add(renderer);
  rootLayer.addLayer(renderer);
}

function getCanvasRecipe(plan: RuntimeStylePlan, styleId: string, featureType: CanvasSpatialFeatureType): CanvasBaseStyleRecipe {
  // RuntimeStylePlan 理论上已校验默认 ID；这里继续守住 rule styleId 与 Feature 类型的运行时边界。
  const recipe = plan.canvasStyles[styleId];
  if (recipe === undefined) throw new AppError("missing_render_style", `Canvas style "${styleId}" was not loaded`);
  if (recipe.featureType !== featureType) throw new AppError("invalid_render_style", `Canvas style "${styleId}" targets ${recipe.featureType}, not ${featureType}`);
  return recipe;
}

function basePathOptions(renderer: Renderer) {
  // 所有可见重复绘制都禁止事件，避免一次点击命中 casing、Base、addon 等多条 Path。
  return {renderer, interactive: false, bubblingMouseEvents: false} as const;
}

/** 把一条抽象 Canvas operation 转为对应的 Leaflet Path；不处理 rule 优先级。 */
function createCanvasOperationLayer(geometry: LeafletSpatialGeometry, operation: CanvasDrawOperation, renderer: Renderer): Path {
  if (geometry.featureType === "node") {
    if (operation.kind !== "circle") throw new AppError("invalid_render_style", `Node Canvas recipe cannot contain ${operation.kind} operation`);
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
    if (operation.kind !== "line") throw new AppError("invalid_render_style", `Way Canvas recipe cannot contain ${operation.kind} operation`);
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
  if (operation.kind !== "area") throw new AppError("invalid_render_style", `Area Canvas recipe cannot contain ${operation.kind} operation`);
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
  if (recipe.featureType !== geometry.featureType) throw new AppError("invalid_render_style", `Canvas recipe targets ${recipe.featureType}, not ${geometry.featureType}`);
  // 数组顺序即同一 Base 内的绘制顺序，例如道路 casing 必须先于内部主线。
  return recipe.operations.map((operation) => createCanvasOperationLayer(geometry, operation, renderer));
}

/** CSS rule 没有几何尺寸，选择默认 recipe 的最大 operation 作为 SVG Path 的稳定 geometry 种子。 */
function getLargestOperation(recipe: CanvasBaseStyleRecipe): CanvasDrawOperation {
  if (recipe.operations.length === 0) throw new AppError("invalid_render_style", `Default ${recipe.featureType} Canvas recipe has no operations`);
  if (recipe.featureType === "node") {
    return recipe.operations.reduce((largest, operation) => operation.kind === "circle" && (largest.kind !== "circle" || operation.radius > largest.radius) ? operation : largest);
  }
  if (recipe.featureType === "way") {
    return recipe.operations.reduce((largest, operation) => operation.kind === "line" && (largest.kind !== "line" || operation.width > largest.width) ? operation : largest);
  }
  const areaOperation = recipe.operations.find((operation) => operation.kind === "area");
  if (areaOperation === undefined) throw new AppError("invalid_render_style", "Default area Canvas recipe has no area operation");
  return areaOperation;
}

/**
 * CSS path 仍需要稳定 geometry/radius；默认 recipe 只提供形状与兜底 presentation attributes，
 * 最终颜色等由 class selector 覆盖。Canvas 不读取这里的 CSS 计算结果。
 */
function createCssLayer(geometry: LeafletSpatialGeometry, defaultRecipe: CanvasBaseStyleRecipe, className: string, renderLayer: "border" | "base" | "translucent", renderer: Renderer): Path {
  const operation = getLargestOperation(defaultRecipe);
  const commonOptions = {...basePathOptions(renderer), className: `geomcp-user-overlay ${className}`};
  const seed = LEAFLET_INTERNAL_RENDER_CONFIG.cssGeometrySeed;
  const layerOpacity = renderLayer === "translucent" ? seed.translucentOpacity : 1;
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
      fillOpacity: renderLayer === "translucent" ? operation.fillOpacity * seed.translucentOpacity : operation.fillOpacity,
    });
  }
  if (geometry.featureType === "way" && operation.kind === "line") {
    return polyline(geometry.latLngs, {
      ...commonOptions,
      color: operation.color,
      opacity: layerOpacity,
      weight: operation.width + (renderLayer === "border" ? seed.wayBorderExtraWidthPx : 0),
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
      weight: operation.strokeWidth + (renderLayer === "border" ? seed.areaBorderExtraWidthPx : 0),
      fill: renderLayer !== "border",
      fillColor: operation.fillColor,
      fillOpacity: renderLayer === "translucent" ? operation.fillOpacity * seed.translucentOpacity : operation.fillOpacity,
      fillRule: "evenodd",
    });
  }
  throw new AppError("invalid_render_style", `Default ${defaultRecipe.featureType} Canvas recipe cannot seed a CSS ${geometry.featureType} layer`);
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
function renderBase(rootLayer: LayerGroup, group: LayerGroup, geometry: LeafletSpatialGeometry, base: ResolvedBaseStyle, defaultRecipe: CanvasBaseStyleRecipe, plan: RuntimeStylePlan, featureRenderers: OverlayFeatureRenderers, renderers: OverlayRendererCollection, cssLayers: Array<Path>): CanvasBaseStyleRecipe | null {
  if (base.kind === "css") {
    activateRenderer(rootLayer, renderers, featureRenderers.baseSvg);
    const cssLayer = createCssLayer(geometry, defaultRecipe, base.className, "base", featureRenderers.baseSvg);
    cssLayers.push(cssLayer);
    group.addLayer(cssLayer);
    return null;
  }
  const recipe = getCanvasRecipe(plan, base.styleId, geometry.featureType);
  activateRenderer(rootLayer, renderers, featureRenderers.baseCanvas);
  addLayers(group, createCanvasRecipeLayers(geometry, recipe, featureRenderers.baseCanvas));
  return recipe;
}

/** Border/Translucent 已在 resolver 中按 effectType 去重，这里只按 planOrder 顺序执行绘制。 */
function renderAddonRules(rootLayer: LayerGroup, group: LayerGroup, geometry: LeafletSpatialGeometry, rules: ReadonlyArray<RuntimeStyleRule>, defaultRecipe: CanvasBaseStyleRecipe, plan: RuntimeStylePlan, canvasRenderer: Renderer, svgRenderer: Renderer, renderers: OverlayRendererCollection, cssLayers: Array<Path>): void {
  for (const rule of rules) {
    if (rule.kind === "css") {
      activateRenderer(rootLayer, renderers, svgRenderer);
      const cssLayer = createCssLayer(geometry, defaultRecipe, rule.className, rule.renderLayer, svgRenderer);
      cssLayers.push(cssLayer);
      group.addLayer(cssLayer);
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
function renderRelationMembership(rootLayer: LayerGroup, group: LayerGroup, geometry: LeafletSpatialGeometry, mainAreaColor: string | undefined, options: OverlayRendererOptions, renderers: OverlayRendererCollection): void {
  const style = options.stylePlan.relationMembershipStyle;
  const dimensions = options.visualConfig.relation_membership;
  const renderer = renderers.relationMembership;
  activateRenderer(rootLayer, renderers, renderer);
  if (geometry.featureType === "node") {
    group.addLayer(circleMarker(geometry.center, {
      ...basePathOptions(renderer),
      radius: dimensions.node_radius_px,
      stroke: true,
      color: style.defaultColor,
      opacity: style.opacity,
      weight: dimensions.node_stroke_width_px,
      fill: false,
    }));
    return;
  }
  if (geometry.featureType === "way") {
    group.addLayer(polyline(geometry.latLngs, {
      ...basePathOptions(renderer),
      color: style.defaultColor,
      opacity: style.opacity,
      weight: dimensions.way_width_px,
      lineCap: "round",
      lineJoin: "round",
    }));
    return;
  }

  const totalWidth = dimensions.area_band_total_width_px;
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
  if (!signal?.aborted) return;
  if (signal.reason instanceof AppError) throw signal.reason;
  const message = signal.reason instanceof Error ? signal.reason.message : signal.reason === undefined ? "Overlay rendering was aborted" : String(signal.reason);
  throw new AppError("overlay_render_aborted", message, null, signal.reason instanceof Error ? {cause: signal.reason} : undefined);
}

/** setTimeout(0) 建立新的 task，让浏览器有机会处理绘制、输入和 React 生命周期。 */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function freezeLayerIndex(index: MutableOverlayFeatureLayerIndex): OverlayFeatureLayerIndex {
  // feature_type 是第一层命名空间，避免 node/way/area 的 canonical feature_id 相互碰撞。
  return Object.freeze({
    node: Object.freeze(index.node),
    way: Object.freeze(index.way),
    area: Object.freeze(index.area),
  });
}

function freezeOrderedLayers(layers: MutableOrderedOverlayFeatureLayers): OrderedOverlayFeatureLayers {
  // 拷贝后冻结，避免 Renderer 内部可写数组在返回后改变 Interaction 的命中顺序。
  return Object.freeze({
    node: Object.freeze([...layers.node]),
    way: Object.freeze([...layers.way]),
    area: Object.freeze([...layers.area]),
  });
}

function hasFeatureEntry(index: MutableOverlayFeatureLayerIndex, featureType: CanvasSpatialFeatureType, featureId: string): boolean {
  if (featureType === "node") return index.node[featureId] !== undefined;
  if (featureType === "way") return index.way[featureId] !== undefined;
  return index.area[featureId] !== undefined;
}

/**
 * Feature 与 geometry 在运行时再次按同一个 discriminator 对齐，之后同时写入 typed index 与
 * 显式有序数组。Interaction 只消费后者，不让普通对象枚举顺序影响点击优先级。
 */
function registerFeatureEntry(
  index: MutableOverlayFeatureLayerIndex,
  orderedLayers: MutableOrderedOverlayFeatureLayers,
  feature: IdentifiedOverlaySpatialFeatureWithDisplayIdType,
  geometry: LeafletSpatialGeometry,
  layer: LayerGroup,
): void {
  if (feature.feature_type === "node" && geometry.featureType === "node") {
    const entry = Object.freeze({featureId: feature.feature_id, displayId: feature.display_id, featureType: "node", geometry, layer}) satisfies OverlayFeatureLayerEntry;
    index.node[feature.feature_id] = entry;
    orderedLayers.node.push(entry);
    return;
  }
  if (feature.feature_type === "way" && geometry.featureType === "way") {
    const entry = Object.freeze({featureId: feature.feature_id, displayId: feature.display_id, featureType: "way", geometry, layer}) satisfies OverlayFeatureLayerEntry;
    index.way[feature.feature_id] = entry;
    orderedLayers.way.push(entry);
    return;
  }
  if (feature.feature_type === "area" && geometry.featureType === "area") {
    const entry = Object.freeze({featureId: feature.feature_id, displayId: feature.display_id, featureType: "area", geometry, layer}) satisfies OverlayFeatureLayerEntry;
    index.area[feature.feature_id] = entry;
    orderedLayers.area.push(entry);
    return;
  }
  throw new AppError("invalid_overlay_geometry", `Overlay ${feature.feature_type} feature_id "${feature.feature_id}" produced mismatched ${geometry.featureType} geometry`);
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

/** 收集 Node 的全部可见 CircleMarker，交给 zoom controller 使用相同比例缩放。 */
function getNodeCircleLayers(group: LayerGroup): Array<CircleMarker> {
  const circles: Array<CircleMarker> = [];
  group.eachLayer((layer) => {
    if (layer instanceof CircleMarker) circles.push(layer);
  });
  return circles;
}

/** 快照全部视觉 Path；后续独立创建的透明 hit Path 不会进入这份测量输入。 */
function getVisualPathLayers(group: LayerGroup): Array<Path> {
  const paths: Array<Path> = [];
  group.eachLayer((layer) => {
    if (layer instanceof Path) paths.push(layer);
  });
  return paths;
}

/**
 * 按 Area → Way → Node 顺序分批渲染；每个 Feature 当场完成 projection、rule resolve、
 * Base/addon/membership、Visual measurement、Label candidate 和 typed layer index 注册，
 * 不保存全量样式匹配中间结果，也不额外遍历 Overlay。
 */
export async function renderOverlay(options: OverlayRendererOptions): Promise<OverlayRenderResult> {
  // 先固定 pane 和共享生命周期根节点；后续任一步失败都只需移除 rootLayer。
  ensureVisualPanes(options.map);
  const renderers = createRenderers();
  const rootLayer = layerGroup().addTo(options.map);
  const nodeZoomController = new NodeZoomController(options.visualConfig.node_zoom);
  const measurementController = new OverlayVisualMeasurementController(options.visualConfig);
  const labelLayer = new OverlayLabelLayer();
  // 注册顺序刻意保持 Node zoom 在前、视觉测量在后；同一次 zoomend 先得到最终圆半径，再读取尺寸。
  rootLayer.addLayer(nodeZoomController);
  rootLayer.addLayer(measurementController);
  // Relation 反向索引只构建一次，renderFeature 内只按 type + feature_id 查询。
  const relationContext = buildRelationTranslucentContext(options.overlayOutput.relation, options.relationMemberFeaturesByRelation, options.stylePlan);
  const mutableLayerIndex: MutableOverlayFeatureLayerIndex = {
    node: Object.create(null) as MutableOverlayFeatureLayerIndex["node"],
    way: Object.create(null) as MutableOverlayFeatureLayerIndex["way"],
    area: Object.create(null) as MutableOverlayFeatureLayerIndex["area"],
  };
  const mutableOrderedLayers: MutableOrderedOverlayFeatureLayers = {node: [], way: [], area: []};

  const renderFeature = (feature: IdentifiedOverlaySpatialFeatureWithDisplayIdType): void => {
    if (hasFeatureEntry(mutableLayerIndex, feature.feature_type, feature.feature_id)) throw new AppError("duplicate_overlay_feature", `Duplicate ${feature.feature_type} feature_id "${feature.feature_id}" in Overlay renderer`);
    const geometry = prepareLeafletGeometry(feature, options.centerLongitude);
    const resolvedStyle = resolveFeatureStyle(feature, options.stylePlan);
    const featureRenderers = renderers[feature.feature_type];
    const defaultRecipe = getCanvasRecipe(options.stylePlan, options.stylePlan.defaultBaseStyleIds[feature.feature_type], feature.feature_type);
    // 一个 FeatureGroup 只聚合跨 pane 的视觉 Paths；透明 hit Path 由 Interactive result 独立持有。
    const featureLayer = layerGroup();
    const cssLayers: Array<Path> = [];

    // Pane 决定跨层覆盖关系；同一阶段内仍保持 Border → Base → Translucent 的稳定创建顺序。
    renderAddonRules(rootLayer, featureLayer, geometry, resolvedStyle.border, defaultRecipe, options.stylePlan, featureRenderers.baseCanvas, featureRenderers.baseSvg, renderers, cssLayers);
    const selectedBaseRecipe = renderBase(rootLayer, featureLayer, geometry, resolvedStyle.base, defaultRecipe, options.stylePlan, featureRenderers, renderers, cssLayers);
    renderAddonRules(rootLayer, featureLayer, geometry, resolvedStyle.translucent, defaultRecipe, options.stylePlan, featureRenderers.specialCanvas, featureRenderers.specialSvg, renderers, cssLayers);

    const relationFeatureIds = relationContext.membershipByFeatureId[feature.feature_type][feature.feature_id];
    if (relationFeatureIds !== undefined && relationFeatureIds.length > 0) {
      renderRelationMembership(rootLayer, featureLayer, geometry, feature.feature_type === "area" ? selectedBaseRecipe?.mainColor : undefined, options, renderers);
    }

    const visualLayers = getVisualPathLayers(featureLayer);
    const nodeVisualCircles = feature.feature_type === "node" ? getNodeCircleLayers(featureLayer) : [];
    measurementController.registerFeature(
      feature.feature_id,
      feature.feature_type,
      visualLayers,
      cssLayers,
    );

    const nameText = getFeatureNameText(feature);
    // Label layer 仅缓存已投影 geometry 与文字，不保存 tag rule 或绘制 layer 的副本。
    labelLayer.addCandidate(Object.freeze({
      featureId: feature.feature_id,
      displayId: feature.display_id,
      ...(nameText === undefined ? {} : {nameText}),
      geometry,
    }));
    // Label 只订阅统一 measurement source；不在自身或 Visual entry 中保存另一套推导逻辑。
    measurementController.subscribe(feature.feature_type, feature.feature_id, (measurement) => {
      labelLayer.setFeatureVisualMeasurement(feature.feature_type, feature.feature_id, measurement);
    });

    // Node group 由 zoom controller 持有，低 zoom 时只卸载视觉层；Interaction 会根据零尺寸测量移除 hit Path。
    if (feature.feature_type === "node") nodeZoomController.registerFeature(featureLayer, nodeVisualCircles);
    else rootLayer.addLayer(featureLayer);
    registerFeatureEntry(mutableLayerIndex, mutableOrderedLayers, feature, geometry, featureLayer);
  };

  try {
    // Area 先铺底、Way 居中、Node 最上层；批次之间让出主线程，但三类之间不并行乱序。
    const groups = [options.overlayOutput.area, options.overlayOutput.way, options.overlayOutput.node] as const;
    for (const features of groups) {
      for (let index = 0; index < features.length; index += 1) {
        throwIfAborted(options.signal);
        renderFeature(features[index]);
        if ((index + 1) % options.visualConfig.render_batch_size === 0 && index + 1 < features.length) await yieldToBrowser();
      }
    }
    throwIfAborted(options.signal);
    // CSS Path 全部挂载后批量读视觉宽度；返回前每个 Feature 必须已有可靠 measurement。
    // 字体同时在首个 Label Canvas 创建前完成下载与解码，不额外串行增加首帧等待。
    const [, labelFontStatus] = await Promise.all([
      measurementController.synchronizeAfterMount(),
      labelLayer.prepareFont(document, options.allowFontFallback ?? false),
    ]);
    if (labelFontStatus === "fallback") options.onRecoverableWarning?.("label_font_fallback");
    throwIfAborted(options.signal);
    // 所有候选注册完成后再挂载 Label Canvas，避免批量导入期间每个 Feature 都触发重排。
    rootLayer.addLayer(labelLayer);
    let disposed = false;
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      measurementController.dispose();
      rootLayer.remove();
    };
    return Object.freeze({
      rootLayer,
      layerIndex: freezeLayerIndex(mutableLayerIndex),
      orderedLayers: freezeOrderedLayers(mutableOrderedLayers),
      relationContext,
      measurementController,
      dispose,
    });
  } catch (error) {
    // 包括 AbortSignal、样式契约错误和 Canvas 初始化错误；失败不保留半张地图。
    measurementController.dispose();
    rootLayer.remove();
    throw AppError.fromUnknown(error, "overlay_render", "Overlay rendering failed");
  }
}
