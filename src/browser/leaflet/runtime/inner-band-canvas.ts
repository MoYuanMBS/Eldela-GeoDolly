/** Polygon 内侧色带共用 Canvas renderer。 */

import {Canvas, Path} from "leaflet";
import {LEAFLET_INTERNAL_RENDER_CONFIG} from "../../built-in-config/leaflet.js";

/**
 * Leaflet 没有在公开类型中暴露 Canvas renderer 的重绘状态，但自定义 renderer 必须在
 * `_redraw()` 边界识别已经销毁的容器。这里只描述生命周期保护所需的最小内部字段。
 */
interface CanvasRedrawInternals {
  _map?: unknown;
  _ctx?: CanvasRenderingContext2D | null;
  _container?: HTMLCanvasElement | null;
  _redrawRequest?: number | null;
}

const LEAFLET_CANVAS_REDRAW = (Canvas.prototype as unknown as {_redraw(this: Canvas): void})._redraw;

/**
 * Leaflet 先生成包含 exterior 与 holes 的完整 Canvas path。注册为 inner band 的 Polygon 使用
 * even-odd clip 裁掉双倍描边的外半侧，使 options.weight 等于最终位于 Area 内部的可见宽度。
 */
export class InnerBandCanvas extends Canvas {
  private readonly innerBandLayers = new WeakSet<Path>();

  /**
   * Leaflet 的同步 `_updatePaths()` 可能把 `_redrawRequest` 置空，却留下更早排队的 RAF。
   * 如果地图随后在同一帧销毁，基类会删除 `_ctx`，旧 RAF 再调用 `_clear()` 就会访问
   * 不存在的 Canvas context。过期回调在此安全结束；仍挂载的 renderer 完全沿用基类绘制。
   */
  _redraw(): void {
    const internals = this as unknown as CanvasRedrawInternals;
    if (internals._map == null || internals._ctx == null || internals._container == null) {
      internals._redrawRequest = null;
      return;
    }
    LEAFLET_CANVAS_REDRAW.call(this);
  }

  registerInnerBand(layer: Path): void {
    // WeakSet 只标记需要特殊裁切的 Path，不延长 Feature layer 的生命周期。
    this.innerBandLayers.add(layer);
  }

  _fillStroke(context: CanvasRenderingContext2D, layer: Path): void {
    const fallback = LEAFLET_INTERNAL_RENDER_CONFIG.canvasFallback;
    const {color = fallback.color, fill = false, fillColor, fillOpacity = fallback.fillOpacity, fillRule = "evenodd", lineCap = fallback.lineCap, lineJoin = fallback.lineJoin, opacity = 1, stroke = true, weight = 0} = layer.options;
    if (this.innerBandLayers.has(layer)) {
      if (weight <= 0 || opacity <= 0) return;
      context.save();
      context.clip("evenodd");
      context.globalAlpha = opacity;
      context.strokeStyle = color;
      context.lineWidth = weight * 2;
      context.lineCap = fallback.lineCap;
      context.lineJoin = fallback.lineJoin;
      context.stroke();
      context.restore();
      return;
    }
    // 未注册的 Path 保持 Leaflet Canvas 的标准 fill/stroke 语义。
    if (fill) {
      context.globalAlpha = fillOpacity;
      context.fillStyle = fillColor ?? color;
      context.fill(fillRule === "inherit" ? "evenodd" : fillRule);
    }
    if (stroke && weight > 0) {
      context.globalAlpha = opacity;
      context.lineWidth = weight;
      context.strokeStyle = color;
      context.lineCap = lineCap === "inherit" ? fallback.lineCap : lineCap;
      context.lineJoin = lineJoin === "inherit" ? fallback.lineJoin : lineJoin;
      context.stroke();
    }
  }
}
