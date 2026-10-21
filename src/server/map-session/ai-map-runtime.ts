import {chromium, type Browser, type BrowserContext, type Page} from "playwright";
import {browserMapConfigSchema} from "../../models/backend/config-models.js";
import type {IndexSessionIdType} from "../../models/backend/session-id-models.js";
import {interactiveMapArchiveSchema} from "../../models/backend/map-session-models.js";
import type {ToolExecutionContextType} from "../../models/backend/tool-execution-models.js";
import {aiMapViewSchema, type AiMapBoundsType, type AiMapBrowserPort, type AiMapCenterZoomType, type AiMapJobResult} from "../../models/web/map-app-models.js";
import {AppError} from "../../shared/app-error.js";
import {config} from "../utils/config-loader.js";
import {logger, recordBrowserWarning} from "../utils/logger.js";
import {readInteractiveMapArchiveFile} from "../utils/file-writer.js";
import {getInternalMapOrigin} from "../http/map-http-service.js";
import type {SessionManager} from "./session-manager.js";

interface AiMapEntry {
  sessionId: IndexSessionIdType;
  closeTime: number;
  controller: AbortController;
  context: Promise<BrowserContext> | null;
  page: Page | null;
  busy: boolean;
  initialImage: Buffer | null;
  toolImage: Buffer | null;
}

type AiMapCommand = {kind: "fit"; bbox: AiMapBoundsType} | {kind: "set"; input: AiMapCenterZoomType};

function expired(): AppError {
  return new AppError("session_expired", "地图 Session 已过期");
}

/** Chromium 全局共享，context/page、作业与图片由地图 session 持有，不与 MCP 连接绑定。 */
export class AiMapRuntime {
  private browser: Browser | null = null;
  private readonly entries = new Map<IndexSessionIdType, AiMapEntry>();
  private readonly closingContexts = new Set<Promise<void>>();
  private readonly webConfig = config.getWebConfig();
  private readonly readyTimeoutMs = config.getAppSection("browser_map", browserMapConfigSchema).ready_timeout_seconds * 1000;
  private closed = false;

  constructor(private readonly sessionManager: SessionManager) {}

  async start(): Promise<void> {
    if (this.browser !== null) return;
    if (this.closed) throw new AppError("ai_map_service_closed", "AI map service is closed");
    try {
      const browser = await chromium.launch({headless: true});
      this.browser = browser;
      browser.on("disconnected", () => {
        if (this.browser !== browser) return;
        this.browser = null;
        // 浏览器异常退出后，旧地图不能继续被当作 active；不在访问时自动恢复。
        for (const sessionId of [...this.entries.keys()]) this.sessionManager.closeSession(sessionId);
      });
    } catch (error) {
      throw AppError.fromUnknown(error, "ai_map_browser_start", "AI map Chromium could not be started");
    }
  }

  private requireCurrent(entry: AiMapEntry): void {
    if (this.closed || entry.controller.signal.aborted || this.entries.get(entry.sessionId) !== entry || this.sessionManager.lookupSession(entry.sessionId).status !== "active") throw expired();
  }

  async create(sessionId: IndexSessionIdType, execution: ToolExecutionContextType): Promise<AiMapJobResult> {
    execution.throwIfAborted();
    const lookup = this.sessionManager.lookupSession(sessionId);
    if (lookup.status !== "active") throw expired();
    if (this.entries.has(sessionId)) throw new AppError("ai_map_busy", "AI map session already has a running instance");
    if (this.browser === null || this.closed) {
      this.sessionManager.closeSession(sessionId);
      throw new AppError("ai_map_browser_unavailable", "AI map Chromium is not available");
    }
    if (this.entries.size >= this.webConfig.tool_execution.max_workers * 10) {
      let oldest: AiMapEntry | null = null;
      for (const candidate of this.entries.values()) {
        if (oldest === null || candidate.closeTime < oldest.closeTime) oldest = candidate;
      }
      // 按截止时间直接关闭，不跳过正在初始化、移动或截图的 session；User 访问也同步撤销。
      if (oldest !== null) this.sessionManager.closeSession(oldest.sessionId);
    }
    const entry: AiMapEntry = {sessionId, closeTime: lookup.record.close_time, controller: new AbortController(), context: null, page: null, busy: false, initialImage: null, toolImage: null};
    // 在首次 await 前登记名额，避免并发创建突破容量。
    this.entries.set(sessionId, entry);
    return this.runJob(entry, null, execution);
  }

