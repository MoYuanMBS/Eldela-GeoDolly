/** Map Session 使用共享 Chromium 与独立 BrowserContext 生成 Snapshot WebP。 */

import {chromium, type Browser, type BrowserContext} from "playwright";
import type {SnapshotConfigType} from "../models/backend/config-models.js";
import type {IndexSessionIdType} from "../models/backend/session-id-models.js";
import {
  snapshotBrowserReadySummarySchema,
  snapshotDiagnosticsSchema,
  snapshotMapDataSchema,
  type SnapshotMapDataType,
} from "../models/web/snapshot-ui-models.js";
import {AppError} from "../utils/app-error.js";
import {logger, recordBrowserWarning} from "../utils/logger.js";

const SNAPSHOT_WRAPPER_SELECTOR = ".geomcp-snapshot-wrapper";
const PAGE_FRAME_PADDING_PX = 48;

function createAbortError(signal: AbortSignal): AppError {
  if (signal.reason instanceof AppError) return signal.reason;
  const message = signal.reason instanceof Error ? signal.reason.message : "Snapshot capture was aborted";
  return new AppError("snapshot_aborted", message, null, signal.reason instanceof Error ? {cause: signal.reason} : undefined);
}

function requireActiveSignal(signal: AbortSignal): void {
  if (signal.aborted) throw createAbortError(signal);
}

function recordCleanupWarning(event: string, error: unknown): void {
  logger.warning(event, {source: "snapshot", reason: error instanceof Error ? error.message : String(error)});
}

/**
 * Browser 生命周期由服务持有，每次截图只创建隔离的 context/page。并发数量不在这里另造第二套队列，
 * 而是服从已经取得名额的 Tool worker；关闭或 Tool deadline 会实际关闭对应 context。
 */
export class SnapshotService {
  private browser: Browser | null = null;
  private readonly activeContexts = new Set<BrowserContext>();

  constructor(
    private readonly internalMapOrigin: string,
    private readonly config: SnapshotConfigType,
  ) {}

  /** 启动全局共享 Chromium；重复调用不会创建第二个 browser process。 */
  async start(): Promise<boolean> {
    if (this.browser !== null) return true;
    try {
      this.browser = await chromium.launch({headless: true});
      return true;
    } catch (error) {
      throw AppError.fromUnknown(error, "snapshot_browser_start", "Snapshot Chromium could not be started");
    }
  }

