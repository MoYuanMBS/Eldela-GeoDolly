import {useEffect, useRef, useState, type CSSProperties} from "react";
import {UI_SVG_ASSETS} from "../built-in-config/ui-svg.js";
import {UI_BUILT_IN_CONFIG, UI_DECORATIONS_ENABLED} from "../built-in-config/ui.js";
import type {CompletedMeasurementType} from "../models/measure-tools/measure-tool-models.js";
import type {InteractiveFeatureSummaryType} from "../models/web/interactive-ui-models.js";
import {AppError} from "../utils/app-error.js";
import type {MetricScaleViewType} from "../web/map-surface-port.js";
import {formatCompletedMeasurementRows} from "./measurement-formatter.js";

interface StandardBarProps {
  logicalWidth: number;
  attributionText: string;
  attributionUrl: string;
  attributionDescription: string | null;
  metricScale: MetricScaleViewType | null;
  feature: InteractiveFeatureSummaryType | null;
  measurement: CompletedMeasurementType | null;
  // 当前展示目标的选中态由页面派生；hover 只更新摘要，不挂载类型特效。
  targetSelected: boolean;
  onReady(measuredHeight: number): void;
  onError(message: string): void;
}

interface MetricScaleStyle extends CSSProperties {
  "--geomcp-metric-scale-width": string;
}

const FEATURE_TYPE_ICONS = {
  node: UI_SVG_ASSETS.icons.node,
  way: UI_SVG_ASSETS.icons.way,
  area: UI_SVG_ASSETS.icons.polygon,
} as const;

const MEASUREMENT_TYPE_ICONS = {
  line: UI_SVG_ASSETS.icons.lineMeasurement,
  polygon: UI_SVG_ASSETS.icons.polygonMeasurement,
  circle: UI_SVG_ASSETS.icons.roundMeasurement,
} as const;

type StandardUiStatus = "pending" | "waiting-scale" | "measuring" | "locked" | "ready" | "failed";

interface AttributionReference {
  attribution: string;
  attribution_url: string | null;
  title?: string;
}

function buildAttributionReferences(attributionText: string, attributionUrl: string, attributionDescription: string | null): readonly AttributionReference[] {
  // 四项分别表达工具、地图引擎、底图和 OSM 数据来源；URL 相同也不能合并。
  return Object.freeze([
    UI_BUILT_IN_CONFIG.attribution.references.tool,
    UI_BUILT_IN_CONFIG.attribution.references.leaflet,
    {attribution: attributionText, attribution_url: attributionUrl, title: attributionDescription ?? undefined},
    UI_BUILT_IN_CONFIG.attribution.references.osmData,
  ] satisfies AttributionReference[]);
}

function StandardBarDivider({position}: {position: "scale-feature" | "feature-attribution"}) {
  return (
    <span className={`geomcp-standard-bar-divider geomcp-standard-bar-divider-${position}`} aria-hidden="true">
      <img className="geomcp-ui-decoration geomcp-ui-decoration-standard-divider" src={UI_SVG_ASSETS.decorations.referenceBarDivider} alt="" draggable={false} />
    </span>
  );
}

function waitForAnimationFrame(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const frameId = requestAnimationFrame(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    });
    const handleAbort = (): void => {
      cancelAnimationFrame(frameId);
      reject(signal.reason);
    };
    signal.addEventListener("abort", handleAbort, {once: true});
  });
}

async function waitForStandardUiFonts(signal: AbortSignal): Promise<void> {
  const loadedFonts = await document.fonts.load('400 13px "GeoMCP Source Han Sans"');
  await document.fonts.ready;
  if (signal.aborted) throw signal.reason;
  if (loadedFonts.length === 0) {
    throw new AppError("standard_ui_font_failed", "Standard UI font could not be loaded");
  }
}

