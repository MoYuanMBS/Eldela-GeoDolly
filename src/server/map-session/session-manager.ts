/** 可由公开 Session routes 查找的唯一 RAM 索引与低频 checkpoint 生命周期。 */

import type {SessionConfigType} from "../../models/backend/config-models.js";
import {
  type SessionIndexRecordType,
  type SessionLookupResultType,
  type SessionsJsonType,
} from "../../models/backend/session-manager-models.js";
import type {IndexSessionIdType} from "../../models/backend/session-id-models.js";
import {AppError} from "../../shared/app-error.js";
import {writeSessionsJson} from "../utils/file-writer.js";
import {logger} from "../utils/logger.js";

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function timerDelayMilliseconds(seconds: number, maximumDelayMs: number): number {
  return Math.min(maximumDelayMs, Math.max(1, Math.round(seconds * 1000)));
}

/**
 * 业务产物提交与 Session 关闭独立；关闭只撤销访问并通知运行资源所有者。
 * checkpoint 只保存本进程索引，启动不恢复旧记录，关闭不删除成功归档。
 */
export class SessionManager {
  private sessions: SessionsJsonType = {};
  private readonly activeSessionIds = new Set<IndexSessionIdType>();
  private dirty = false;
  private checkpointPromise: Promise<boolean> | null = null;
  private expiryTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private closing = false;
  private closed = false;

  // 临时复用现有 expiry timer 清理入口持有的搜索候选缓存。
  constructor(
    private readonly config: SessionConfigType,
    private readonly onExpiryCheck?: (nowSeconds: number) => void,
    private readonly onSessionClosed?: (sessionId: IndexSessionIdType) => void,
  ) {}

  private requireRunning(): void {
    if (!this.started || this.closing || this.closed) {
      throw new AppError("session_manager_not_running", "Session manager is not running");
    }
  }

  private markDirty(): void {
    this.dirty = true;
  }

  private scheduleTimers(): void {
    this.expiryTimer = setInterval(() => {
      this.sweepExpiredSessions();
    }, timerDelayMilliseconds(this.config.expiry_check_interval_seconds, this.config.max_timer_delay_ms));
    this.expiryTimer.unref();

    this.flushTimer = setInterval(() => {
      void this.flushCheckpoint();
    }, timerDelayMilliseconds(this.config.flush_interval_seconds, this.config.max_timer_delay_ms));
    this.flushTimer.unref();
  }

  /** 每次进程启动使用空索引；旧 checkpoint 和归档均不恢复服务。 */
  async start(): Promise<boolean> {
    if (this.started) return true;
    if (this.closed) throw new AppError("session_manager_closed", "Closed Session manager cannot be restarted");

    this.sessions = {};
    this.activeSessionIds.clear();

    this.started = true;
    this.scheduleTimers();
    return true;
  }

  /**
   * selected-query 与 RAM 登记必须复用这里生成的同一 record；发布耗时不会重新计算 TTL。
   */
  createRecord(query: string, name?: string | null): SessionIndexRecordType {
    this.requireRunning();
    const openTime = Math.floor(Date.now() / 1000);
    return {
      query,
      created_time: openTime,
      open_time: openTime,
      close_time: openTime + this.config.ttl_seconds,
      ...(name === undefined ? {} : {name}),
    };
  }

  /** 覆盖登记调用方已经校验的 RAM record；发布阶段与失败撤销由 Tool Flow 持有。 */
  registerSession(sessionIdInput: IndexSessionIdType, recordInput: SessionIndexRecordType): boolean {
    this.requireRunning();
    const sessionId = sessionIdInput;

    // 保存副本，避免调用方在登记后绕开 manager 原地修改 RAM 真源。
    this.deactivateSession(sessionId);
    const record = {...recordInput};
    this.sessions[sessionId] = record;
    if (Date.now() / 1000 < recordInput.close_time) this.activeSessionIds.add(sessionId);
    else this.activeSessionIds.delete(sessionId);
    this.markDirty();
    this.scheduleDeadline();
    return true;
  }

  /** 自然到期与容量淘汰共用关闭入口；保留 record 供 HTTP 返回 410。 */
  closeSession(sessionId: IndexSessionIdType): boolean {
    this.requireRunning();
    const changed = this.deactivateSession(sessionId);
    this.scheduleDeadline();
    return changed;
  }

  private deactivateSession(sessionId: IndexSessionIdType): boolean {
    if (!this.activeSessionIds.delete(sessionId)) return false;
    try {
      this.onSessionClosed?.(sessionId);
    } catch (error) {
      logger.warning("session_close_callback_failed", {session_id: sessionId, reason: errorReason(error)});
    }
    return true;
  }