  /**
   * 在调用方现有 deadline signal 内打开已登记 Session 的 Snapshot Interactive 页面，
   * 完成截图后只返回 WebP bytes。文件写入仍由 Tool Flow 持有。
   */
  async capture(sessionId: IndexSessionIdType, payload: unknown, signal: AbortSignal): Promise<Buffer> {
    requireActiveSignal(signal);
    const browser = this.browser;
    if (browser === null) throw new AppError("snapshot_browser_not_started", "Snapshot service must be started before capture");

    let snapshotData: SnapshotMapDataType;
    try {
      snapshotData = snapshotMapDataSchema.parse(payload);
    } catch (error) {
      throw AppError.fromUnknown(error, "invalid_snapshot_payload", "Snapshot payload is invalid");
    }

    const [mapWidth, mapHeight] = snapshotData.map_payload.screenshot_size;
    if (mapWidth * mapHeight > this.config.max_wrapper_physical_pixels) {
      throw new AppError("snapshot_pixel_budget", "Snapshot MapSurface exceeds the physical pixel budget", {
        width: mapWidth,
        height: mapHeight,
        max_pixels: this.config.max_wrapper_physical_pixels,
      });
    }

    let context: BrowserContext | null = null;
    const closeContextOnAbort = (): void => {
      if (context !== null) void context.close().catch((error: unknown) => recordCleanupWarning("snapshot_context_close_failed", error));
    };
    signal.addEventListener("abort", closeContextOnAbort, {once: true});

    try {
      context = await browser.newContext({
        deviceScaleFactor: 1,
        viewport: {width: mapWidth + PAGE_FRAME_PADDING_PX, height: mapHeight + PAGE_FRAME_PADDING_PX},
      });
      this.activeContexts.add(context);
      requireActiveSignal(signal);
      const page = await context.newPage();
      const snapshotPageUrl = `${this.internalMapOrigin}/session/${encodeURIComponent(sessionId)}/snapshot-interactive`;
      const pageResponse = await page.goto(snapshotPageUrl, {waitUntil: "domcontentloaded", timeout: 0});
      if (pageResponse === null || !pageResponse.ok()) {
        throw new AppError("snapshot_page_request", "Snapshot Interactive page could not be loaded", {
          url: snapshotPageUrl,
          status: pageResponse?.status() ?? null,
        });
      }
      requireActiveSignal(signal);

      const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
      if (devicePixelRatio !== 1) {
        throw new AppError("snapshot_device_pixel_ratio", "Snapshot browser did not use deviceScaleFactor 1", {device_pixel_ratio: devicePixelRatio});
      }

      // 页面自己负责所有必要子流程；Playwright 只等待显式终态，不用 sleep 或 networkidle 猜测完成。
      await page.waitForFunction(() => {
        const status = document.querySelector<HTMLElement>("[data-geomcp-ready-status]")?.dataset.geomcpReadyStatus;
        return status === "ready" || status === "failed";
      }, undefined, {timeout: 0});
      requireActiveSignal(signal);

      const statusElement = page.locator("[data-geomcp-ready-status]").first();
      const recordedDiagnosticKeys = new Set<string>();
      const recordSnapshotDiagnostics = async (): Promise<void> => {
        const rawDiagnostics = await statusElement.getAttribute("data-geomcp-snapshot-diagnostics");
        if (rawDiagnostics === null) throw new AppError("snapshot_diagnostics", "Snapshot browser omitted its diagnostics channel");
        let diagnostics;
        try {
          diagnostics = snapshotDiagnosticsSchema.parse(JSON.parse(rawDiagnostics) as unknown);
        } catch (error) {
          throw AppError.fromUnknown(error, "snapshot_diagnostics", "Snapshot browser returned invalid diagnostics");
        }
        for (const diagnostic of diagnostics) {
          const key = JSON.stringify(diagnostic);
          if (recordedDiagnosticKeys.has(key)) continue;
          recordedDiagnosticKeys.add(key);
          recordBrowserWarning(diagnostic);
        }
      };

      // diagnostics 不参与 ready 判定；先独立回收一次，确保 Browser failed 时也不会丢失 fallback 原因。
      await recordSnapshotDiagnostics();
      const readyStatus = await statusElement.getAttribute("data-geomcp-ready-status");
      if (readyStatus !== "ready") {
        const browserMessage = await statusElement.getAttribute("data-geomcp-ready-error");
        throw new AppError("snapshot_browser_failed", browserMessage ?? "Snapshot browser flow failed");
      }

      const rawReadySummary = await statusElement.getAttribute("data-geomcp-ready-summary");
      if (rawReadySummary === null) throw new AppError("snapshot_ready_summary", "Snapshot browser omitted its ready summary");
      let readySummary;
      try {
        readySummary = snapshotBrowserReadySummarySchema.parse(JSON.parse(rawReadySummary) as unknown);
      } catch (error) {
        throw AppError.fromUnknown(error, "snapshot_ready_summary", "Snapshot browser returned an invalid ready summary");
      }

      const expectedLogicalHeight = mapHeight + readySummary.reference_ui.measured_height;
      if (readySummary.final_logical_height !== expectedLogicalHeight) {
        throw new AppError("snapshot_layout_mismatch", "Snapshot browser reported an inconsistent final height", {
          expected_height: expectedLogicalHeight,
          reported_height: readySummary.final_logical_height,
        });
      }
      if (mapWidth * expectedLogicalHeight > this.config.max_wrapper_physical_pixels) {
        throw new AppError("snapshot_pixel_budget", "Snapshot wrapper exceeds the physical pixel budget", {
          width: mapWidth,
          height: expectedLogicalHeight,
          max_pixels: this.config.max_wrapper_physical_pixels,
        });
      }

      const wrapper = page.locator(SNAPSHOT_WRAPPER_SELECTOR);
      const wrapperBox = await wrapper.boundingBox();
      if (wrapperBox === null) throw new AppError("snapshot_wrapper_missing", "Snapshot wrapper is not visible");
      const actualWidth = Math.ceil(wrapperBox.width);
      const actualHeight = Math.ceil(wrapperBox.height);
      if (actualWidth !== mapWidth || actualHeight !== expectedLogicalHeight) {
        throw new AppError("snapshot_layout_mismatch", "Snapshot wrapper dimensions do not match the ready summary", {
          expected_width: mapWidth,
          expected_height: expectedLogicalHeight,
          actual_width: actualWidth,
          actual_height: actualHeight,
        });
      }

      for (const warning of readySummary.warnings) logger.warning(warning, {source: "snapshot"});
      // ready 后仍可能发生 origin runtime warning；截图前再次读取并按协议内容去重。
      await recordSnapshotDiagnostics();
      requireActiveSignal(signal);
      return await wrapper.screenshot({type: "webp", quality: 100, animations: "disabled", caret: "hide"});
    } catch (error) {
      if (signal.aborted) throw createAbortError(signal);
      throw AppError.fromUnknown(error, "snapshot_capture", "Snapshot capture failed");
    } finally {
      signal.removeEventListener("abort", closeContextOnAbort);
      if (context !== null) {
        this.activeContexts.delete(context);
        await context.close().catch((error: unknown) => recordCleanupWarning("snapshot_context_close_failed", error));
      }
    }
  }

  /** 关闭全部进行中的页面与共享 browser。 */
  async close(): Promise<boolean> {
    const browser = this.browser;
    this.browser = null;
    const contexts = [...this.activeContexts];
    this.activeContexts.clear();
    await Promise.all(contexts.map(async (context) => context.close().catch((error: unknown) => recordCleanupWarning("snapshot_context_close_failed", error))));
    if (browser !== null) await browser.close().catch((error: unknown) => recordCleanupWarning("snapshot_browser_close_failed", error));
    return true;
  }
}
