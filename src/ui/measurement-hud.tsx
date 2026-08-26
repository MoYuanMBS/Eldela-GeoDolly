import type {DrawingUiModeType} from "../models/web/interactive-ui-models.js";

export interface MeasurementHudRow {
  label: string;
  value: string;
}

interface MeasurementHudProps {
  mode: DrawingUiModeType;
  rows: readonly MeasurementHudRow[];
}

const MODE_INSTRUCTIONS: Readonly<Record<DrawingUiModeType, string>> = {
  idle: "Choose a drawing tool",
  draw_path: "Double-click or press Esc to finish a line; click the first point to close a polygon",
  draw_circle: "Draw a circle to measure radius and area",
};

/** 高频测量状态的独立 React 子树；只接收 Controller 已格式化的测量行。 */
export function MeasurementHUD({mode, rows}: MeasurementHudProps) {
  const measurementState = rows.length === 0 ? "empty" : "ready";
  return (
    <aside className={`measurement-hud measurement-hud-mode-${mode.replace("_", "-")} measurement-hud-state-${measurementState}`} aria-label="Drawing measurement" aria-live="polite" data-measurement-state={measurementState}>
      <span className="measurement-hud-title">Measurement</span>
      {rows.length === 0
        ? <span className={`measurement-hud-empty measurement-hud-empty-${mode.replace("_", "-")}`}>{MODE_INSTRUCTIONS[mode]}</span>
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
    </aside>
  );
}