  async run(sessionId: IndexSessionIdType, command: AiMapCommand, execution: ToolExecutionContextType): Promise<AiMapJobResult> {
    this.requireActiveSession(sessionId);
    const entry = this.entries.get(sessionId)!;
    return this.runJob(entry, command, execution);
  }

  /** 排队前与取得执行名额后都检查；已过期调用不能先被全局 busy/排队遮盖。 */
  requireActiveSession(sessionId: IndexSessionIdType): void {
    if (this.sessionManager.lookupSession(sessionId).status !== "active") throw expired();
    if (!this.entries.has(sessionId)) throw new AppError("ai_map_unavailable", "This session has no AI map");
  }

  image(sessionId: IndexSessionIdType, slot: "initial" | "tool"): Buffer | null {
    const entry = this.entries.get(sessionId);
    return (slot === "initial" ? entry?.initialImage : entry?.toolImage) ?? null;
  }

  private imageUrl(sessionId: IndexSessionIdType, initial: boolean): string {
    return `${this.webConfig.http.map.public_origin}/${encodeURIComponent(sessionId)}/aimap/${initial ? "" : "map_tool_call/"}webp`;
  }

  private async initializePage(entry: AiMapEntry): Promise<Page> {
    // 被淘汰 context 真实退出后再分配新资源，正在创建 context 的 Promise 也纳入关闭等待。
    await Promise.all([...this.closingContexts]);
    this.requireCurrent(entry);
    const browser = this.browser;
    if (browser === null) throw new AppError("ai_map_browser_unavailable", "AI map Chromium is not available");
    const archiveInput = await readInteractiveMapArchiveFile(entry.sessionId);
    this.requireCurrent(entry);
    if (archiveInput === null) throw new AppError("ai_map_archive_missing", "AI map archive is missing");
    const archive = interactiveMapArchiveSchema.parse(archiveInput);
    const [mapWidth, mapHeight] = archive.map_payload.screenshot_size;
    entry.context = browser.newContext({deviceScaleFactor: 1, colorScheme: "light", viewport: {width: mapWidth + 48, height: mapHeight + 48}});
    const context = await entry.context;
    this.requireCurrent(entry);
    const page = await context.newPage();
    entry.page = page;
    const closeSession = (): void => {
      if (this.entries.get(entry.sessionId) === entry) this.sessionManager.closeSession(entry.sessionId);
    };
    page.on("console", (message) => {
      if (!message.text().startsWith("[GeoMCP] AI map diagnostic.")) return;
      void message.args()[1]?.jsonValue().then(recordBrowserWarning).catch(() => undefined);
    });
    page.on("crash", closeSession);
    page.on("close", closeSession);
    page.setDefaultTimeout(0);
    page.setDefaultNavigationTimeout(0);
    const response = await page.goto(`${getInternalMapOrigin(this.webConfig.http)}/session/${encodeURIComponent(entry.sessionId)}/aimap`, {waitUntil: "domcontentloaded"});
    if (response === null || !response.ok()) throw new AppError("ai_map_page_request", "AI map page could not be loaded", {status: response?.status() ?? null});
    await page.waitForFunction(() => {
      const port = (window as unknown as {geomcpAiMap?: AiMapBrowserPort}).geomcpAiMap;
      return port !== undefined || document.querySelector<HTMLElement>("[data-geomcp-ai-map-status]")?.dataset.geomcpAiMapStatus === "failed";
    });
    const failure = await page.evaluate(() => {
      const failed = document.querySelector<HTMLElement>('[data-geomcp-ai-map-status="failed"]');
      return failed?.textContent ?? null;
    });
    if (failure !== null) throw new AppError("ai_map_initialization_failed", failure);
    return page;
  }

