import {useCallback, useSyncExternalStore, type ReactNode} from "react";
import {INITIAL_MEASURE_TOOL_UI_STATE, type MeasureToolUiStateType} from "../models/measure-tools/measure-tool-models.js";
import type {MeasureToolUiPortType} from "../web/map-surface-port.js";
import {DrawingToolbar} from "./drawing-toolbar.js";
import {MeasurementHUD} from "./measurement-hud.js";

interface MeasureToolUiProps {
  port: MeasureToolUiPortType | null;
  disabled: boolean;
  onZoomIn(): void;
  onZoomOut(): void;
  featurePopup: ReactNode;
}

/** Controller 的高频 state 只在这个子树订阅，不会让 MapPage/MapSurface 重新创建。 */
export function MeasureToolUi({port, disabled, onZoomIn, onZoomOut, featurePopup}: MeasureToolUiProps) {
  // port 生命周期变化时替换订阅函数；Controller 的每个 preview revision 只重绘本子树。
  const subscribe = useCallback((listener: () => void): (() => void) => port?.subscribe(listener) ?? (() => undefined), [port]);
  const getState = useCallback((): MeasureToolUiStateType => port?.getUiState() ?? INITIAL_MEASURE_TOOL_UI_STATE, [port]);
  const state = useSyncExternalStore(subscribe, getState, () => INITIAL_MEASURE_TOOL_UI_STATE);
  const showMeasurementPopup = state.mode !== "idle" || state.selectedMeasurement !== null;
  return (
    <>
      <DrawingToolbar
        mode={state.mode}
        disabled={disabled || port === null}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onModeChange={(mode) => port?.setMode(mode)}
      />
      {showMeasurementPopup ? (
        <MeasurementHUD
          state={state}
          onClose={() => {
            if (state.mode !== "idle") port?.setMode("idle");
            else port?.clearMeasurementSelection();
          }}
        />
      ) : featurePopup}
    </>
  );
}