function waitForImage(image: HTMLImageElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", handleError);
      signal.removeEventListener("abort", handleAbort);
    };
    const finish = (): void => {
      cleanup();
      if (image.naturalWidth === 0) {
        reject(new AppError("standard_ui_asset_failed", "A Standard UI image asset could not be loaded"));
        return;
      }
      void image.decode().then(resolve, reject);
    };
    const handleLoad = (): void => finish();
    const handleError = (): void => {
      cleanup();
      reject(new AppError("standard_ui_asset_failed", "A Standard UI image asset could not be loaded"));
    };
    const handleAbort = (): void => {
      cleanup();
      reject(signal.reason);
    };

    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    if (image.complete) {
      finish();
      return;
    }
    image.addEventListener("load", handleLoad, {once: true});
    image.addEventListener("error", handleError, {once: true});
    signal.addEventListener("abort", handleAbort, {once: true});
  });
}

async function waitForStandardUiAssets(element: HTMLElement, signal: AbortSignal): Promise<void> {
  const images = [...element.querySelectorAll<HTMLImageElement>("img")];
  await Promise.all(images.map((image) => waitForImage(image, signal)));
}

function hasLayoutOverflow(element: HTMLElement, content: HTMLElement): boolean {
  // 角饰允许越过边框，因此只比较正常布局盒；absolute decoration 不属于 overflow 错误。
  return content.offsetWidth > element.clientWidth || content.offsetHeight > element.clientHeight;
}

