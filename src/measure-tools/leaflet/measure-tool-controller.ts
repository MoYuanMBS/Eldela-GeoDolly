import {
  DomEvent,
  divIcon,
  marker,
  type LeafletMouseEvent,
  type Marker,
} from "leaflet";
import {MEASURE_TOOL_BUILT_IN_CONFIG} from "../../built-in-config/measure-tool.js";
import {UI_SVG_ASSETS} from "../../built-in-config/ui-svg.js";
import {
  INITIAL_MEASURE_TOOL_UI_STATE,
  type ActiveMeasurementTargetType,
  type CircleMeasurementType,
  type CompletedMeasurementType,
  type DraftMeasurementType,
  type LineMeasurementType,
  type MeasureCoordinateType,
  type MeasureToolModeType,
  type MeasureToolUiStateType,
  type PolygonMeasurementType,
} from "../../models/measure-tools/measure-tool-models.js";
import type {
  CompletedMeasurementLayers,
  MeasurementCircleVisualLayers,
  MeasurementDraftPathLayers,
  MeasurementGeometryType,
  MeasurementLayerRuntime,
  MeasurementVertexLayers,
  MeasureToolController,
  MeasureToolControllerOptions,
} from "../../models/measure-tools/measure-tool-runtime-models.js";
import {AppError} from "../../utils/app-error.js";
import {
  calculateCircleGeodesy,
  calculateClosedPathPerimeterMeters,
  calculateLineLengthMeters,
  calculatePolygonGeodesy,
} from "../geodesic/measurement-geodesy.js";
import {classifyFinalizedPath} from "./path-classification.js";
import {createMeasurementLayerRuntime} from "./measurement-interaction.js";

interface CompletedMeasurementRecord extends CompletedMeasurementLayers {
  /** raw measurement 与 Leaflet layers 同生命周期，只保存在当前 Browser page。 */
  measurement: CompletedMeasurementType;
  deleteMarker: Marker | null;
  disposeInteraction(): void;
}

