import type {ReactNode} from "react";
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
  return (
    <aside className={`geomcp-popup geomcp-popup-${variant} ${className}`} aria-label={ariaLabel} aria-live={ariaLive}>
      <div className="geomcp-popup-frame" aria-hidden="true" />
      <div className="geomcp-popup-clip">
        <header className="geomcp-popup-header">
          <div className="geomcp-popup-header-content">{header}</div>
          <button className="geomcp-popup-close" type="button" aria-label={`Close ${variant} popup`} onClick={onClose}>
            <img className="geomcp-ui-icon geomcp-ui-icon-popup-close" src={UI_SVG_ASSETS.icons.close} alt="" draggable={false} aria-hidden="true" />
          </button>
        </header>
        <div className="geomcp-popup-body">{children}</div>
      </div>
      <footer className="geomcp-popup-footer" aria-hidden="true">
        <img className="geomcp-ui-decoration geomcp-ui-decoration-popup-footer-line" src={UI_SVG_ASSETS.decorations.tagBarEnd} alt="" draggable={false} />
        <img className="geomcp-ui-decoration geomcp-ui-decoration-popup-corner" src={UI_SVG_ASSETS.decorations.popup} alt="" draggable={false} />
      </footer>
    </aside>
  );
}
