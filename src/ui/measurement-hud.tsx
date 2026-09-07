import type {MeasureToolModeType, MeasureToolUiStateType} from "../models/measure-tools/measure-tool-models.js";
import {UI_SVG_ASSETS} from "../built-in-config/ui-svg.js";
import {Popup} from "./popup.js";
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

/** 高频测量状态的独立 React 子树；视觉结构与 Feature Popup 完全共用。 */
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
    <Popup
      variant="measurement"
      className={`geomcp-popup-measurement-mode-${state.mode.replace("_", "-")} geomcp-popup-state-${measurementState}`}
      ariaLabel="Drawing measurement"
      ariaLive="polite"
      onClose={onClose}
      header={(
        <span className="geomcp-popup-title-group">
          <span className="geomcp-ui-icon-slot geomcp-ui-icon-slot-popup-measurement" aria-hidden="true">
            <img className="geomcp-ui-effect geomcp-ui-effect-measurement" src={UI_SVG_ASSETS.hover.measure} alt="" draggable={false} />
            <img className={`geomcp-ui-icon geomcp-ui-icon-popup-measurement geomcp-ui-icon-popup-measurement-${measurementKind}`} src={MEASUREMENT_TYPE_ICONS[measurementKind]} alt="" draggable={false} />
          </span>
          <span className="geomcp-popup-title">Measure</span>
        </span>
      )}
    >
      <section className="geomcp-popup-section">
        <section className="geomcp-popup-record">
          {state.errorMessage !== null
            ? <p className="geomcp-popup-message geomcp-popup-message-error">{state.errorMessage}</p>
            : rows.length === 0
            ? <p className="geomcp-popup-message geomcp-popup-message-muted">{MODE_INSTRUCTIONS[state.mode]}</p>
            : (
                <dl className="geomcp-popup-values">
                  {rows.map((row) => (
                    <div className="geomcp-popup-row" key={row.label}>
                      <img className="geomcp-ui-icon geomcp-ui-icon-popup-row-dot" src={UI_SVG_ASSETS.icons.tagPopupDot} alt="" draggable={false} aria-hidden="true" />
                      <dt className="geomcp-popup-row-key">{row.label}</dt>
                      <dd className="geomcp-popup-row-value">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
          {warning === null ? null : <p className="geomcp-popup-message geomcp-popup-message-warning">{warning}</p>}
        </section>
      </section>
    </Popup>
  );
}