/** Interactive MapSurface 外部的实时 Scale / Feature / Attribution，并负责锁定自身高度。 */
export function StandardBar({logicalWidth, attributionText, attributionUrl, attributionDescription, metricScale, feature, measurement, targetSelected, onReady, onError}: StandardBarProps) {
  const elementRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [layoutStatus, setLayoutStatus] = useState<StandardUiStatus>("pending");
  const hasInitialScale = metricScale !== null;

  useEffect(() => {
    const element = elementRef.current;
    const content = contentRef.current;
    if (element === null || content === null) return;
    element.style.removeProperty("height");
    delete element.dataset.lockedHeight;
    setLayoutStatus(hasInitialScale ? "measuring" : "waiting-scale");
    if (!hasInitialScale) return;

    const abortController = new AbortController();
    const {signal} = abortController;
    let resizeRevision = 0;
    let lockedHeight: number | null = null;
    let readyPublished = false;
    let anomalyReported = false;
    let anomalyFrameId: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      resizeRevision += 1;
      if (!readyPublished || lockedHeight === null || anomalyReported || anomalyFrameId !== null) return;
      anomalyFrameId = requestAnimationFrame(() => {
        anomalyFrameId = null;
        if (signal.aborted || lockedHeight === null) return;
        if (Math.ceil(element.getBoundingClientRect().height) !== lockedHeight || hasLayoutOverflow(element, content)) {
          anomalyReported = true;
          console.warn("[GeoMCP] Standard UI layout changed after its height was locked.", {locked_height: lockedHeight});
        }
      });
    });
    resizeObserver.observe(element);
    resizeObserver.observe(content);

    void (async () => {
      try {
        await Promise.all([
          waitForStandardUiFonts(signal),
          waitForStandardUiAssets(element, signal),
        ]);
        let previousHeight: number | null = null;
        let previousRevision: number | null = null;
        while (lockedHeight === null) {
          await waitForAnimationFrame(signal);
          const measuredHeight = Math.ceil(element.getBoundingClientRect().height);
          const currentRevision = resizeRevision;
          if (measuredHeight === previousHeight && currentRevision === previousRevision) {
            lockedHeight = measuredHeight;
            break;
          }
          previousHeight = measuredHeight;
          previousRevision = currentRevision;
        }
        if (!Number.isSafeInteger(lockedHeight) || lockedHeight <= 0) {
          throw new AppError("standard_ui_layout_failed", "Standard UI produced an invalid measured height");
        }
        element.style.height = `${lockedHeight}px`;
        element.dataset.lockedHeight = String(lockedHeight);
        setLayoutStatus("locked");
        await waitForAnimationFrame(signal);
        if (Math.ceil(element.getBoundingClientRect().height) !== lockedHeight || hasLayoutOverflow(element, content)) {
          throw new AppError("standard_ui_overflow", "Standard UI content overflowed after its height was locked");
        }
        readyPublished = true;
        setLayoutStatus("ready");
        onReady(lockedHeight);
      } catch (error) {
        if (signal.aborted) return;
        setLayoutStatus("failed");
        onError(AppError.fromUnknown(error, "standard_ui_layout_failed", "Standard UI could not complete layout").message);
      }
    })();

    return () => {
      abortController.abort();
      resizeObserver.disconnect();
      if (anomalyFrameId !== null) cancelAnimationFrame(anomalyFrameId);
    };
  }, [logicalWidth, attributionText, attributionUrl, attributionDescription, hasInitialScale, onReady, onError]);

  const scaleStyle: MetricScaleStyle = {
    "--geomcp-metric-scale-width": `${metricScale?.widthPx ?? 0}px`,
  };
  const featureTypeClass = measurement !== null
    ? `geomcp-standard-bar-measurement-${measurement.kind}`
    : feature === null ? "geomcp-standard-bar-feature-empty" : `geomcp-standard-bar-feature-${feature.featureType}`;
  const measurementRows = measurement === null ? [] : formatCompletedMeasurementRows(measurement);
  const attributionReferences = buildAttributionReferences(attributionText, attributionUrl, attributionDescription);
  const liveTargetLabel = measurement !== null
    ? `Current ${measurement.kind} measurement, ${measurementRows.map((row) => `${row.label} ${row.value}`).join(", ")}`
    : feature === null ? "No current feature" : `Current ${feature.featureType} feature ${feature.displayId}${feature.name === null ? "" : `, ${feature.name}`}`;
  return (
    <footer ref={elementRef} className={`geomcp-standard-bar geomcp-standard-bar-status-${layoutStatus} ${featureTypeClass}`} aria-label="Interactive map standard information" data-standard-ui-status={layoutStatus}>
      <div ref={contentRef} className="geomcp-standard-bar-content">
        <span className="geomcp-standard-bar-block geomcp-standard-bar-block-end geomcp-standard-bar-block-end-left" aria-hidden="true">
          {UI_DECORATIONS_ENABLED ? <>
            <img className="geomcp-ui-decoration geomcp-ui-decoration-standard-end geomcp-ui-decoration-standard-end-up geomcp-ui-decoration-standard-end-left-up" src={UI_SVG_ASSETS.decorations.leftUp} alt="" draggable={false} />
            <img className="geomcp-ui-decoration geomcp-ui-decoration-standard-end geomcp-ui-decoration-standard-end-down geomcp-ui-decoration-standard-end-left-down" src={UI_SVG_ASSETS.decorations.leftDown} alt="" draggable={false} />
          </> : null}
        </span>
        <section className="geomcp-standard-bar-block geomcp-standard-bar-block-scale geomcp-standard-scale" style={scaleStyle} aria-label={metricScale === null ? "Map scale loading" : `Map scale ${metricScale.label}`}>
          <span className="geomcp-standard-scale-label">{metricScale?.label ?? "Scale"}</span>
          <span className="geomcp-standard-scale-rule" aria-hidden="true" />
        </section>
        <StandardBarDivider position="scale-feature" />
        <div
          className={`geomcp-standard-bar-block geomcp-standard-bar-block-feature geomcp-standard-live-feature ${measurement !== null ? `geomcp-standard-live-measurement-${measurement.kind}` : feature === null ? "geomcp-standard-live-feature-empty" : `geomcp-standard-live-feature-${feature.featureType}`}`}
          aria-label={liveTargetLabel}
          aria-live="polite"
          data-feature-state={measurement === null && feature === null ? "empty" : "ready"}
          data-live-target={measurement !== null ? "measurement" : feature === null ? "empty" : "feature"}
          data-target-selected={targetSelected}
        >
          {measurement !== null ? (
            <>
              <span className="geomcp-ui-icon-slot geomcp-ui-icon-slot-standard" aria-hidden="true">
                {targetSelected ? <img className="geomcp-ui-effect geomcp-ui-effect-measurement" src={UI_SVG_ASSETS.hover.measure} alt="" draggable={false} /> : null}
                <img className={`geomcp-ui-icon geomcp-ui-icon-standard-target geomcp-ui-icon-standard-measurement geomcp-ui-icon-standard-measurement-${measurement.kind}`} src={MEASUREMENT_TYPE_ICONS[measurement.kind]} alt="" draggable={false} />
              </span>
              <span className="geomcp-standard-live-feature-id geomcp-standard-live-measurement-kind">测量 {measurement.kind[0].toUpperCase() + measurement.kind.slice(1)}</span>
              {/* name 槽位不显示测量数值；详细数值保留在 Popup 和可访问摘要中。 */}
            </>
          ) : feature === null ? (
            <>
              <img className="geomcp-ui-icon geomcp-ui-icon-standard-target geomcp-ui-icon-standard-empty" src={UI_SVG_ASSETS.icons.empty} alt="" draggable={false} aria-hidden="true" />
              <span className="geomcp-standard-live-feature-empty-prompt">{UI_BUILT_IN_CONFIG.standardUi.emptyPrompt}</span>
            </>
          ) : (
            <>
              {/* 摘要 target 来自地图 hover/selection；非点击图标本身不另建交互状态。 */}
              <span className="geomcp-ui-icon-slot geomcp-ui-icon-slot-standard" aria-hidden="true">
                {targetSelected ? <img className="geomcp-ui-effect geomcp-ui-effect-feature" src={UI_SVG_ASSETS.hover.feature} alt="" draggable={false} /> : null}
                <img className={`geomcp-ui-icon geomcp-ui-icon-standard-target geomcp-ui-icon-standard-feature-${feature.featureType}`} src={FEATURE_TYPE_ICONS[feature.featureType]} alt="" draggable={false} />
              </span>
              <span className="geomcp-standard-live-feature-id">{feature.displayId}</span>
              {feature.name === null ? null : <span className="geomcp-standard-live-feature-name">{feature.name}</span>}
            </>
          )}
        </div>
        <StandardBarDivider position="feature-attribution" />
        <div className="geomcp-standard-bar-block geomcp-standard-bar-block-attribution geomcp-standard-attribution" aria-label="Map attribution">
          {attributionReferences.map((reference, index) => (
            <span className="geomcp-standard-attribution-item" key={`${index}:${reference.attribution}`}>
              {index === 0 ? null : <span className="geomcp-standard-attribution-separator" aria-hidden="true">{UI_BUILT_IN_CONFIG.attribution.separator}</span>}
              {reference.attribution_url === null
                ? <span className="geomcp-standard-attribution-text">{reference.attribution}</span>
                : <a className="geomcp-standard-attribution-link" href={reference.attribution_url} target="_blank" rel="noreferrer" title={reference.title}>{reference.attribution}</a>}
            </span>
          ))}
        </div>
        <span className="geomcp-standard-bar-block geomcp-standard-bar-block-end geomcp-standard-bar-block-end-right" aria-hidden="true">
          {UI_DECORATIONS_ENABLED ? <>
            <img className="geomcp-ui-decoration geomcp-ui-decoration-standard-end geomcp-ui-decoration-standard-end-up geomcp-ui-decoration-standard-end-right-up" src={UI_SVG_ASSETS.decorations.rightUp} alt="" draggable={false} />
            <img className="geomcp-ui-decoration geomcp-ui-decoration-standard-end geomcp-ui-decoration-standard-end-down geomcp-ui-decoration-standard-end-right-down" src={UI_SVG_ASSETS.decorations.rightDown} alt="" draggable={false} />
          </> : null}
        </span>
      </div>
      {UI_DECORATIONS_ENABLED ? (
        <span className="geomcp-standard-bar-end" aria-hidden="true">
          <img className="geomcp-ui-decoration geomcp-ui-decoration-standard-bar-end" src={UI_SVG_ASSETS.bar.standardEnd} alt="" draggable={false} />
        </span>
      ) : null}
    </footer>
  );
}
