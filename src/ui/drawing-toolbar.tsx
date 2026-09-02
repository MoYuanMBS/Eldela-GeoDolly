import {UI_SVG_ASSETS} from "../built-in-config/ui-svg.js";
import type {MeasureToolModeType} from "../models/measure-tools/measure-tool-models.js";

interface DrawingToolbarProps {
  mode: MeasureToolModeType;
  disabled: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  onModeChange(mode: MeasureToolModeType): void;
}

const TOOLBAR_CONTROLS = [
  {kind: "command", command: "zoom_in", classSuffix: "zoom-in", label: "Zoom in", text: "+"},
  {kind: "command", command: "zoom_out", classSuffix: "zoom-out", label: "Zoom out", text: "−"},
  {kind: "mode", mode: "draw_path", classSuffix: "draw-path", label: "Draw line or polygon", iconUrl: UI_SVG_ASSETS.icons.lineTool},
  {kind: "mode", mode: "draw_circle", classSuffix: "draw-circle", label: "Draw circle", iconUrl: UI_SVG_ASSETS.icons.roundTool},
] as const;

/** 只发出 mode/zoom command 的自定义工具栏；Leaflet 与 Measure Controller 始终留在 port 另一侧。 */
export function DrawingToolbar({mode, disabled, onZoomIn, onZoomOut, onModeChange}: DrawingToolbarProps) {
  return (
    <nav className={`geomcp-tool-bar geomcp-tool-bar-mode-${mode.replace("_", "-")}`} aria-label="Map and drawing tools" data-drawing-mode={mode}>
      <img className="geomcp-ui-decoration geomcp-ui-decoration-tool-bar" src={UI_SVG_ASSETS.decorations.toolBar} alt="" draggable={false} aria-hidden="true" />
      <div className="geomcp-tool-bar-controls">
        {TOOLBAR_CONTROLS.map((control, index) => {
          const isModeControl = "mode" in control;
          const isActive = isModeControl && mode === control.mode;
          return (
            <div className={`geomcp-tool-bar-control geomcp-tool-bar-control-${control.classSuffix}`} key={isModeControl ? control.mode : control.command}>
              {index === 0 ? null : (
                <span className={`geomcp-tool-bar-divider geomcp-tool-bar-divider-before-${control.classSuffix}`} aria-hidden="true">
                  <img className="geomcp-ui-decoration geomcp-ui-decoration-tool-divider" src={UI_SVG_ASSETS.decorations.toolBarDivider} alt="" draggable={false} />
                </span>
              )}
              <button
                className={`geomcp-tool-bar-button geomcp-tool-bar-button-${control.classSuffix}${isActive ? " geomcp-tool-bar-button-active" : ""}${disabled ? " geomcp-tool-bar-button-disabled" : ""}`}
                type="button"
                aria-label={control.label}
                aria-pressed={isModeControl ? isActive : undefined}
                disabled={disabled}
                onClick={() => {
                  if (isModeControl) {
                    onModeChange(isActive ? "idle" : control.mode);
                  } else if (control.command === "zoom_in") {
                    onZoomIn();
                  } else {
                    onZoomOut();
                  }
                }}
              >
                {isModeControl
                  ? <img className={`geomcp-ui-icon geomcp-ui-icon-tool geomcp-ui-icon-tool-${control.classSuffix}`} src={control.iconUrl} alt="" draggable={false} aria-hidden="true" />
                  : <span className={`geomcp-tool-bar-zoom-symbol geomcp-tool-bar-zoom-symbol-${control.classSuffix}`} aria-hidden="true">{control.text}</span>}
              </button>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
