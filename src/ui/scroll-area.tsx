import {useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode} from "react";
import {UI_BUILT_IN_CONFIG} from "../built-in-config/ui.js";
import {UI_SVG_ASSETS} from "../built-in-config/ui-svg.js";

interface ScrollAreaProps {
  className: string;
  ariaLabel: string;
  id?: string;
  children: ReactNode;
}

const config = UI_BUILT_IN_CONFIG.scrollbar;
const scrollbarStyle = {
  "--geomcp-scrollbar-width": `${config.widthPx}px`,
  "--geomcp-scrollbar-button-size": `${config.buttonSizePx}px`,
  "--geomcp-scrollbar-button-icon-width": `${config.buttonIconWidthPx}px`,
  "--geomcp-scrollbar-thumb-width": `${config.thumbWidthPx}px`,
  "--geomcp-scrollbar-decoration-width": `${config.thumbDecorationWidthPx}px`,
  "--geomcp-scrollbar-border-width": `${config.borderWidthPx}px`,
  "--geomcp-scrollbar-track-width": `${config.trackWidthPx}px`,
  "--geomcp-scrollbar-track-dash": `${config.trackDashPx}px`,
  "--geomcp-scrollbar-track-gap": `${config.trackGapPx}px`,
} as CSSProperties;

/** 原生容器负责滚动；自绘栏只映射 scrollTop，不接管地图、外层 iframe 或横向滚动。 */
export function ScrollArea({className, ariaLabel, id, children}: ScrollAreaProps) {
  const generatedId = useId();
  const viewportId = `${id ?? generatedId}-viewport`;
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{pointerId: number; grabRatio: number} | null>(null);
  const [metrics, setMetrics] = useState({visible: false, height: 0, top: 0, value: 0, max: 0});

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    const track = trackRef.current;
    if (viewport === null || content === null || track === null) return;
    let frame: number | null = null;
    const measure = (): void => {
      frame = null;
      const max = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const value = Math.max(0, Math.min(max, viewport.scrollTop));
      const trackHeight = track.clientHeight;
      const height = Math.min(trackHeight, Math.max(config.minThumbHeightPx, trackHeight * viewport.clientHeight / Math.max(1, viewport.scrollHeight)));
      const top = max === 0 ? 0 : value / max * Math.max(0, trackHeight - height);
      const next = {visible: max > 0, height, top, value, max};
      setMetrics(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    // 滚动与 ResizeObserver 共用一帧合并；树展开、字体换行、Popup 内容更新都重新测量。
    const schedule = (): void => { if (frame === null) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    observer.observe(content);
    observer.observe(track);
    viewport.addEventListener("scroll", schedule, {passive: true});
    schedule();
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
      dragRef.current = null;
    };
  }, []);

  const scrollBy = (amount: number): void => {
    const viewport = viewportRef.current;
    if (viewport !== null) viewport.scrollTop += amount;
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    switch (event.key) {
      case "ArrowUp": scrollBy(-config.scrollStepPx); break;
      case "ArrowDown": scrollBy(config.scrollStepPx); break;
      case "PageUp": scrollBy(-viewport.clientHeight); break;
      case "PageDown": scrollBy(viewport.clientHeight); break;
      case "Home": viewport.scrollTop = 0; break;
      case "End": viewport.scrollTop = viewport.scrollHeight; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const moveThumb = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (drag === null || drag.pointerId !== event.pointerId || viewport === null || track === null) return;
    const bounds = track.getBoundingClientRect();
    if (bounds.height <= 0 || track.clientHeight <= metrics.height) return;
    // iframe 会缩放完整 wrapper；指针是屏幕坐标，必须还原为布局像素再计算滚动比例。
    const localY = (event.clientY - bounds.top) * track.clientHeight / bounds.height;
    const ratio = (localY - drag.grabRatio * metrics.height) / (track.clientHeight - metrics.height);
    viewport.scrollTop = Math.max(0, Math.min(1, ratio)) * Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div id={id} className={`geomcp-scroll-area ${className}`} style={scrollbarStyle}>
      <div ref={viewportRef} id={viewportId} className="geomcp-scroll-area-viewport" tabIndex={0} role="region" aria-label={ariaLabel}>
        <div ref={contentRef} className="geomcp-scroll-area-content">{children}</div>
      </div>
      <div className="geomcp-scrollbar" hidden={!metrics.visible}>
        <button className="geomcp-scrollbar-button geomcp-scrollbar-button-up" type="button" aria-label="Scroll up" aria-controls={viewportId} aria-disabled={metrics.value <= 0} onClick={() => scrollBy(-config.scrollStepPx)}>
          <img className="geomcp-ui-icon geomcp-ui-icon-scroll-button" src={UI_SVG_ASSETS.scrollbar.button} alt="" draggable={false} />
        </button>
        <div ref={trackRef} className="geomcp-scrollbar-track" onPointerDown={event => {
          if (event.button !== 0 || event.target !== event.currentTarget) return;
          event.preventDefault();
          const bounds = event.currentTarget.getBoundingClientRect();
          const thumbTop = bounds.top + metrics.top * bounds.height / Math.max(1, event.currentTarget.clientHeight);
          scrollBy((event.clientY < thumbTop ? -1 : 1) * (viewportRef.current?.clientHeight ?? 0));
        }}>
          <div className="geomcp-scrollbar-thumb" role="scrollbar" tabIndex={0} aria-label={`${ariaLabel} scroll position`} aria-orientation="vertical" aria-controls={viewportId} aria-valuemin={0} aria-valuemax={Math.ceil(metrics.max)} aria-valuenow={Math.round(metrics.value)}
            style={{height: metrics.height, transform: `translateY(${metrics.top}px)`}}
            onKeyDown={handleKeyDown}
            onPointerDown={event => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              const bounds = event.currentTarget.getBoundingClientRect();
              dragRef.current = {pointerId: event.pointerId, grabRatio: bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height : 0};
              event.currentTarget.focus({preventScroll: true});
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={moveThumb} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { dragRef.current = null; }}>
            <img className="geomcp-ui-decoration geomcp-ui-decoration-scroll-thumb" src={UI_SVG_ASSETS.scrollbar.decoration} alt="" draggable={false} />
          </div>
        </div>
        <button className="geomcp-scrollbar-button geomcp-scrollbar-button-down" type="button" aria-label="Scroll down" aria-controls={viewportId} aria-disabled={metrics.value >= metrics.max} onClick={() => scrollBy(config.scrollStepPx)}>
          <img className="geomcp-ui-icon geomcp-ui-icon-scroll-button" src={UI_SVG_ASSETS.scrollbar.button} alt="" draggable={false} />
        </button>
      </div>
    </div>
  );
}
