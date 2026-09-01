import toolBarDecorationUrl from "../../assets/ui/decorations/tool-bar.svg";
import toolBarDividerUrl from "../../assets/ui/decorations/tool-bar-divider.svg";
import lineToolIconUrl from "../../assets/ui/icons/line-tool.svg";
import circleToolIconUrl from "../../assets/ui/icons/round-tool.svg";
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
  {kind: "mode", mode: "draw_path", classSuffix: "draw-path", label: "Draw line or polygon", iconUrl: lineToolIconUrl},
  {kind: "mode", mode: "draw_circle", classSuffix: "draw-circle", label: "Draw circle", iconUrl: circleToolIconUrl},
] as const;

/** 只发出 mode/zoom command 的自定义工具栏；Leaflet 与 Measure Controller 始终留在 port 另一侧。 */
export function DrawingToolbar({mode, disabled, onZoomIn, onZoomOut, onModeChange}: DrawingToolbarProps) {
  return (
    <nav className={`drawing-toolbar drawing-toolbar-mode-${mode.replace("_", "-")}`} aria-label="Map and drawing tools" data-drawing-mode={mode}>
      <img className="drawing-toolbar-decoration" src={toolBarDecorationUrl} alt="" draggable={false} aria-hidden="true" />
      <div className="drawing-toolbar-controls">
        {TOOLBAR_CONTROLS.map((control, index) => {
          const isModeControl = "mode" in control;
          const isActive = isModeControl && mode === control.mode;
          return (
            <div className={`drawing-toolbar-control drawing-toolbar-control-${control.classSuffix}`} key={isModeControl ? control.mode : control.command}>
              {index === 0 ? null : (
                <span className={`drawing-toolbar-divider drawing-toolbar-divider-before-${control.classSuffix}`} aria-hidden="true">
                  <img className="drawing-toolbar-divider-decoration" src={toolBarDividerUrl} alt="" draggable={false} />
                </span>
              )}
              <button
                className={`drawing-toolbar-button drawing-toolbar-button-${control.classSuffix}${isActive ? " drawing-toolbar-button-active" : ""}${disabled ? " drawing-toolbar-button-disabled" : ""}`}
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
                  ? <img className={`drawing-toolbar-button-icon drawing-toolbar-button-icon-${control.classSuffix}`} src={control.iconUrl} alt="" draggable={false} aria-hidden="true" />
                  : <span className={`drawing-toolbar-zoom-symbol drawing-toolbar-zoom-symbol-${control.classSuffix}`} aria-hidden="true">{control.text}</span>}
              </button>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
