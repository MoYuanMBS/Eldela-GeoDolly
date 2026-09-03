import type {ReactNode} from "react";
import {UI_SVG_ASSETS} from "../built-in-config/ui-svg.js";

interface InteractivePopupProps {
  variant: "feature" | "measurement";
  className: string;
  ariaLabel: string;
  ariaLive?: "off" | "polite";
  header: ReactNode;
  children: ReactNode;
  onClose(): void;
}

/** Feature 与 Measurement 只共享稳定视觉外壳，业务内容和状态仍由各自组件负责。 */
export function InteractivePopup({variant, className, ariaLabel, ariaLive = "off", header, children, onClose}: InteractivePopupProps) {
  return (
    <aside className={`geomcp-interactive-popup geomcp-interactive-popup-${variant} ${className}`} aria-label={ariaLabel} aria-live={ariaLive}>
      <header className="geomcp-interactive-popup-header">
        <div className="geomcp-interactive-popup-header-content">{header}</div>
        <button className="geomcp-interactive-popup-close" type="button" aria-label={`Close ${variant} popup`} onClick={onClose}>
          <img className="geomcp-ui-icon geomcp-ui-icon-popup-close" src={UI_SVG_ASSETS.icons.close} alt="" draggable={false} aria-hidden="true" />
        </button>
      </header>
      <div className="geomcp-interactive-popup-scroll">{children}</div>
      <footer className="geomcp-interactive-popup-footer" aria-hidden="true">
        <img className="geomcp-ui-decoration geomcp-ui-decoration-popup-footer" src={UI_SVG_ASSETS.decorations.popup} alt="" draggable={false} />
      </footer>
    </aside>
  );
}