function toContinuousCoordinate(previous: MeasureCoordinateType | null, event: LeafletMouseEvent): MeasureCoordinateType {
  const latitude = event.latlng.lat;
  const rawLongitude = event.latlng.lng;
  // 每个新点选择距前一点最近的世界副本，跨日期变更线时保持 Path 连续。
  const longitude = previous === null ? rawLongitude : rawLongitude + 360 * Math.round((previous.longitude - rawLongitude) / 360);
  return Object.freeze({latitude, longitude});
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

function getClickDetail(event: LeafletMouseEvent): number {
  return "detail" in event.originalEvent && typeof event.originalEvent.detail === "number" ? event.originalEvent.detail : 0;
}

function sameMeasurement(left: CompletedMeasurementType | null, right: CompletedMeasurementType | null): boolean {
  return left === right || (left !== null && right !== null && left.measurementId === right.measurementId);
}

/**
 * Leaflet 原生事件驱动的轻量 Measure Tool。Controller 是 mode/draft/completed/hover/selection
 * 的唯一状态源，React 只读取 MeasureToolUiStateType。
 */
export function createMeasureToolController(options: MeasureToolControllerOptions): MeasureToolController {
  const {map, overlayInteraction, previewRefreshIntervalMs, onActiveMeasurementChange} = options;
  if (!Number.isSafeInteger(previewRefreshIntervalMs) || previewRefreshIntervalMs <= 0) {
    throw new AppError("measure_tool_config", "Measurement preview refresh interval must be a positive integer");
  }

  // records 是 completed measurement 的唯一 registry；React state 只取得其中的纯数值投影。
  const layerRuntime: MeasurementLayerRuntime = createMeasurementLayerRuntime(map);
  const records = new Map<string, CompletedMeasurementRecord>();
  const listeners = new Set<() => void>();
  let uiState: MeasureToolUiStateType = INITIAL_MEASURE_TOOL_UI_STATE;
  let mode: MeasureToolModeType = "idle";
  let draftMeasurement: DraftMeasurementType | null = null;
  let latestMeasurementId: string | null = null;
  let hoveredMeasurementId: string | null = null;
  let selectedMeasurementId: string | null = null;
  let errorMessage: string | null = null;
  let measurementSequence = 0;
  let disposed = false;

  // draft 原始输入与 Leaflet layer 分开保存，zoom/pan 只重投影，不改变测地坐标。
  let pathVertices: MeasureCoordinateType[] = [];
  let pathCursor: MeasureCoordinateType | null = null;
  let circleCenter: MeasureCoordinateType | null = null;
  let circleRadiusPoint: MeasureCoordinateType | null = null;
  let draftPathLayers: MeasurementDraftPathLayers | null = null;
  let draftVertexLayers: readonly MeasurementVertexLayers[] = Object.freeze([]);
  let draftCircleLayers: MeasurementCircleVisualLayers | null = null;
  let draftCircleCenterLayers: readonly MeasurementVertexLayers[] = Object.freeze([]);

  // 高频 mousemove 采用 interval + animation frame 两层门控，队列中永远只保留最新事件。
  let previewTimerId: number | null = null;
  let previewFrameId: number | null = null;
  let pendingPreviewEvent: LeafletMouseEvent | null = null;
  let lastPreviewTimestamp = Number.NEGATIVE_INFINITY;
  // 进入 drawing 前记录实际 interaction 状态，退出时只恢复由本 Controller 暂停的对象。
  let overlayWasEnabled: boolean | null = null;
  let completedInteractionWasEnabled: boolean | null = null;
  let pathDoubleClickZoomWasEnabled: boolean | null = null;
  let publishedActiveMeasurement: ActiveMeasurementTargetType | null = null;

  const getRecordMeasurement = (measurementId: string | null): CompletedMeasurementType | null => {
    if (measurementId === null) return null;
    return records.get(measurementId)?.measurement ?? null;
  };

  const publishState = (): void => {
    if (disposed) return;
    uiState = Object.freeze({
      revision: uiState.revision + 1,
      mode,
      draftMeasurement,
      latestMeasurement: getRecordMeasurement(latestMeasurementId),
      hoveredMeasurement: getRecordMeasurement(hoveredMeasurementId),
      selectedMeasurement: getRecordMeasurement(selectedMeasurementId),
      completedCount: records.size,
      errorMessage,
    });
    // MapPage 只需要低频 active target；selected 在这里覆盖 hover，避免 UI 自己重复仲裁。
    const activeMeasurement: ActiveMeasurementTargetType | null = uiState.selectedMeasurement !== null
      ? Object.freeze({interactionState: "selected", measurement: uiState.selectedMeasurement})
      : uiState.hoveredMeasurement !== null ? Object.freeze({interactionState: "hover", measurement: uiState.hoveredMeasurement}) : null;
    if (activeMeasurement?.interactionState !== publishedActiveMeasurement?.interactionState
      || !sameMeasurement(activeMeasurement?.measurement ?? null, publishedActiveMeasurement?.measurement ?? null)) {
      publishedActiveMeasurement = activeMeasurement;
      onActiveMeasurementChange?.(activeMeasurement);
    }
    for (const listener of listeners) listener();
  };

  const cancelPreviewSchedule = (): void => {
    if (previewTimerId !== null) window.clearTimeout(previewTimerId);
    if (previewFrameId !== null) cancelAnimationFrame(previewFrameId);
    previewTimerId = null;
    previewFrameId = null;
    pendingPreviewEvent = null;
  };

  const removeDraftLayers = (): void => {
    if (draftPathLayers !== null) {
      layerRuntime.removeVisualLayer(draftPathLayers.pathLayer);
      layerRuntime.removeVisualLayer(draftPathLayers.labelLayer);
    }
    for (const {outerLayer, centerLayer} of draftVertexLayers) {
      layerRuntime.removeVisualLayer(outerLayer);
      layerRuntime.removeVisualLayer(centerLayer);
    }
    if (draftCircleLayers !== null) {
      layerRuntime.removeVisualLayer(draftCircleLayers.outlineLayer);
      layerRuntime.removeVisualLayer(draftCircleLayers.innerBandLayer);
      layerRuntime.removeVisualLayer(draftCircleLayers.radiusLayer);
      layerRuntime.removeVisualLayer(draftCircleLayers.labelLayer);
    }
    for (const {outerLayer, centerLayer} of draftCircleCenterLayers) {
      layerRuntime.removeVisualLayer(outerLayer);
      layerRuntime.removeVisualLayer(centerLayer);
    }
    draftPathLayers = null;
    draftVertexLayers = Object.freeze([]);
    draftCircleLayers = null;
    draftCircleCenterLayers = Object.freeze([]);
  };

  const clearDraft = (): void => {
    // Esc/关闭、切换 mode、成功 finalize 与失败路径共用清理入口，防止遗留 timer/layer。
    cancelPreviewSchedule();
    removeDraftLayers();
    pathVertices = [];
    pathCursor = null;
    circleCenter = null;
    circleRadiusPoint = null;
    draftMeasurement = null;
  };

  const failCurrentDraft = (error: unknown): void => {
    // 测量失败不销毁已经 ready 的地图和 completed records，只结束当前草稿并交给 Popup 展示。
    clearDraft();
    errorMessage = AppError.fromUnknown(error, "measurement_geodesy_failed", "Measure Tool could not calculate the current geometry").message;
    publishState();
  };

  const renderPathDraft = (): void => {
    const previewCoordinates = pathCursor === null ? pathVertices : [...pathVertices, pathCursor];
    if (previewCoordinates.length === 0) {
      draftMeasurement = null;
      publishState();
      return;
    }
    const lengthMeters = calculateLineLengthMeters(previewCoordinates);
    if (draftPathLayers === null) draftPathLayers = layerRuntime.createDraftPath(previewCoordinates, lengthMeters);
    else layerRuntime.updateDraftPath(draftPathLayers, previewCoordinates, lengthMeters);
    // 鼠标预览只更新尾线；只有已提交顶点数量变化时才重建双圆 Node。
    if (draftVertexLayers.length !== pathVertices.length) {
      for (const {outerLayer, centerLayer} of draftVertexLayers) {
        layerRuntime.removeVisualLayer(outerLayer);
        layerRuntime.removeVisualLayer(centerLayer);
      }
      draftVertexLayers = layerRuntime.createDraftPathVertices(pathVertices);
    }
    draftMeasurement = Object.freeze({
      kind: "path",
      vertexCount: pathVertices.length,
      lengthMeters,
    });
    publishState();
  };

  const renderCircleDraft = (): void => {
    if (circleCenter === null) {
      draftMeasurement = Object.freeze({kind: "circle", centerPlaced: false, radiusMeters: null});
      publishState();
      return;
    }
    if (draftCircleCenterLayers.length === 0) draftCircleCenterLayers = layerRuntime.createDraftPathVertices([circleCenter]);
    if (circleRadiusPoint === null) {
      draftMeasurement = Object.freeze({kind: "circle", centerPlaced: true, radiusMeters: null});
      publishState();
      return;
    }
    const radiusMeters = calculateLineLengthMeters([circleCenter, circleRadiusPoint]);
    if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) return;
    if (draftCircleLayers === null) draftCircleLayers = layerRuntime.createDraftCircle(circleCenter, radiusMeters);
    else layerRuntime.updateDraftCircle(draftCircleLayers, radiusMeters);
    draftMeasurement = Object.freeze({kind: "circle", centerPlaced: true, radiusMeters});
    publishState();
  };

  const applyPendingPreview = (): void => {
    const event = pendingPreviewEvent;
    pendingPreviewEvent = null;
    if (event === null || disposed) return;
    try {
      if (mode === "draw_path" && pathVertices.length > 0) {
        pathCursor = toContinuousCoordinate(pathVertices.at(-1) ?? null, event);
        renderPathDraft();
      } else if (mode === "draw_circle" && circleCenter !== null) {
        circleRadiusPoint = toContinuousCoordinate(circleCenter, event);
        renderCircleDraft();
      }
    } catch (error) {
      failCurrentDraft(error);
    }
  };

  const requestPreviewFrame = (): void => {
    if (previewFrameId !== null || disposed) return;
    previewFrameId = requestAnimationFrame((timestamp) => {
      previewFrameId = null;
      lastPreviewTimestamp = timestamp;
      applyPendingPreview();
      if (pendingPreviewEvent !== null) schedulePreview(pendingPreviewEvent);
    });
  };

  const schedulePreview = (event: LeafletMouseEvent): void => {
    // 覆盖旧事件而不是排队，保证计算成本与鼠标事件频率解耦。
    pendingPreviewEvent = event;
    if (previewFrameId !== null || previewTimerId !== null) return;
    const elapsed = performance.now() - lastPreviewTimestamp;
    if (elapsed >= previewRefreshIntervalMs) {
      requestPreviewFrame();
      return;
    }
    previewTimerId = window.setTimeout(() => {
      previewTimerId = null;
      requestPreviewFrame();
    }, previewRefreshIntervalMs - elapsed);
  };

  const setRecordVisualState = (measurementId: string): void => {
    const record = records.get(measurementId);
    if (record === undefined) return;
    const state = selectedMeasurementId === measurementId ? "selected" : hoveredMeasurementId === measurementId ? "hover" : "base";
    layerRuntime.setVisualState(record, state);
  };

  const removeDeleteMarker = (record: CompletedMeasurementRecord): void => {
    record.deleteMarker?.remove();
    record.deleteMarker = null;
  };

  const deleteMeasurement = (measurementId: string): void => {
    const record = records.get(measurementId);
    if (record === undefined) return;
    // 先解绑 hit listener，再移除可见/命中图层，避免删除过程中产生晚到事件。
    record.disposeInteraction();
    removeDeleteMarker(record);
    layerRuntime.removeHitLayer(record.hitLayer);
    layerRuntime.removeVisualLayer(record.visualLayer);
    if (record.innerBandLayer !== null) layerRuntime.removeVisualLayer(record.innerBandLayer);
    if (record.radiusLayer !== null) layerRuntime.removeVisualLayer(record.radiusLayer);
    layerRuntime.removeVisualLayer(record.labelLayer);
    for (const {outerLayer, centerLayer} of record.vertexLayers) {
      layerRuntime.removeVisualLayer(outerLayer);
      layerRuntime.removeVisualLayer(centerLayer);
    }
    records.delete(measurementId);
    if (hoveredMeasurementId === measurementId) hoveredMeasurementId = null;
    if (selectedMeasurementId === measurementId) selectedMeasurementId = null;
    if (latestMeasurementId === measurementId) latestMeasurementId = [...records.keys()].at(-1) ?? null;
    publishState();
  };

  const createDeleteMarker = (record: CompletedMeasurementRecord): Marker => {
    // Marker 使用经纬度锚点随地图移动；按钮本身仍是可访问的原生 DOM control。
    const anchor = layerRuntime.getVisualNorthEast(record.visualLayer);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "geomcp-measurement-delete-button";
    button.setAttribute("aria-label", `Delete ${record.measurement.kind} measurement`);
    DomEvent.disableClickPropagation(button);
    DomEvent.disableScrollPropagation(button);
    const deleteImage = document.createElement("img");
    deleteImage.className = "geomcp-ui-icon geomcp-ui-icon-delete";
    deleteImage.src = UI_SVG_ASSETS.icons.delete;
    deleteImage.alt = "";
    deleteImage.draggable = false;
    deleteImage.setAttribute("aria-hidden", "true");
    button.append(deleteImage);
    button.addEventListener("click", () => deleteMeasurement(record.measurement.measurementId), {once: true});
    const icon = divIcon({
      className: "geomcp-measurement-delete-marker",
      html: button,
      iconSize: [MEASURE_TOOL_BUILT_IN_CONFIG.deleteMarkerSizePx, MEASURE_TOOL_BUILT_IN_CONFIG.deleteMarkerSizePx],
      iconAnchor: [MEASURE_TOOL_BUILT_IN_CONFIG.deleteMarkerSizePx / 2, MEASURE_TOOL_BUILT_IN_CONFIG.deleteMarkerSizePx / 2],
    });
    return marker([anchor.latitude, anchor.longitude], {
      icon,
      pane: MEASURE_TOOL_BUILT_IN_CONFIG.panes.deleteMarker.name,
      keyboard: false,
      interactive: true,
    }).addTo(map);
  };

  const clearMeasurementHover = (): void => {
    if (hoveredMeasurementId === null) return;
    const previousId = hoveredMeasurementId;
    hoveredMeasurementId = null;
    setRecordVisualState(previousId);
    publishState();
  };

  const clearMeasurementSelection = (): void => {
    if (selectedMeasurementId === null) return;
    const previousId = selectedMeasurementId;
    selectedMeasurementId = null;
    const record = records.get(previousId);
    if (record !== undefined) {
      removeDeleteMarker(record);
      setRecordVisualState(previousId);
    }
    publishState();
  };

  const selectMeasurement = (measurementId: string): void => {
    const previousId = selectedMeasurementId;
    if (previousId !== null) {
      const previousRecord = records.get(previousId);
      if (previousRecord !== undefined) removeDeleteMarker(previousRecord);
    }
    selectedMeasurementId = previousId === measurementId ? null : measurementId;
    // Measurement 与 Overlay selection 互斥，但二者在 idle 中仍可同时参与 hover/click。
    overlayInteraction?.clearSelection();
    if (previousId !== null) setRecordVisualState(previousId);
    const record = records.get(measurementId);
    if (record !== undefined) {
      setRecordVisualState(measurementId);
      if (selectedMeasurementId === measurementId) record.deleteMarker = createDeleteMarker(record);
    }
    publishState();
  };

  const registerCompletedMeasurement = (measurement: CompletedMeasurementType, geometry: MeasurementGeometryType): void => {
    // 每个 record 只绑定自己的透明 hit Path；可见 Path/Node 始终保持 interactive=false。
    const labelMeters = measurement.kind === "line"
      ? measurement.lengthMeters
      : measurement.kind === "polygon" ? measurement.perimeterMeters : measurement.radiusMeters;
    const layers = layerRuntime.createCompletedLayers(geometry, labelMeters);
    const handleMouseOver = (): void => {
      overlayInteraction?.clearHover();
      const previousId = hoveredMeasurementId;
      hoveredMeasurementId = measurement.measurementId;
      if (previousId !== null && previousId !== hoveredMeasurementId) setRecordVisualState(previousId);
      setRecordVisualState(measurement.measurementId);
      publishState();
    };
    const handleMouseOut = (): void => {
      if (hoveredMeasurementId !== measurement.measurementId) return;
      hoveredMeasurementId = null;
      setRecordVisualState(measurement.measurementId);
      publishState();
    };
    const handleClick = (): void => selectMeasurement(measurement.measurementId);
    layers.hitLayer.on("mouseover", handleMouseOver);
    layers.hitLayer.on("mouseout", handleMouseOut);
    layers.hitLayer.on("click", handleClick);
    const record: CompletedMeasurementRecord = {
      ...layers,
      measurement,
      deleteMarker: null,
      disposeInteraction: () => {
        layers.hitLayer.off("mouseover", handleMouseOver);
        layers.hitLayer.off("mouseout", handleMouseOut);
        layers.hitLayer.off("click", handleClick);
      },
    };
    records.set(measurement.measurementId, record);
    latestMeasurementId = measurement.measurementId;
  };

  const suspendInteractions = (): void => {
    overlayWasEnabled = overlayInteraction?.getEnabled() ?? null;
    completedInteractionWasEnabled = layerRuntime.getCompletedInteractionEnabled();
    // drawing click 必须只进入 Map handler，因此同时暂停 Overlay 与旧 Measurement hit。
    overlayInteraction?.setEnabled(false);
    layerRuntime.setCompletedInteractionEnabled(false);
    clearMeasurementHover();
    clearMeasurementSelection();
  };

  const restoreInteractions = (): void => {
    // 只有进入前为 enabled 的 interaction 才恢复，避免覆盖其他未来 owner 的 suspension。
    if (completedInteractionWasEnabled === true) layerRuntime.setCompletedInteractionEnabled(true);
    if (overlayWasEnabled === true) overlayInteraction?.setEnabled(true);
    completedInteractionWasEnabled = null;
    overlayWasEnabled = null;
  };

  const enterPathDoubleClickBoundary = (): void => {
    if (pathDoubleClickZoomWasEnabled !== null) return;
    pathDoubleClickZoomWasEnabled = map.doubleClickZoom.enabled();
    if (pathDoubleClickZoomWasEnabled) map.doubleClickZoom.disable();
  };

  const leavePathDoubleClickBoundary = (): void => {
    if (pathDoubleClickZoomWasEnabled === true) map.doubleClickZoom.enable();
    pathDoubleClickZoomWasEnabled = null;
  };

  const transitionMode = (nextMode: MeasureToolModeType): void => {
    if (mode === nextMode) return;
    const previousMode = mode;
    const wasDrawing = previousMode !== "idle";
    const willDraw = nextMode !== "idle";
    // 所有 mode 切换都先清草稿；completed registry 不受 Toolbar 切换影响。
    clearDraft();
    if (previousMode === "draw_path") leavePathDoubleClickBoundary();
    if (!wasDrawing && willDraw) suspendInteractions();
    if (wasDrawing && !willDraw) restoreInteractions();
    mode = nextMode;
    if (nextMode === "draw_path") enterPathDoubleClickBoundary();
    if (nextMode === "draw_circle") draftMeasurement = Object.freeze({kind: "circle", centerPlaced: false, radiusMeters: null});
    errorMessage = null;
    publishState();
  };

  const finishSuccessfulMeasurement = (measurementId: string): void => {
    // 完成后先退出 drawing、恢复 interaction，再选中新结果；Popup 因 selection 保持可见。
    transitionMode("idle");
    selectMeasurement(measurementId);
  };

  const finalizePath = (): void => {
    // Line/Polygon 的业务类型只在双击 finalize 时分类，draft 阶段不做预判。
    const classification = classifyFinalizedPath(map, pathVertices);
    if (classification.kind === "invalid") return;
    const measurementId = `measurement-${++measurementSequence}`;
    if (classification.kind === "line") {
      const measurement: LineMeasurementType = Object.freeze({
        measurementId,
        kind: "line",
        lengthMeters: calculateLineLengthMeters(classification.coordinates),
        warning: null,
      });
      registerCompletedMeasurement(measurement, {kind: "line", coordinates: classification.coordinates});
    } else if (classification.selfIntersects) {
      // 自相交仍是有效 completed Polygon，但只发布闭合周长，不传播代数面积。
      const measurement: PolygonMeasurementType = Object.freeze({
        measurementId,
        kind: "polygon",
        perimeterMeters: calculateClosedPathPerimeterMeters(classification.coordinates),
        areaSquareMeters: null,
        warning: "self_intersection",
      });
      registerCompletedMeasurement(measurement, {kind: "polygon", coordinates: classification.coordinates});
    } else {
      const geodesy = calculatePolygonGeodesy(classification.coordinates);
      const measurement: PolygonMeasurementType = Object.freeze({
        measurementId,
        kind: "polygon",
        perimeterMeters: geodesy.perimeterMeters,
        areaSquareMeters: geodesy.areaSquareMeters,
        warning: null,
      });
      registerCompletedMeasurement(measurement, {kind: "polygon", coordinates: classification.coordinates});
    }
    finishSuccessfulMeasurement(measurementId);
  };

  const finalizeCircle = (radiusPoint: MeasureCoordinateType): void => {
    // 256/512 点面积计算只在第二次独立 click 执行，mousemove 预览只计算半径。
    if (circleCenter === null) return;
    const geodesy = calculateCircleGeodesy(circleCenter, radiusPoint);
    const measurementId = `measurement-${++measurementSequence}`;
    const measurement: CircleMeasurementType = Object.freeze({
      measurementId,
      kind: "circle",
      radiusMeters: geodesy.radiusMeters,
      areaSquareMeters: geodesy.areaSquareMeters,
      warning: null,
    });
    registerCompletedMeasurement(measurement, {kind: "circle", center: circleCenter, radiusMeters: geodesy.radiusMeters});
    finishSuccessfulMeasurement(measurementId);
  };

  const handleMapClick = (event: LeafletMouseEvent): void => {
    if (mode === "idle") {
      // 透明 hit Path 已阻止事件冒泡；能到达 Map 的 click 视为地图空白并清 selection。
      clearMeasurementSelection();
      return;
    }
    // 浏览器 double-click 序列的第二个 click(detail=2) 不能重复加点或完成零半径 Circle。
    if (getClickDetail(event) > 1) return;
    errorMessage = null;
    try {
      if (mode === "draw_path") {
        const coordinate = toContinuousCoordinate(pathVertices.at(-1) ?? null, event);
        pathVertices.push(coordinate);
        pathCursor = null;
        cancelPreviewSchedule();
        renderPathDraft();
        return;
      }
      if (circleCenter === null) {
        circleCenter = toContinuousCoordinate(null, event);
        circleRadiusPoint = null;
        renderCircleDraft();
        return;
      }
      const radiusPoint = toContinuousCoordinate(circleCenter, event);
      const radiusMeters = calculateLineLengthMeters([circleCenter, radiusPoint]);
      if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) return;
      finalizeCircle(radiusPoint);
    } catch (error) {
      failCurrentDraft(error);
    }
  };

  const handleMapDoubleClick = (event: LeafletMouseEvent): void => {
    if (mode !== "draw_path") return;
    DomEvent.preventDefault(event.originalEvent);
    try {
      finalizePath();
    } catch (error) {
      failCurrentDraft(error);
    }
  };

  const handleMapMouseMove = (event: LeafletMouseEvent): void => {
    if ((mode === "draw_path" && pathVertices.length > 0) || (mode === "draw_circle" && circleCenter !== null)) {
      schedulePreview(event);
    }
  };

  const handleWindowKeyDown = (event: KeyboardEvent): void => {
    if (mode === "idle" || isEditableKeyboardTarget(event.target)) return;
    if (event.key === "Escape") {
      // Esc 与绘制态 Popup 关闭按钮语义一致：丢弃 draft 并完整退出当前工具。
      event.preventDefault();
      transitionMode("idle");
      return;
    }
    if (event.key === "Backspace" && mode === "draw_path") {
      // 顶点视觉与主 Path 同步重建；completed geometry 从不进入编辑路径。
      event.preventDefault();
      pathVertices.pop();
      pathCursor = null;
      removeDraftLayers();
      try {
        renderPathDraft();
      } catch (error) {
        failCurrentDraft(error);
      }
    }
  };

  map.on("click", handleMapClick);
  map.on("dblclick", handleMapDoubleClick);
  map.on("mousemove", handleMapMouseMove);
  window.addEventListener("keydown", handleWindowKeyDown);

  const setMode = (requestedMode: MeasureToolModeType): void => {
    if (disposed) return;
    // 再次点击已激活的 Toolbar 按钮等价于关闭工具，而不是重新初始化同一 mode。
    const nextMode = requestedMode === mode && requestedMode !== "idle" ? "idle" : requestedMode;
    transitionMode(nextMode);
  };
  const getUiState = (): MeasureToolUiStateType => uiState;
  const subscribe = (listener: () => void): (() => void) => {
    if (disposed) return () => undefined;
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const dispose = (): void => {
    if (disposed) return;
    // 先阻止新的外部事件，再清 timer/draft/records，最后释放统一 layer runtime。
    map.off("click", handleMapClick);
    map.off("dblclick", handleMapDoubleClick);
    map.off("mousemove", handleMapMouseMove);
    window.removeEventListener("keydown", handleWindowKeyDown);
    cancelPreviewSchedule();
    clearDraft();
    if (mode !== "idle") {
      if (mode === "draw_path") leavePathDoubleClickBoundary();
      restoreInteractions();
    }
    for (const record of records.values()) {
      record.disposeInteraction();
      removeDeleteMarker(record);
    }
    records.clear();
    layerRuntime.dispose();
    mode = "idle";
    disposed = true;
    listeners.clear();
    if (publishedActiveMeasurement !== null) onActiveMeasurementChange?.(null);
    publishedActiveMeasurement = null;
  };

  return Object.freeze({getUiState, subscribe, setMode, clearMeasurementHover, clearMeasurementSelection, dispose});
}
