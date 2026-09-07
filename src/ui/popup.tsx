import {useEffect, useRef, type ReactNode} from "react";
import {UI_SVG_ASSETS} from "../built-in-config/ui-svg.js";

interface PopupProps {
  variant: "feature" | "measurement";
  className: string;
  ariaLabel: string;
  ariaLive?: "off" | "polite";
  header: ReactNode;
  children: ReactNode;
  onClose(): void;
}

/**
 * Feature 与 Measurement 的唯一 Popup 外壳。
 * clip 只裁切 header/body；footer 与装饰留在外层，避免滚动和圆角裁切改变装饰位置。
 */
export function Popup({variant, className, ariaLabel, ariaLive = "off", header, children, onClose}: PopupProps) {
  const footerRef = useRef<HTMLElement>(null);
  const footerLineRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const footer = footerRef.current;
    const line = footerLineRef.current;
    if (footer === null || line === null) return;
    // tag-end 按自身画板绘制后只拉伸 X 轴，避免 SVG 默认等比适配让横线缩在中间。
    // 观察的是布局盒，不是 transform 后的宽度，因此不会触发尺寸反馈循环。
    const observer = new ResizeObserver(() => {
      if (line.offsetWidth > 0) line.style.setProperty("--geomcp-popup-footer-scale-x", String(footer.clientWidth / line.offsetWidth));
    });
    observer.observe(footer);
    observer.observe(line);
    return () => observer.disconnect();
  }, []);

  return (
    <aside className={`geomcp-popup geomcp-popup-${variant} ${className}`} aria-label={ariaLabel} aria-live={ariaLive}>
      <div className="geomcp-popup-frame" aria-hidden="true" />
      <div className="geomcp-popup-clip">
        <header className="geomcp-popup-header">
          <div className="geomcp-popup-header-content">{header}</div>
          <button className="geomcp-popup-close geomcp-ui-image-button" type="button" aria-label={`Close ${variant} popup`} onClick={onClose}>
            {/* 三张都是完整按钮图，CSS 仅显示当前状态的一张，不叠加在普通 icon 下。 */}
            <img className="geomcp-ui-icon geomcp-ui-icon-popup-close geomcp-ui-image-normal" src={UI_SVG_ASSETS.icons.close} alt="" draggable={false} aria-hidden="true" />
            <img className="geomcp-ui-icon geomcp-ui-icon-popup-close geomcp-ui-image-hover" src={UI_SVG_ASSETS.hover.closeHover} alt="" draggable={false} aria-hidden="true" />
            <img className="geomcp-ui-icon geomcp-ui-icon-popup-close geomcp-ui-image-pressed" src={UI_SVG_ASSETS.hover.closePressed} alt="" draggable={false} aria-hidden="true" />
          </button>
        </header>
        <div className="geomcp-popup-body">{children}</div>
      </div>
      <footer ref={footerRef} className="geomcp-popup-footer" aria-hidden="true">
        <img ref={footerLineRef} className="geomcp-ui-decoration geomcp-ui-decoration-popup-footer-line" src={UI_SVG_ASSETS.bar.tagEnd} alt="" draggable={false} />
        <img className="geomcp-ui-decoration geomcp-ui-decoration-popup-corner" src={UI_SVG_ASSETS.decorations.popup} alt="" draggable={false} />
      </footer>
    </aside>
  );
}