  private async runJob(entry: AiMapEntry, command: AiMapCommand | null, execution: ToolExecutionContextType): Promise<AiMapJobResult> {
    this.requireCurrent(entry);
    execution.throwIfAborted();
    if (entry.busy) throw new AppError("ai_map_busy", "An AI map operation is still running");
    entry.busy = true;
    const budget = new AbortController();
    const signal = AbortSignal.any([entry.controller.signal, execution.signal, budget.signal]);
    const timer = setTimeout(() => budget.abort(new AppError("ai_map_job_timeout", "AI map operation exceeded its ready budget")), Math.max(1, Math.min(this.readyTimeoutMs, execution.remainingTimeMs())));
    // page.evaluate 无法只靠外层 Promise 取消；关闭 context 才能终止在浏览器中执行的旧工作。
    const abort = (): void => {
      if (this.entries.get(entry.sessionId) === entry) this.sessionManager.closeSession(entry.sessionId);
    };
    signal.addEventListener("abort", abort, {once: true});
    try {
      if (signal.aborted) abort();
      let page = entry.page;
      if (command === null) {
        try {
          page = await this.initializePage(entry);
        } catch (error) {
          const wasClosed = entry.controller.signal.aborted;
          if (this.entries.get(entry.sessionId) === entry) this.sessionManager.closeSession(entry.sessionId);
          if (wasClosed) throw expired();
          throw AppError.fromUnknown(error, "ai_map_initialization_failed", "AI map could not initialize");
        }
      }
      this.requireCurrent(entry);
      if (page === null) throw new AppError("ai_map_unavailable", "AI map page is not ready");
      if (command !== null) entry.toolImage = null;
      const result = await page.evaluate((operation) => {
        const port = (window as unknown as {geomcpAiMap: AiMapBrowserPort}).geomcpAiMap;
        try {
          const view = operation === null ? port.getView() : operation.kind === "fit" ? port.fitBounds(operation.bbox) : port.setCenterZoom(operation.input);
          return {view, error: null};
        } catch (error) {
          const failure = error as {toJSON?: () => {code: string; message: string; details: null}} | null;
          return {view: null, error: failure?.toJSON?.() ?? {code: "ai_map_view_failed", message: String(error), details: null}};
        }
      }, command);
      this.requireCurrent(entry);
      if (result.error !== null) throw new AppError(result.error.code, result.error.message, result.error.details);
      const view = aiMapViewSchema.parse(result.view);
      try {
        const image = await this.capture(entry, page);
        this.requireCurrent(entry);
        execution.throwIfAborted();
        if (command === null) entry.initialImage = image;
        else entry.toolImage = image;
        return {view, visual_url: this.imageUrl(entry.sessionId, command === null)};
      } catch (error) {
        this.requireCurrent(entry);
        execution.throwIfAborted();
        const warning = AppError.fromUnknown(error, "ai_map_screenshot_failed", "AI map screenshot failed").toJSON();
        logger.warning("ai_map_screenshot_failed", {session_id: entry.sessionId, code: warning.code, message: warning.message});
        return {view, warning};
      }
    } catch (error) {
      if (entry.controller.signal.aborted || this.entries.get(entry.sessionId) !== entry) throw expired();
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      entry.busy = false;
    }
  }

