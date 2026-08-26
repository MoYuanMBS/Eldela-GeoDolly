import {useEffect, useRef} from "react";
import "leaflet/dist/leaflet.css";
import "../leaflet/styles/leaflet-font.css";
import "../leaflet/styles/built-in/built-in-css.css";
import {createInteractiveMapFlow} from "./interactive-map-flow.js";
import {initializeBuiltInStyle} from "../leaflet/styles/built-in-style-loader.js";
import {calculateLeafletMetricScale} from "../leaflet/runtime/metric-scale.js";
import {initializeRuntimeStyle} from "../leaflet/styles/runtime-style-initializer.js";
import type {InteractiveMapFlowResult} from "../models/mapsurface/basemap-runtime-models.js";
import type {LeafletMetricScaleResult} from "../models/mapsurface/leaflet-renderer-models.js";
import type {RuntimeStylePlan} from "../models/mapsurface/style/runtime-style-models.js";
import type {MapSurfacePortProps, MetricScaleViewType} from "../web/map-surface-port.js";
import {createBrowserWarningReporter} from "./browser-warning-reporter.js";

// 内建 Canvas/CSS 只在地图适配层初始化，纯 UI 模块不会导入 Leaflet 样式系统。
initializeBuiltInStyle();

function isSameMetricScale(left: LeafletMetricScaleResult, right: LeafletMetricScaleResult): boolean {
  return left.label === right.label && left.distanceMeters === right.distanceMeters && left.widthPx === right.widthPx;
}

function toMetricScaleView(metricScale: LeafletMetricScaleResult): MetricScaleViewType {
  return Object.freeze({label: metricScale.label, widthPx: metricScale.widthPx});
}

/**
 * Leaflet adapter 只负责提供真实 DOM 容器并把纯数据 port 转换成 Interactive Flow 输入。
 * 异步 Flow 的完成时间可能晚于组件卸载，因此 abort 与晚到结果的 dispose 必须共同守住清理边界。
 */
