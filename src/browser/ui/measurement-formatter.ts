import type {CompletedMeasurementType, DraftMeasurementType} from "../../models/measure-tools/measure-tool-models.js";

export interface MeasurementDisplayRowType {
  label: string;
  value: string;
}

export function formatMeters(value: number): string {
  return `${value.toFixed(2)} m`;
}

export function formatSquareMeters(value: number): string {
  return `${value.toFixed(2)} m²`;
}

export function formatDraftMeasurementRows(measurement: DraftMeasurementType): readonly MeasurementDisplayRowType[] {
  if (measurement.kind === "path") {
    return Object.freeze([{label: "Length", value: formatMeters(measurement.lengthMeters)}]);
  }
  return measurement.radiusMeters === null
    ? Object.freeze([])
    : Object.freeze([{label: "Radius", value: formatMeters(measurement.radiusMeters)}]);
}

export function formatCompletedMeasurementRows(measurement: CompletedMeasurementType): readonly MeasurementDisplayRowType[] {
  // 数值始终在 UI 边界格式化；Controller/Standard UI 共享同一份原始米与平方米结果。
  if (measurement.kind === "line") {
    return Object.freeze([{label: "Length", value: formatMeters(measurement.lengthMeters)}]);
  }
  if (measurement.kind === "polygon") {
    return Object.freeze([
      {label: "Perimeter", value: formatMeters(measurement.perimeterMeters)},
      ...(measurement.areaSquareMeters === null ? [] : [{label: "Area", value: formatSquareMeters(measurement.areaSquareMeters)}]),
    ]);
  }
  return Object.freeze([
    {label: "Radius", value: formatMeters(measurement.radiusMeters)},
    {label: "Area", value: formatSquareMeters(measurement.areaSquareMeters)},
  ]);
}
