/** 独立 Core Overlay 的唯一 Leaflet Canvas 渲染入口。 */

import {
  CircleMarker,
  circleMarker,
  layerGroup,
  polygon,
  polyline,
  type LayerGroup,
  type Path,
} from "leaflet";
import type {CoreOverlayRendererOptions, CoreOverlayRenderResult} from "../../models/core-render.js";
import type {LeafletSpatialGeometry} from "../../models/leaflet-renderer-models.js";
import type {CanvasCircleOperation, CanvasLineOperation} from "../../models/style/base-canvas-style.js";
import {LEAFLET_INTERNAL_RENDER_CONFIG} from "../../utils/leaflet-internal-render-config.js";
import {CORE_RENDER_STYLE} from "../styles/core-render-style.js";
import {InnerBandCanvas} from "../runtime/inner-band-canvas.js";
import {prepareLeafletGeoJsonGeometry} from "../runtime/leaflet-geometry.js";
import {NodeZoomController} from "../runtime/node-zoom-controller.js";
import {parseCoreRenderableGeometries} from "./core-overlay-geometry.js";

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Core Overlay rendering was aborted");
}

function ensureCorePane(options: CoreOverlayRendererOptions): void {
  const paneName = "coreOverlay";
  const pane = options.map.getPane(paneName) ?? options.map.createPane(paneName);
  pane.style.zIndex = String(LEAFLET_INTERNAL_RENDER_CONFIG.panes.visual.coreOverlay);
  pane.style.pointerEvents = "none";
}

function basePathOptions(renderer: InnerBandCanvas) {
  return {renderer, interactive: false, bubblingMouseEvents: false} as const;
}

function createPointLayer(center: Extract<LeafletSpatialGeometry, {featureType: "node"}>["center"], operation: CanvasCircleOperation, renderer: InnerBandCanvas): CircleMarker {
  return circleMarker(center, {
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

function createLineLayer(latLngs: Extract<LeafletSpatialGeometry, {featureType: "way"}>["latLngs"], operation: CanvasLineOperation, renderer: InnerBandCanvas): Path {
  return polyline(latLngs, {
    ...basePathOptions(renderer),
    color: operation.color,
    opacity: operation.opacity,
    weight: operation.width,
    lineCap: operation.lineCap,
    lineJoin: operation.lineJoin,
  });
}

function waitForFirstPaint(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => finish(() => reject(signal?.reason instanceof Error ? signal.reason : new Error("Core Overlay rendering was aborted")));
    signal?.addEventListener("abort", onAbort, {once: true});
    requestAnimationFrame(() => finish(resolve));
  });
}

/**
 * 校验并绘制一份非 null Core GeoJSON。校验失败属于可降级的 Browser 数据边界：记录 warning、
 * 返回 null，普通 Overlay 继续；Leaflet 创建或绘制异常仍上抛给地图级失败处理。
 */
export async function renderCoreOverlay(options: CoreOverlayRendererOptions): Promise<CoreOverlayRenderResult | null> {
  throwIfAborted(options.signal);
  const parsed = parseCoreRenderableGeometries(options.coreVisual);
  if (!parsed.success) {
    console.warn("core_overlay_geojson_skipped", {
      geometry_type: typeof options.coreVisual.type === "string" ? options.coreVisual.type : null,
      reason: parsed.reason,
    });
    return null;
  }

  ensureCorePane(options);
  const renderer = new InnerBandCanvas({pane: "coreOverlay"});
  const rootLayer = layerGroup().addTo(options.map);
  rootLayer.addLayer(renderer);
  let disposed = false;

  try {
    // 同一 Canvas 内保持 Area → Line → Point 的稳定创建顺序；pane 负责与普通 Overlay 的总层级。
    for (const sourceGeometry of parsed.geometries.areas) {
      const geometry = prepareLeafletGeoJsonGeometry(sourceGeometry, options.centerLongitude);
      if (geometry.featureType !== "area") throw new Error("Core area produced non-polygon Leaflet geometry");
      const outlineLayer = polygon(geometry.latLngs, {
        ...basePathOptions(renderer),
        stroke: true,
        color: CORE_RENDER_STYLE.areaOutline.color,
        opacity: CORE_RENDER_STYLE.areaOutline.opacity,
        weight: CORE_RENDER_STYLE.areaOutline.width,
        fill: false,
        fillRule: "evenodd",
      });
      rootLayer.addLayer(outlineLayer);
      const bandLayer = polygon(geometry.latLngs, {
        ...basePathOptions(renderer),
        stroke: true,
        color: CORE_RENDER_STYLE.areaBand.color,
        opacity: CORE_RENDER_STYLE.areaBand.opacity,
        weight: CORE_RENDER_STYLE.areaBand.width,
        fill: false,
        fillRule: "evenodd",
      });
      renderer.registerInnerBand(bandLayer);
      rootLayer.addLayer(bandLayer);
    }

    for (const sourceGeometry of parsed.geometries.lines) {
      const geometry = prepareLeafletGeoJsonGeometry(sourceGeometry, options.centerLongitude);
      if (geometry.featureType !== "way") throw new Error("Core line produced non-line Leaflet geometry");
      rootLayer.addLayer(createLineLayer(geometry.latLngs, CORE_RENDER_STYLE.lineOperation, renderer));
    }

    if (parsed.geometries.points.length > 0) {
      const nodeZoomController = new NodeZoomController(options.nodeZoomConfig);
      rootLayer.addLayer(nodeZoomController);
      for (const sourceGeometry of parsed.geometries.points) {
        const geometry = prepareLeafletGeoJsonGeometry(sourceGeometry, options.centerLongitude);
        if (geometry.featureType !== "node") throw new Error("Core point produced non-point Leaflet geometry");
        const pointGroup: LayerGroup = layerGroup();
        const circle = createPointLayer(geometry.center, CORE_RENDER_STYLE.pointOperation, renderer);
        pointGroup.addLayer(circle);
        nodeZoomController.registerFeature(pointGroup, [circle]);
      }
    }

    throwIfAborted(options.signal);
    await waitForFirstPaint(options.signal);
    throwIfAborted(options.signal);
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      rootLayer.remove();
    };
    return Object.freeze({rootLayer, dispose});
  } catch (error) {
    disposed = true;
    rootLayer.remove();
    throw error;
  }
}
