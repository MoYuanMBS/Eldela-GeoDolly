import {useEffect, useRef, useState, type CSSProperties} from "react";
import leftEndDecorationUrl from "../../../assets/ui/decorations/left-up.svg";
import referenceBarDividerUrl from "../../../assets/ui/decorations/reference-bar-divider.svg";
import rightEndDecorationUrl from "../../../assets/ui/decorations/right-up.svg";
import nodeIconUrl from "../../../assets/ui/icons/node.svg";
import polygonIconUrl from "../../../assets/ui/icons/polygon.svg";
import wayIconUrl from "../../../assets/ui/icons/way.svg";
import type {LeafletMetricScaleResult} from "../../models/mapsurface/leaflet-renderer-models.js";
import type {InteractiveFeatureSummaryType} from "../../models/web/interactive-ui-models.js";
import {AppError} from "../../utils/app-error.js";

interface ReferenceBarProps {
  logicalWidth: number;
  attributionText: string;
  attributionUrl: string;
  attributionDescription: string;
  metricScale: LeafletMetricScaleResult | null;
  feature: InteractiveFeatureSummaryType | null;
  onReady(measuredHeight: number): void;
  onError(message: string): void;
}

interface MetricScaleStyle extends CSSProperties {
  "--geomcp-metric-scale-width": string;
}

const FEATURE_TYPE_ICONS = {
  node: nodeIconUrl,
  way: wayIconUrl,
  area: polygonIconUrl,
} as const;

type ReferenceUiStatus = "pending" | "waiting-scale" | "measuring" | "locked" | "ready" | "failed";

function ReferenceBarDivider({position}: {position: "scale-feature" | "feature-attribution"}) {
  return (
    <span className={`reference-bar-divider reference-bar-divider-${position}`} aria-hidden="true">
      <img className="reference-bar-divider-decoration" src={referenceBarDividerUrl} alt="" draggable={false} />
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

async function waitForReferenceUiFonts(signal: AbortSignal): Promise<void> {
  const loadedFonts = await document.fonts.load('400 13px "GeoMCP Source Han Sans"');
  await document.fonts.ready;
  if (signal.aborted) throw signal.reason;
  if (loadedFonts.length === 0) {
    throw new AppError("reference_ui_font_failed", "Reference UI font could not be loaded");
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
        reject(new AppError("reference_ui_asset_failed", "A Reference UI image asset could not be loaded"));
        return;
      }
      void image.decode().then(resolve, reject);
    };
    const handleLoad = (): void => finish();
    const handleError = (): void => {
      cleanup();
      reject(new AppError("reference_ui_asset_failed", "A Reference UI image asset could not be loaded"));
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

async function waitForReferenceUiAssets(element: HTMLElement, signal: AbortSignal): Promise<void> {
  const images = [...element.querySelectorAll<HTMLImageElement>("img")];
  await Promise.all(images.map((image) => waitForImage(image, signal)));
}

function hasLayoutOverflow(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight;
}

/** Interactive MapSurface 外部的 Scale / Feature / Attribution UI，并负责发布锁定高度。 */
export function ReferenceBar({logicalWidth, attributionText, attributionUrl, attributionDescription, metricScale, feature, onReady, onError}: ReferenceBarProps) {
  const elementRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [layoutStatus, setLayoutStatus] = useState<ReferenceUiStatus>("pending");
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
        if (Math.ceil(element.getBoundingClientRect().height) !== lockedHeight || hasLayoutOverflow(element)) {
          anomalyReported = true;
          console.warn("[GeoMCP] Reference UI layout changed after its height was locked.", {locked_height: lockedHeight});
        }
      });
    });
    resizeObserver.observe(element);
    resizeObserver.observe(content);

    void (async () => {
      try {
        await Promise.all([
          waitForReferenceUiFonts(signal),
          waitForReferenceUiAssets(element, signal),
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
          throw new AppError("reference_ui_layout_failed", "Reference UI produced an invalid measured height");
        }
        element.style.height = `${lockedHeight}px`;
        element.dataset.lockedHeight = String(lockedHeight);
        setLayoutStatus("locked");
        await waitForAnimationFrame(signal);
        if (Math.ceil(element.getBoundingClientRect().height) !== lockedHeight || hasLayoutOverflow(element)) {
          throw new AppError("reference_ui_overflow", "Reference UI content overflowed after its height was locked");
        }
        readyPublished = true;
        setLayoutStatus("ready");
        onReady(lockedHeight);
      } catch (error) {
        if (signal.aborted) return;
        setLayoutStatus("failed");
        onError(AppError.fromUnknown(error, "reference_ui_layout_failed", "Reference UI could not complete layout").message);
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
  const featureTypeClass = feature === null ? "reference-bar-feature-empty" : `reference-bar-feature-${feature.featureType}`;
  return (
    <footer ref={elementRef} className={`reference-bar reference-bar-status-${layoutStatus} ${featureTypeClass}`} aria-label="Map reference information" data-reference-ui-status={layoutStatus}>
      <div ref={contentRef} className="reference-bar-content">
        <span className="reference-bar-block reference-bar-block-end reference-bar-block-end-left" aria-hidden="true">
          <img className="reference-bar-end-decoration reference-bar-end-decoration-left" src={leftEndDecorationUrl} alt="" draggable={false} />
        </span>
        <section className="reference-bar-block reference-bar-block-scale reference-scale" style={scaleStyle} aria-label={metricScale === null ? "Map scale loading" : `Map scale ${metricScale.label}`}>
          <span className="reference-scale-label">{metricScale?.label ?? "Scale"}</span>
          <span className="reference-scale-rule" aria-hidden="true" />
        </section>
        <ReferenceBarDivider position="scale-feature" />
        <div
          className={`reference-bar-block reference-bar-block-feature reference-live-feature ${feature === null ? "reference-live-feature-empty" : `reference-live-feature-${feature.featureType}`}`}
          aria-label={feature === null ? "No current feature" : `Current ${feature.featureType} feature ${feature.displayId}${feature.name === null ? "" : `, ${feature.name}`}`}
          aria-live="polite"
          data-feature-state={feature === null ? "empty" : "ready"}
        >
          {feature === null ? null : (
            <>
              <img className={`reference-live-feature-icon reference-live-feature-icon-${feature.featureType}`} src={FEATURE_TYPE_ICONS[feature.featureType]} alt="" draggable={false} aria-hidden="true" />
              <span className="reference-live-feature-id">{feature.displayId}</span>
              {feature.name === null ? null : <span className="reference-live-feature-name">{feature.name}</span>}
            </>
          )}
        </div>
        <ReferenceBarDivider position="feature-attribution" />
        <div className="reference-bar-block reference-bar-block-attribution reference-attribution">
          <a className="reference-attribution-link" href={attributionUrl} target="_blank" rel="noreferrer" title={attributionDescription}>{attributionText}</a>
        </div>
        <span className="reference-bar-block reference-bar-block-end reference-bar-block-end-right" aria-hidden="true">
          <img className="reference-bar-end-decoration reference-bar-end-decoration-right" src={rightEndDecorationUrl} alt="" draggable={false} />
        </span>
      </div>
    </footer>
  );
}
