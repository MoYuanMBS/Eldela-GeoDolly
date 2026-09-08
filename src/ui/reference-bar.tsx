import {useEffect, useRef, useState, type CSSProperties} from "react";
import {UI_SVG_ASSETS} from "../built-in-config/ui-svg.js";
import {UI_BUILT_IN_CONFIG} from "../built-in-config/ui.js";
import {AppError} from "../utils/app-error.js";
import type {MetricScaleViewType} from "../web/map-surface-port.js";

interface ReferenceBarProps {
  logicalWidth: number;
  attributionText: string;
  metricScale: MetricScaleViewType | null;
  onReady(measuredHeight: number): void;
  onError(message: string): void;
}

interface MetricScaleStyle extends CSSProperties {
  "--geomcp-metric-scale-width": string;
}

type ReferenceUiStatus = "pending" | "waiting-scale" | "measuring" | "locked" | "ready" | "failed";

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
  if (loadedFonts.length === 0) throw new AppError("reference_ui_font_failed", "Reference UI font could not be loaded");
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

function hasLayoutOverflow(element: HTMLElement, content: HTMLElement): boolean {
  return content.offsetWidth > element.clientWidth || content.offsetHeight > element.clientHeight;
}

/** Snapshot 专用 Reference UI；只挂载 Scale、唯一 divider 和无链接 Attribution。 */
export function ReferenceBar({logicalWidth, attributionText, metricScale, onReady, onError}: ReferenceBarProps) {
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
        if (Math.ceil(element.getBoundingClientRect().height) !== lockedHeight || hasLayoutOverflow(element, content)) {
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
          if (measuredHeight === previousHeight && currentRevision === previousRevision) lockedHeight = measuredHeight;
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
        if (Math.ceil(element.getBoundingClientRect().height) !== lockedHeight || hasLayoutOverflow(element, content)) {
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
  }, [logicalWidth, attributionText, hasInitialScale, onReady, onError]);

  const scaleStyle: MetricScaleStyle = {
    "--geomcp-metric-scale-width": `${metricScale?.widthPx ?? 0}px`,
  };
  const attributionReferences = [
    UI_BUILT_IN_CONFIG.attribution.references.tool.attribution,
    UI_BUILT_IN_CONFIG.attribution.references.leaflet.attribution,
    attributionText,
    UI_BUILT_IN_CONFIG.attribution.references.osmData.attribution,
  ];

  return (
    <footer ref={elementRef} className={`geomcp-standard-bar geomcp-reference-bar geomcp-reference-bar-status-${layoutStatus}`} aria-label="Snapshot map reference information" data-reference-ui-status={layoutStatus}>
      <div ref={contentRef} className="geomcp-reference-bar-content">
        <section className="geomcp-standard-bar-block geomcp-standard-bar-block-scale geomcp-standard-scale" style={scaleStyle} aria-label={metricScale === null ? "Map scale loading" : `Map scale ${metricScale.label}`}>
          <span className="geomcp-standard-scale-label">{metricScale?.label ?? "Scale"}</span>
          <span className="geomcp-standard-scale-rule" aria-hidden="true" />
        </section>
        <span className="geomcp-standard-bar-divider geomcp-reference-bar-divider" aria-hidden="true">
          <img className="geomcp-ui-decoration geomcp-ui-decoration-standard-divider" src={UI_SVG_ASSETS.decorations.referenceBarDivider} alt="" draggable={false} />
        </span>
        <div className="geomcp-standard-bar-block geomcp-standard-bar-block-attribution geomcp-standard-attribution" aria-label="Map attribution">
          {attributionReferences.map((reference, index) => (
            <span className="geomcp-standard-attribution-item" key={`${index}:${reference}`}>
              {index === 0 ? null : <span className="geomcp-standard-attribution-separator" aria-hidden="true">{UI_BUILT_IN_CONFIG.attribution.separator}</span>}
              <span className="geomcp-standard-attribution-text">{reference}</span>
            </span>
          ))}
        </div>
      </div>
    </footer>
  );
}
