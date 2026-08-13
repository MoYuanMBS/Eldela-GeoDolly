import {useEffect, useRef} from "react";
import type {LatLngBoundsLiteral, LatLngTuple} from "leaflet";
import {createInteractiveMapFlow, type InteractiveMapFlowResult} from "../browser-map-flow/interactive-map-flow.js";
import type {LeafletConfigType} from "../models/config-models.js";
import type {IdentifiedOverlayGroupsWithDisplayIdType, RelationMemberFeaturesByRelationType} from "../models/map-data-models.js";
import type {CoreVisualPayloadType} from "../models/map-payload-models.js";
import type {RuntimeStylePlan} from "../models/style/runtime-style-models.js";

/** Web 入口收到的仍是完整 Leaflet payload；组件只在边界处分配 Visual/Interaction 配置。 */
interface MapSurfaceViewProps {
  /** MapSurface 的 CSS 逻辑像素尺寸，不包含外部 Reference UI。 */
  screenshotSize: readonly [width: number, height: number];
  /** 后端已处理日期变更线语义的初始中心与请求 bbox。 */
  center: LatLngTuple;
  leafletBounds: LatLngBoundsLiteral;
  /** 两者任一缺席都表示显式 Basemap-only，不能创建不完整 Overlay。 */
  overlayOutput: IdentifiedOverlayGroupsWithDisplayIdType | null;
  relationMemberFeaturesByRelation: RelationMemberFeaturesByRelationType | null;
  /** Core 模式的原始 GeoJSON；null 时不调用 Core renderer。 */
  coreVisual: CoreVisualPayloadType;
  /** 浏览器初始化阶段已经准备好的统一运行时样式计划。 */
  stylePlan: RuntimeStylePlan | null;
  leafletConfig: LeafletConfigType;
}

/**
 * React 只负责提供真实 DOM 容器和 Interactive Flow 生命周期；初始视口仍由 MapSurface 完成。
 * 异步 Flow 的完成时间可能晚于组件卸载，因此 abort 与晚到结果的 dispose 必须共同守住清理边界。
 */
export function MapSurfaceView({screenshotSize, center, leafletBounds, overlayOutput, relationMemberFeaturesByRelation, coreVisual, stylePlan, leafletConfig}: MapSurfaceViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    // signal 中断分批 Visual 渲染；flowResult 则负责清理由 Leaflet 持有的同步资源。
    const abortController = new AbortController();
    let flowResult: InteractiveMapFlowResult | null = null;
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
        padding: __GEOMCP_MAP_PADDING__,
      },
      overlay,
      coreOverlay,
      interactionConfig: leafletConfig.interaction,
    }).then((result) => {
      // Promise 可能在 React cleanup 之后才完成，此时结果从未交给组件，必须立即自行释放。
      if (abortController.signal.aborted) {
        result.dispose();
        return;
      }
      flowResult = result;
    }).catch((error: unknown) => {
      // 主动卸载产生的 AbortError 属于正常生命周期；其余初始化失败才进入浏览器诊断日志。
      if (!abortController.signal.aborted) console.error("interactive_map_flow_failed", error);
    });
    return () => {
      // 先阻止异步批次继续，再按 Interactive Flow 内部定义的顺序释放已完成资源。
      abortController.abort();
      flowResult?.dispose();
    };
  }, [screenshotSize, center, leafletBounds, overlayOutput, relationMemberFeaturesByRelation, coreVisual, stylePlan, leafletConfig]);

  return <div ref={containerRef} className="map-surface" aria-label="Interactive map" />;
}