export function MapSurfaceView({mapPayload, stylePayload, onMetricScaleChange, onZoomCommandsChange, onInteractionCommandsChange, onHoveredFeatureChange, onSelectedFeatureChange, onMapRuntimeReady, onMapRuntimeError}: MapSurfacePortProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const {screenshot_size: screenshotSize, center, leaflet_bbox: leafletBounds, basemap, overlay_output: overlayOutput, relation_member_features_by_relation: relationMemberFeaturesByRelation, core_visual: coreVisual, leaflet: leafletConfig} = mapPayload;
    let stylePlan: RuntimeStylePlan | null = null;
    try {
      // Basemap-only 明确跳过 RuntimeStylePlan；其他模式在创建任何 Leaflet layer 前完成样式准备。
      stylePlan = mapPayload.render_mode === "basemap_only" ? null : initializeRuntimeStyle(stylePayload, leafletConfig);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onMapRuntimeError(message);
      console.error("interactive_map_style_initialization_failed", error);
      return;
    }
    // signal 中断分批 Visual 渲染；flowResult 则负责清理由 Leaflet 持有的同步资源。
    const abortController = new AbortController();
    // reporter 的去重集合与当前 React/MapSurface 生命周期一致，后续平移缩放仍复用同一通道。
    const warningReporter = createBrowserWarningReporter();
    let flowResult: InteractiveMapFlowResult | null = null;
    let disposeMetricScaleListener: (() => void) | null = null;
    const overlay = overlayOutput !== null && relationMemberFeaturesByRelation !== null && stylePlan !== null
      ? {
          overlayOutput,
          relationMemberFeaturesByRelation,
          stylePlan,
          visualConfig: {
            render_batch_size: leafletConfig.render_batch_size,
            node_zoom: leafletConfig.node_zoom,
            relation_membership: leafletConfig.relation_membership,
            visual_limits: leafletConfig.visual_limits,
          },
          centerLongitude: center[1],
          signal: abortController.signal,
        }
      : null;
    const coreOverlay = coreVisual === null
      ? null
      : {
          coreVisual,
          nodeZoomConfig: leafletConfig.node_zoom,
          centerLongitude: center[1],
          signal: abortController.signal,
        };
    void createInteractiveMapFlow({
      mapSurface: {
        container,
        screenshotSize,
        center,
        requestedLeafletBounds: leafletBounds,
        maxZoom: leafletConfig.viewport.max_zoom,
        padding: __GEOMCP_MAP_PADDING__,
      },
      basemap,
      readyTimeoutMs: __GEOMCP_MAP_READY_TIMEOUT_MS__,
      proxyTileTimeoutMs: __GEOMCP_PROXY_TILE_TIMEOUT_MS__,
      metricScaleMaxWidthPx: __GEOMCP_MAX_SCALE_WIDTH_PX__,
      overlay,
      coreOverlay,
      interactionConfig: leafletConfig.interaction,
      interactionHandlers: {
        onHoverChange: onHoveredFeatureChange,
        onSelectionChange: onSelectedFeatureChange,
      },
      warningReporter,
    }).then((result) => {
      // Promise 可能在 React cleanup 之后才完成，此时结果从未交给组件，必须立即自行释放。
      if (abortController.signal.aborted) {
        result.dispose();
        return;
      }
      flowResult = result;
      let currentMetricScale = result.metricScale;
      let metricScaleFrameId: number | null = null;
      let updateFailureReported = false;
      const updateMetricScale = (): void => {
        metricScaleFrameId = null;
        try {
          const nextMetricScale = calculateLeafletMetricScale(result.mapSurface.map, __GEOMCP_MAX_SCALE_WIDTH_PX__);
          updateFailureReported = false;
          if (isSameMetricScale(currentMetricScale, nextMetricScale)) return;
          currentMetricScale = nextMetricScale;
          onMetricScaleChange(toMetricScaleView(nextMetricScale));
        } catch (error) {
          if (updateFailureReported) return;
          updateFailureReported = true;
          console.warn("[GeoMCP] Metric scale could not be updated after the map view changed.", error);
        }
      };
      const scheduleMetricScaleUpdate = (): void => {
        if (metricScaleFrameId !== null) return;
        metricScaleFrameId = requestAnimationFrame(updateMetricScale);
      };
      result.mapSurface.map.on("zoomend moveend", scheduleMetricScaleUpdate);
      disposeMetricScaleListener = () => {
        result.mapSurface.map.off("zoomend moveend", scheduleMetricScaleUpdate);
        if (metricScaleFrameId !== null) cancelAnimationFrame(metricScaleFrameId);
      };
      onZoomCommandsChange(Object.freeze({
        zoomIn: () => result.mapSurface.map.zoomIn(),
        zoomOut: () => result.mapSurface.map.zoomOut(),
      }));
      onInteractionCommandsChange(result.interactionResult === null ? null : Object.freeze({
        clearSelection: () => result.interactionResult?.clearSelection(),
      }));
      onMetricScaleChange(toMetricScaleView(currentMetricScale));
      onMapRuntimeReady(result.readySummary.status);
    }).catch((error: unknown) => {
      // 主动卸载产生的 AbortError 属于正常生命周期；其余初始化失败才进入浏览器诊断日志。
      if (!abortController.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        onMapRuntimeError(message);
        console.error("interactive_map_flow_failed", error);
      }
    });
    return () => {
      // 先停止 UI 订阅和异步批次，再按 Interactive Flow 内部定义的顺序释放已完成资源。
      disposeMetricScaleListener?.();
      onZoomCommandsChange(null);
      onInteractionCommandsChange(null);
      abortController.abort();
      flowResult?.dispose();
    };
  }, [mapPayload, stylePayload, onMetricScaleChange, onZoomCommandsChange, onInteractionCommandsChange, onHoveredFeatureChange, onSelectedFeatureChange, onMapRuntimeReady, onMapRuntimeError]);

  return <div ref={containerRef} className="map-surface" aria-label="Interactive map" />;
}
