import type {MeasureToolModeType, MeasureToolUiStateType} from "../models/measure-tools/measure-tool-models.js";
import {UI_SVG_ASSETS} from "../built-in-config/ui-svg.js";
import {InteractivePopup} from "./interactive-popup.js";
import {formatCompletedMeasurementRows, formatDraftMeasurementRows} from "./measurement-formatter.js";

interface MeasurementHudProps {
  state: MeasureToolUiStateType;
  onClose(): void;
}

const MODE_INSTRUCTIONS: Readonly<Record<MeasureToolModeType, string>> = {
  idle: "Select a completed measurement",
  draw_path: "Click to add points; double-click to finish; Esc exits and Backspace undoes",
  draw_circle: "Click a center and a radius point; Esc exits the tool",
};

const MEASUREMENT_TYPE_ICONS = {
  line: UI_SVG_ASSETS.icons.lineMeasurement,
  path: UI_SVG_ASSETS.icons.lineMeasurement,
  polygon: UI_SVG_ASSETS.icons.polygonMeasurement,
  circle: UI_SVG_ASSETS.icons.roundMeasurement,
} as const;

/** 高频测量状态的独立 React 子树；米/平方米的原始值在 UI 边界统一格式化。 */
export function MeasurementHUD({state, onClose}: MeasurementHudProps) {
  const rows = state.mode !== "idle" && state.draftMeasurement !== null
    ? formatDraftMeasurementRows(state.draftMeasurement)
    : state.selectedMeasurement !== null ? formatCompletedMeasurementRows(state.selectedMeasurement) : [];
  const warning = state.mode === "idle" && state.selectedMeasurement?.warning === "self_intersection"
    ? "Self-intersecting polygon: area is unavailable"
    : null;
  const measurementState = state.errorMessage !== null ? "failed" : rows.length === 0 ? "empty" : "ready";
  const measurementKind = state.mode === "draw_circle"
    ? "circle"
    : state.mode === "draw_path" ? "path" : state.selectedMeasurement?.kind ?? "line";
  return (
    <InteractivePopup
      variant="measurement"
      className={`geomcp-measurement-hud geomcp-measurement-hud-mode-${state.mode.replace("_", "-")} geomcp-measurement-hud-state-${measurementState}`}
      ariaLabel="Drawing measurement"
      ariaLive="polite"
      onClose={onClose}
      header={(
        <span className="geomcp-measurement-hud-title-group">
          <img className={`geomcp-ui-icon geomcp-ui-icon-popup-measurement geomcp-ui-icon-popup-measurement-${measurementKind}`} src={MEASUREMENT_TYPE_ICONS[measurementKind]} alt="" draggable={false} aria-hidden="true" />
          <span className="geomcp-measurement-hud-title">Measure</span>
        </span>
      )}
    >
        {state.errorMessage !== null
          ? <span className="geomcp-measurement-hud-error">{state.errorMessage}</span>
          : rows.length === 0
          ? <span className={`geomcp-measurement-hud-empty geomcp-measurement-hud-empty-${state.mode.replace("_", "-")}`}>{MODE_INSTRUCTIONS[state.mode]}</span>
          : (
              <>
                <dl className="geomcp-interactive-popup-values geomcp-measurement-hud-values">
                  {rows.map((row) => (
                    <div className="geomcp-interactive-popup-row geomcp-measurement-hud-row" key={row.label}>
                      <img className="geomcp-ui-icon geomcp-ui-icon-popup-row-dot" src={UI_SVG_ASSETS.icons.tagPopupDot} alt="" draggable={false} aria-hidden="true" />
                      <dt className="geomcp-measurement-hud-row-label">{row.label}</dt>
                      <dd className="geomcp-measurement-hud-row-value">{row.value}</dd>
                    </div>
                  ))}
                </dl>
                <img className="geomcp-ui-decoration geomcp-ui-decoration-popup-record-divider geomcp-ui-decoration-measurement-record-divider" src={UI_SVG_ASSETS.decorations.tagBarEnd} alt="" draggable={false} aria-hidden="true" />
              </>
            )}
        {warning === null ? null : <span className="geomcp-measurement-hud-warning">{warning}</span>}
    </InteractivePopup>
  );
}
