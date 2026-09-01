import type {MeasureToolModeType, MeasureToolUiStateType} from "../models/measure-tools/measure-tool-models.js";
import {formatCompletedMeasurementRows, formatDraftMeasurementRows} from "./measurement-formatter.js";

interface MeasurementHudProps {
  state: MeasureToolUiStateType;
}

const MODE_INSTRUCTIONS: Readonly<Record<MeasureToolModeType, string>> = {
  idle: "Choose a drawing tool",
  draw_path: "Click to add points; double-click to finish; Esc clears and Backspace undoes",
  draw_circle: "Click a center and a radius point; Esc clears the current circle",
};

/** 高频测量状态的独立 React 子树；米/平方米的原始值在 UI 边界统一格式化。 */
export function MeasurementHUD({state}: MeasurementHudProps) {
  const rows = state.draftMeasurement !== null
    ? formatDraftMeasurementRows(state.draftMeasurement)
    : state.mode === "idle" && state.latestMeasurement !== null ? formatCompletedMeasurementRows(state.latestMeasurement) : [];
  const warning = state.mode === "idle" && state.latestMeasurement?.warning === "self_intersection" && state.draftMeasurement === null
    ? "Self-intersecting polygon: area is unavailable"
    : null;
  const measurementState = state.errorMessage !== null ? "failed" : rows.length === 0 ? "empty" : "ready";
  return (
    <aside className={`measurement-hud measurement-hud-mode-${state.mode.replace("_", "-")} measurement-hud-state-${measurementState}`} aria-label="Drawing measurement" aria-live="polite" data-measurement-state={measurementState}>
      <span className="measurement-hud-title">Measurement</span>
      {state.errorMessage !== null
        ? <span className="measurement-hud-error">{state.errorMessage}</span>
        : rows.length === 0
        ? <span className={`measurement-hud-empty measurement-hud-empty-${state.mode.replace("_", "-")}`}>{MODE_INSTRUCTIONS[state.mode]}</span>
        : (
            <dl className="measurement-hud-values">
              {rows.map((row) => (
                <div className="measurement-hud-row" key={row.label}>
                  <dt className="measurement-hud-row-label">{row.label}</dt>
                  <dd className="measurement-hud-row-value">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
      {warning === null ? null : <span className="measurement-hud-warning">{warning}</span>}
    </aside>
  );
}
