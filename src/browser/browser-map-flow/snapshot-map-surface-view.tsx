import {useEffect, useRef} from "react";
import {latLngBounds, point, Projection} from "leaflet";
import "leaflet/dist/leaflet.css";
import "../leaflet/styles/leaflet-font.css";
import "../leaflet/styles/built-in/built-in-css.css";
import {initializeBuiltInStyle} from "../leaflet/styles/built-in-style-loader.js";
import {initializeRuntimeStyle} from "../leaflet/styles/runtime-style-initializer.js";
import type {SnapshotMapFlowResult} from "../../models/mapsurface/basemap-runtime-models.js";
import type {LeafletMetricScaleResult} from "../../models/mapsurface/leaflet-renderer-models.js";
import type {AiMapViewType} from "../../models/web/map-app-models.js";
import type {RuntimeStylePlan} from "../../models/mapsurface/style/runtime-style-models.js";
import type {AiMapViewCommands, SnapshotMapSurfacePortProps} from "../web/map-surface-port.js";
import {createSnapshotMapFlow} from "./snapshot-map-flow.js";
import {calculateLeafletMetricScale} from "../leaflet/runtime/metric-scale.js";
import {AppError} from "../../shared/app-error.js";

initializeBuiltInStyle();

// Leaflet bounds 的 top-right 使用最小 Y，反投影得到负纬度；取绝对值作为南北两侧的共同上限。
const maxMercatorLatitude = Math.abs(Projection.SphericalMercator.unproject(Projection.SphericalMercator.bounds.getTopRight()).lat);

// 选择最靠近指定参考经度的连续世界副本；AI 命令始终以初始 Overlay 中心为参考，而非当前视口中心。
function unwrapLngNear(lng: number, referenceLng: number): number {
  return lng + 360 * Math.round((referenceLng - lng) / 360);
}

// Zod 的地理纬度 [-90, 90] 校验不能保证 Mercator 可投影；写视口前拒绝越界，避免静默夹紧后报成功。
function requireProjectableLatitude(latitude: number): void {
  if (Math.abs(latitude) > maxMercatorLatitude) {
    throw new AppError("ai_map_projection_unsupported", "Target latitude is outside the Mercator projection range", {latitude, max_latitude: maxMercatorLatitude});
  }
}

