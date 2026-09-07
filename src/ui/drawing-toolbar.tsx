import {useEffect, useState, type CSSProperties} from "react";
import {UI_SVG_ASSETS} from "../built-in-config/ui-svg.js";
import {UI_BUILT_IN_CONFIG} from "../built-in-config/ui.js";
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
  const [hoveredControl, setHoveredControl] = useState<string | null>(null);
  const [pressedControl, setPressedControl] = useState<string | null>(null);

  useEffect(() => {
    // 按住多久就保持多久；在按钮外松开、取消或切出窗口也必须清除，不使用计时器。
    const release = (): void => setPressedControl(null);
    const reset = (): void => {
      release();
      setHoveredControl(null);
    };
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", reset, true);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", reset, true);
      window.removeEventListener("blur", reset);
    };
  }, []);

  useEffect(() => {
    if (disabled) {
      setPressedControl(null);
      setHoveredControl(null);
    }
  }, [disabled]);

  // body.svg 的画板为 32 × 16；先等比适应栏宽，再只拉伸纵向，不改 SVG 文件。
  const toolbarStyle = {
    "--geomcp-tool-bar-body-scale-y": TOOLBAR_CONTROLS.length * UI_BUILT_IN_CONFIG.toolbar.controlHeightPx / (UI_BUILT_IN_CONFIG.toolbar.widthPx / 2),
  } as CSSProperties;
  return (
    <nav className={`geomcp-tool-bar geomcp-tool-bar-mode-${mode.replace("_", "-")}`} style={toolbarStyle} aria-label="Map and drawing tools" data-drawing-mode={mode}>
      <img className="geomcp-ui-decoration geomcp-ui-decoration-tool-top" src={UI_SVG_ASSETS.bar.toolTop} alt="" draggable={false} aria-hidden="true" />
      <div className="geomcp-tool-bar-body">
        <img className="geomcp-ui-decoration geomcp-ui-decoration-tool-body" src={UI_SVG_ASSETS.bar.toolBody} alt="" draggable={false} aria-hidden="true" />
        <div className="geomcp-tool-bar-controls">
          {TOOLBAR_CONTROLS.map((control, index) => {
            const isModeControl = "mode" in control;
            const isActive = isModeControl && mode === control.mode;
            // 选中的绘制工具始终 select，连按住也不替换；其余按钮才按 pressed > hover 显示。
            const effect = disabled ? null : isActive ? "toolSelect" : pressedControl === control.classSuffix ? "toolPressed" : hoveredControl === control.classSuffix ? "toolHover" : null;
            return (
              <div className={`geomcp-tool-bar-control geomcp-tool-bar-control-${control.classSuffix}`} key={isModeControl ? control.mode : control.command}>
                {/* 只分隔缩放命令组与测量工具组，组内按钮之间不添加 divider。 */}
                {isModeControl && TOOLBAR_CONTROLS[index - 1]?.kind === "command" ? (
                  <span className={`geomcp-tool-bar-divider geomcp-tool-bar-divider-before-${control.classSuffix}`} aria-hidden="true">
                    <img className="geomcp-ui-decoration geomcp-ui-decoration-tool-divider" src={UI_SVG_ASSETS.decorations.toolBarDivider} alt="" draggable={false} />
                  </span>
                ) : null}
                <button
                  className={`geomcp-tool-bar-button geomcp-tool-bar-button-${control.classSuffix}${isActive ? " geomcp-tool-bar-button-active" : ""}${disabled ? " geomcp-tool-bar-button-disabled" : ""}`}
                  type="button"
                  aria-label={control.label}
                  aria-pressed={isModeControl ? isActive : undefined}
                  data-tool-effect={effect ?? "none"}
                  disabled={disabled}
                  onPointerEnter={(event) => {
                    if (event.pointerType !== "touch") setHoveredControl(control.classSuffix);
                  }}
                  onPointerLeave={() => setHoveredControl((current) => current === control.classSuffix ? null : current)}
                  onPointerDown={(event) => {
                    if (event.button === 0) setPressedControl(control.classSuffix);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === " " || event.key === "Enter") setPressedControl(control.classSuffix);
                  }}
                  onKeyUp={(event) => {
                    if (event.key === " " || event.key === "Enter") setPressedControl(null);
                  }}
                  onBlur={() => setPressedControl(null)}
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
                  {effect === null ? null : <img className="geomcp-ui-effect geomcp-ui-effect-tool" src={UI_SVG_ASSETS.hover[effect]} alt="" draggable={false} aria-hidden="true" />}
                  {isModeControl
                    ? <img className={`geomcp-ui-icon geomcp-ui-icon-tool geomcp-ui-icon-tool-${control.classSuffix}`} src={control.iconUrl} alt="" draggable={false} aria-hidden="true" />
                    : <span className={`geomcp-tool-bar-zoom-symbol geomcp-tool-bar-zoom-symbol-${control.classSuffix}`} aria-hidden="true">{control.text}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <img className="geomcp-ui-decoration geomcp-ui-decoration-tool-bottom" src={UI_SVG_ASSETS.bar.toolBottom} alt="" draggable={false} aria-hidden="true" />
    </nav>
  );
}