  private scheduleDeadline(): void {
    if (this.deadlineTimer !== null) clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
    let nextCloseTime = Infinity;
    for (const sessionId of this.activeSessionIds) nextCloseTime = Math.min(nextCloseTime, this.sessions[sessionId].close_time);
    if (!Number.isFinite(nextCloseTime) || this.closing || this.closed) return;
    // 一个最近截止 timer 负责资源释放；入口仍核对时钟，避免事件循环延迟延长访问期限。
    this.deadlineTimer = setTimeout(() => this.sweepExpiredSessions(), timerDelayMilliseconds(nextCloseTime - Date.now() / 1000, this.config.max_timer_delay_ms));
    this.deadlineTimer.unref();
  }

  /** HTTP 发现已登记归档被人工删除时移除 RAM 真源，后续 checkpoint 会持久化该变化。 */
  unregisterSession(sessionId: IndexSessionIdType): boolean {
    this.requireRunning();
    if (!(sessionId in this.sessions)) return false;
    this.deactivateSession(sessionId);
    delete this.sessions[sessionId];
    this.markDirty();
    this.scheduleDeadline();
    return true;
  }

  /** 公开消费者只读取 RAM 真源；文件是否可读由后续 HTTP/file-serving 边界负责。 */
  lookupSession(sessionIdInput: IndexSessionIdType): SessionLookupResultType {
    this.requireRunning();
    const sessionId = sessionIdInput;
    const record = this.sessions[sessionId];
    if (record === undefined) return {status: "missing"};
    if (this.activeSessionIds.has(sessionId) && Date.now() / 1000 >= record.close_time) this.closeSession(sessionId);

    // 返回副本，避免 HTTP 等消费者绕开 manager 原地修改 RAM 真源。
    const recordCopy = {...record};
    return this.activeSessionIds.has(sessionId)
      ? {status: "active", record: recordCopy}
      : {status: "archived", record: recordCopy};
  }

  private sweepExpiredSessions(): void {
    const nowSeconds = Date.now() / 1000;
    for (const [rawSessionId, record] of Object.entries(this.sessions)) {
      if (nowSeconds >= record.close_time) this.deactivateSession(rawSessionId as IndexSessionIdType);
    }
    this.scheduleDeadline();
    try {
      this.onExpiryCheck?.(nowSeconds);
    } catch (error) {
      logger.warning("session_expiry_callback_failed", {reason: errorReason(error)});
    }
  }

  private flushCheckpoint(): Promise<boolean> {
    if (this.checkpointPromise !== null) return this.checkpointPromise;
    if (!this.dirty) return Promise.resolve(true);

    // 先截取当前 mapping，再清除本轮 dirty；写入期间的新变化会把 dirty 重新设为 true。
    const snapshot: SessionsJsonType = {...this.sessions};
    this.dirty = false;
    const checkpointPromise = writeSessionsJson(snapshot)
      .then(() => true)
      .catch((error: unknown) => {
        this.dirty = true;
        logger.warning("session_checkpoint_failed", {
          status: "retry_pending",
          reason: errorReason(error),
        });
        return false;
      })
      .finally(() => {
        if (this.checkpointPromise === checkpointPromise) this.checkpointPromise = null;
      });
    this.checkpointPromise = checkpointPromise;
    return checkpointPromise;
  }

  /** 主动保存一次当前一致快照；失败已记录 warning，并保留 dirty 供后续重试。 */
  async flush(): Promise<boolean> {
    this.requireRunning();
    return this.flushCheckpoint();
  }

  /** 停止新增工作，等待在途 sweep/checkpoint，再对仍然 dirty 的状态做一次最终保存。 */
  async close(): Promise<boolean> {
    if (this.closed) return true;
    if (!this.started) {
      this.closed = true;
      return true;
    }
    this.closing = true;
    if (this.expiryTimer !== null) clearInterval(this.expiryTimer);
    if (this.flushTimer !== null) clearInterval(this.flushTimer);
    if (this.deadlineTimer !== null) clearTimeout(this.deadlineTimer);
    this.expiryTimer = null;
    this.flushTimer = null;
    this.deadlineTimer = null;
    for (const sessionId of this.activeSessionIds) this.deactivateSession(sessionId);

    if (this.checkpointPromise !== null) await this.checkpointPromise;
    const saved = this.dirty ? await this.flushCheckpoint() : true;

    this.started = false;
    this.closed = true;
    return saved;
  }
}