  private async capture(entry: AiMapEntry, page: Page): Promise<Buffer> {
    await page.evaluate(() => (window as unknown as {geomcpAiMap: AiMapBrowserPort}).geomcpAiMap.waitForScreenshot());
    this.requireCurrent(entry);
    const wrapper = page.locator(".geomcp-snapshot-wrapper");
    const box = await wrapper.boundingBox();
    if (box === null) throw new AppError("ai_map_capture_layout", "AI map wrapper is not visible");
    if (Math.ceil(box.width) * Math.ceil(box.height) > this.webConfig.snapshot.max_wrapper_physical_pixels) throw new AppError("screenshot_pixel_budget", "AI map wrapper exceeds its pixel budget");
    const png = await wrapper.screenshot({type: "png", animations: "disabled", caret: "hide"});
    this.requireCurrent(entry);
    // DOM 只捕获一次；浏览器 Canvas 对这张 PNG 编码/缩图，不改变 Leaflet 视口或重拍页面。
    const bytes = await page.evaluate(async ({raw, limits}) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(raw)], {type: "image/png"}));
      const original = document.createElement("canvas");
      const scaled = document.createElement("canvas");
      try {
        original.width = bitmap.width;
        original.height = bitmap.height;
        const originalContext = original.getContext("2d", {alpha: false});
        if (originalContext === null) throw new Error("AI screenshot Canvas could not initialize");
        originalContext.fillStyle = "#ffffff";
        originalContext.fillRect(0, 0, original.width, original.height);
        originalContext.drawImage(bitmap, 0, 0);
        const originalSide = Math.max(original.width, original.height);
        const minimumSide = Math.min(originalSide, 640);
        let side = originalSide;
        let quality = 0.95;
        let retries = 0;
        let finalFallback = false;
        while (true) {
          let canvas = original;
          if (side < originalSide) {
            scaled.width = Math.max(1, Math.round(original.width * side / originalSide));
            scaled.height = Math.max(1, Math.round(original.height * side / originalSide));
            const context = scaled.getContext("2d", {alpha: false});
            if (context === null) throw new Error("AI screenshot resize Canvas could not initialize");
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, scaled.width, scaled.height);
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = "high";
            context.drawImage(original, 0, 0, scaled.width, scaled.height);
            canvas = scaled;
          }
          const encoded = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
            if (blob === null || blob.type !== "image/webp") reject(new Error("AI screenshot WebP encoding failed"));
            else resolve(blob);
          }, "image/webp", quality));
          if (encoded.size <= limits.max_image_bytes) return [...new Uint8Array(await encoded.arrayBuffer())];
          if (finalFallback || (side === minimumSide && quality === 0.65)) return null;
          if (retries < limits.max_encode_retries) {
            retries += 1;
            if (quality > 0.65) quality = Math.max(0.65, quality - 0.15);
            else {
              side = Math.max(minimumSide, Math.min(2048, Math.floor(side * Math.sqrt(limits.max_image_bytes / encoded.size) * 0.9)));
              quality = 0.95;
            }
          } else {
            finalFallback = true;
            side = minimumSide;
            quality = 0.65;
          }
        }
      } finally {
        bitmap.close();
        original.width = original.height = scaled.width = scaled.height = 0;
      }
    }, {raw: [...png], limits: this.webConfig.snapshot});
    this.requireCurrent(entry);
    if (bytes === null) throw new AppError("screenshot_byte_budget", "AI screenshot exceeds the WebP byte budget after compression");
    const image = Buffer.from(bytes);
    if (image.byteLength > this.webConfig.snapshot.max_image_bytes || image.toString("ascii", 0, 4) !== "RIFF" || image.toString("ascii", 8, 12) !== "WEBP") throw new AppError("screenshot_format_invalid", "AI screenshot did not produce a valid WebP within its budget");
    return image;
  }

  /** SessionManager 同步撤销访问后调用；先撤销结果写回，再等待隔离 context 真实释放。 */
  releaseSession(sessionId: IndexSessionIdType): void {
    const entry = this.entries.get(sessionId);
    if (entry === undefined) return;
    this.entries.delete(sessionId);
    entry.controller.abort(expired());
    entry.initialImage = entry.toolImage = null;
    if (entry.context !== null) {
      const close = entry.context.then(async (context) => {
        try {
          await context.close();
        } catch (error) {
          logger.warning("ai_map_context_close_failed", {session_id: sessionId, reason: error instanceof Error ? error.message : String(error)});
        }
      }, () => undefined);
      this.closingContexts.add(close);
      void close.finally(() => this.closingContexts.delete(close));
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const sessionId of [...this.entries.keys()]) this.sessionManager.closeSession(sessionId);
    await Promise.all([...this.closingContexts]);
    const browser = this.browser;
    this.browser = null;
    await browser?.close();
  }
}