/** HTTP Snapshot 与 App AI 共用视觉 adapter；可选命令端口只控制所属实例，Session 绑定由 App 管理。 */
export function SnapshotMapSurfaceView({mapPayload, stylePayload, onMetricScaleSettled, onMapRuntimeReady, onRecoverableWarning, onSnapshotDiagnostic, onMapRuntimeError, onAiViewCommandsChange}: SnapshotMapSurfacePortProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const {screenshot_size: screenshotSize, center, leaflet_bbox: leafletBounds, basemap, overlay_output: overlayOutput, relation_member_features_by_relation: relationMemberFeaturesByRelation, core_visual: coreVisual, leaflet: leafletConfig} = mapPayload;
    let stylePlan: RuntimeStylePlan | null = null;
    try {
      stylePlan = mapPayload.render_mode === "basemap_only" ? null : initializeRuntimeStyle(stylePayload, leafletConfig);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onMapRuntimeError(message);
      console.error("snapshot_map_style_initialization_failed", error);
      return;
    }

    const abortController = new AbortController();
    let flowResult: SnapshotMapFlowResult | null = null;
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
          allowFontFallback: true,
          onRecoverableWarning,
        }
      : null;
    const coreOverlay = coreVisual === null
      ? null
      : {
          coreVisual,
          nodeZoomConfig: leafletConfig.node_zoom,
          centerLongitude: center[1],
        };

    void createSnapshotMapFlow({
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
      minimumInitialTileSuccessRatio: __GEOMCP_SNAPSHOT_MIN_TILE_SUCCESS_RATIO__,
      metricScaleMaxWidthPx: __GEOMCP_MAX_SCALE_WIDTH_PX__,
      signal: abortController.signal,
      warningReporter: onSnapshotDiagnostic,
      overlay,
      coreOverlay,
    }).then((result) => {
      if (abortController.signal.aborted) {
        // 初始化可能在 React cleanup 后才完成；迟到结果只做释放，不发布状态或命令给新实例。
        result.dispose();
        return;
      }
      if (onAiViewCommandsChange !== undefined && result.readySummary.status !== "ready") {
        // AI 初始化失败时先释放地图，再通知页面；只有成功 runtime 才能提供视口命令。
        result.dispose();
        onMapRuntimeReady(Object.freeze({summary: result.readySummary, initialTiles: result.initialTiles, renderedFeatureCounts: result.renderedFeatureCounts}));
        return;
      }
      flowResult = result;
      const map = result.mapSurface.map;
      // 实时比例尺独立保存，后续更新不改写 flowResult 中的初始 metricScale 或 readySummary。
      let currentMetricScale = result.metricScale;
      let metricScaleFrameId: number | null = null;
      let updateFailureReported = false;
      const publishMetricScale = (scale: LeafletMetricScaleResult | null): void => {
        onMetricScaleSettled(scale === null ? null : Object.freeze({label: scale.label, widthPx: scale.widthPx, distanceMeters: scale.distanceMeters}));
      };
      const updateMetricScale = (): void => {
        metricScaleFrameId = null;
        if (abortController.signal.aborted) return;
        try {
          const scale = calculateLeafletMetricScale(map, __GEOMCP_MAX_SCALE_WIDTH_PX__);
          updateFailureReported = false;
          if (currentMetricScale?.label === scale.label && currentMetricScale.widthPx === scale.widthPx && currentMetricScale.distanceMeters === scale.distanceMeters) return;
          currentMetricScale = scale;
          publishMetricScale(scale);
        } catch (error) {
          // 计算失败时隐藏旧比例尺并继续运行；下次成功会恢复，连续失败只记一次诊断。
          if (currentMetricScale !== null) {
            currentMetricScale = null;
            publishMetricScale(null);
          }
          if (updateFailureReported) return;
          updateFailureReported = true;
          console.warn("[GeoMCP] Metric scale could not be updated after the snapshot map view changed.", error);
        }
      };
      const scheduleMetricScaleUpdate = (): void => {
        // 同次 setView 可能连续触发 zoomend/moveend，合并到一帧；仅纬度移动也可能改变实际距离。
        if (metricScaleFrameId === null) metricScaleFrameId = requestAnimationFrame(updateMetricScale);
      };
      map.on("zoomend moveend", scheduleMetricScaleUpdate);
      disposeMetricScaleListener = () => {
        map.off("zoomend moveend", scheduleMetricScaleUpdate);
        if (metricScaleFrameId !== null) cancelAnimationFrame(metricScaleFrameId);
      };
      const requireAvailableMap = (): void => {
        // 即使调用方仍持有旧命令对象，所属 effect 被取消或结果已释放后也不能访问 Leaflet。
        if (abortController.signal.aborted || flowResult !== result) throw new AppError("ai_map_unavailable", "AI map instance has been released");
      };
      const readView = (): AiMapViewType => {
        // 从 Leaflet 读取实际视口和固定逻辑尺寸；具名经纬度/bbox 不覆盖请求数据或 initial_view。
        const currentCenter = map.getCenter();
        const bounds = map.getBounds();
        const size = map.getSize();
        return {
          center: {longitude: currentCenter.lng, latitude: currentCenter.lat},
          zoom: map.getZoom(),
          visible_bounds: {south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast()},
          logical_size: {width: size.x, height: size.y},
        };
      };
      onAiViewCommandsChange?.(Object.freeze<AiMapViewCommands>({
        getView: () => { requireAvailableMap(); return readView(); },
        waitForScreenshot: async (signal) => {
          requireAvailableMap();
          const waitingSignal = AbortSignal.any([signal, abortController.signal]);
          const view = JSON.stringify(readView());
          const tiles = await result.waitForCurrentTiles(waitingSignal);
          if (tiles.success_count < tiles.total_count) onRecoverableWarning("basemap_tiles_missing");
          // Node 测量和 Label/Canvas 重绘分两帧完成；Scale 的 RAF 同步发布，页面随后确认 React 布局。
          for (let index = 0; index < 2; index += 1) {
            waitingSignal.throwIfAborted();
            await new Promise<void>((resolve, reject) => {
              const abort = (): void => { cancelAnimationFrame(frame); reject(waitingSignal.reason); };
              const frame = requestAnimationFrame(() => { waitingSignal.removeEventListener("abort", abort); resolve(); });
              waitingSignal.addEventListener("abort", abort, {once: true});
            });
          }
          requireAvailableMap();
          if (view !== JSON.stringify(readView())) throw new AppError("ai_map_view_changed", "The AI map view changed before screenshot rendering completed");
          return tiles;
        },
        fitBounds: (bbox) => {
          requireAvailableMap();
          requireProjectableLatitude(bbox.south);
          requireProjectableLatitude(bbox.north);
          try {
            // east < west 时先展开跨线跨度，再整体平移到 Overlay 的世界副本；分别展开两角会把宽 bbox 改成窄 bbox。
            const east = bbox.east < bbox.west ? bbox.east + 360 * Math.ceil((bbox.west - bbox.east) / 360) : bbox.east;
            const midpoint = bbox.west / 2 + east / 2;
            const offset = unwrapLngNear(midpoint, center[1]) - midpoint;
            const bounds = latLngBounds([[bbox.south, bbox.west + offset], [bbox.north, east + offset]]);
            map.fitBounds(bounds, {
              animate: false,
              paddingTopLeft: point(__GEOMCP_MAP_PADDING__.left, __GEOMCP_MAP_PADDING__.top),
              paddingBottomRight: point(__GEOMCP_MAP_PADDING__.right, __GEOMCP_MAP_PADDING__.bottom),
            });
            // 已有 zoom/投影限制可能使 bbox 无法完整进入固定画布，必须核验实际包含关系后才能报成功。
            if (!map.getBounds().contains(bounds)) throw new AppError("ai_map_bbox_uncovered", "The fixed AI map viewport cannot contain the entire target bbox");
            return readView();
          } catch (error) {
            throw AppError.fromUnknown(error, "ai_map_view_failed", "AI map bbox fitting failed");
          }
        },
        setCenterZoom: (input) => {
          requireAvailableMap();
          requireProjectableLatitude(input.center.latitude);
          try {
            // Leaflet 接收 [lat, lng]，zoom 沿用地图自身上限；关闭动画后直接返回实际状态，不等待新瓦片。
            map.setView([input.center.latitude, unwrapLngNear(input.center.longitude, center[1])], input.zoom, {animate: false});
            return readView();
          } catch (error) {
            throw AppError.fromUnknown(error, "ai_map_view_failed", "AI map view update failed");
          }
        },
      }));
      publishMetricScale(currentMetricScale);
      onMapRuntimeReady(Object.freeze({
        summary: result.readySummary,
        initialTiles: result.initialTiles,
        renderedFeatureCounts: result.renderedFeatureCounts,
      }));
    }).catch((error: unknown) => {
      if (abortController.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      onMapRuntimeError(message);
      console.error("snapshot_map_flow_failed", error);
    });

    return () => {
      // 先取消初始化和命令，再撤销比例尺监听/RAF，最后释放视觉与地图；迟到结果由上方 aborted 分支回收。
      abortController.abort();
      onAiViewCommandsChange?.(null);
      disposeMetricScaleListener?.();
      flowResult?.dispose();
      flowResult = null;
    };
  }, [mapPayload, stylePayload, onMetricScaleSettled, onMapRuntimeReady, onRecoverableWarning, onSnapshotDiagnostic, onMapRuntimeError, onAiViewCommandsChange]);

  return <div ref={containerRef} className="geomcp-map-surface" aria-label="Snapshot map" />;
}
