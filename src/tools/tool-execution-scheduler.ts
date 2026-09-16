/** 三个公开 Tool 共用的有界 FIFO 执行池与唯一总 deadline。 */

import type {ToolExecutionConfigType} from "../models/backend/config-models.js";
import type {ScheduledToolTaskType, ToolExecutionContextType} from "../models/backend/tool-execution-models.js";
import {AppError} from "../utils/app-error.js";

interface PoolWaiter {
  resolve: () => void;
  reject: (error: unknown) => void;
  requestSignal: AbortSignal | undefined;
  handleAbort: (() => void) | null;
}

function requestAbortError(signal: AbortSignal): AppError {
  if (signal.reason instanceof AppError) return signal.reason;
  const message = signal.reason instanceof Error ? signal.reason.message : "Tool execution was cancelled";
  return new AppError("tool_execution_cancelled", message, null, signal.reason instanceof Error ? {cause: signal.reason} : undefined);
}

function requireActiveSignal(signal: AbortSignal): void {
  if (signal.aborted) throw requestAbortError(signal);
}

/**
 * `asyncio.Semaphore` 式的固定许可池：有许可时立即取得，否则按 FIFO 等待。
 * 队列中只保存等待许可的 continuation，不把业务 task 与 worker 状态绑在一起。
 */
class ToolExecutionPool {
  private readonly waiters: PoolWaiter[] = [];
  private availablePermits: number;
  private closed = false;

  constructor(
    maximumConcurrency: number,
    private readonly maximumQueueLength: number,
  ) {
    this.availablePermits = maximumConcurrency;
  }

  async acquire(requestSignal?: AbortSignal): Promise<void> {
    if (this.closed) throw new AppError("tool_scheduler_closed", "Tool scheduler is closed");
    if (requestSignal?.aborted === true) throw requestAbortError(requestSignal);
    if (this.availablePermits > 0) {
      this.availablePermits -= 1;
      return;
    }
    if (this.waiters.length >= this.maximumQueueLength) {
      throw new AppError("tool_execution_busy", "Tool execution queue is full");
    }

    await new Promise<void>((resolve, reject) => {
      const waiter: PoolWaiter = {resolve, reject, requestSignal, handleAbort: null};
      if (requestSignal !== undefined) {
        waiter.handleAbort = () => {
          const waiterIndex = this.waiters.indexOf(waiter);
          if (waiterIndex < 0) return;
          this.waiters.splice(waiterIndex, 1);
          reject(requestAbortError(requestSignal));
        };
        requestSignal.addEventListener("abort", waiter.handleAbort, {once: true});
      }
      this.waiters.push(waiter);
    });
  }

  release(): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (waiter === undefined) break;
      if (waiter.handleAbort !== null && waiter.requestSignal !== undefined) {
        waiter.requestSignal.removeEventListener("abort", waiter.handleAbort);
      }
      if (waiter.requestSignal?.aborted === true) {
        waiter.reject(requestAbortError(waiter.requestSignal));
        continue;
      }
      waiter.resolve();
      return;
    }
    this.availablePermits += 1;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const shutdownError = new AppError("tool_scheduler_closed", "Tool scheduler is shutting down");
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.handleAbort !== null && waiter.requestSignal !== undefined) {
        waiter.requestSignal.removeEventListener("abort", waiter.handleAbort);
      }
      waiter.reject(shutdownError);
    }
  }
}

/**
 * Pool permit 覆盖整次 Tool Flow。排队不计时；取得许可后按已校验的
 * `tool_execution.timeout_seconds` 建立唯一 deadline，Python、Browser 与写盘只消费该 signal。
 */
export class ToolExecutionScheduler {
  private readonly pool: ToolExecutionPool;
  private readonly activeControllers = new Set<AbortController>();
  private readonly activeExecutions = new Set<Promise<void>>();
  private closed = false;

  constructor(private readonly config: ToolExecutionConfigType) {
    this.pool = new ToolExecutionPool(config.max_workers, config.max_queue_length);
  }

  async run<TResult>(task: ScheduledToolTaskType<TResult>, requestSignal?: AbortSignal): Promise<TResult> {
    if (this.closed) throw new AppError("tool_scheduler_closed", "Tool scheduler is closed");
    await this.pool.acquire(requestSignal);
    if (this.closed) {
      this.pool.release();
      throw new AppError("tool_scheduler_closed", "Tool scheduler is closed");
    }

    const executionController = new AbortController();
    this.activeControllers.add(executionController);
    const deadlineAtMs = Date.now() + Math.max(1, Math.round(this.config.timeout_seconds * 1000));
    const deadlineTimer = setTimeout(() => {
      executionController.abort(new AppError(
        "tool_execution_timeout",
        "Tool execution exceeded its deadline",
        {deadline_at_ms: deadlineAtMs},
      ));
    }, Math.max(1, deadlineAtMs - Date.now()));
    const forwardRequestAbort = (): void => {
      if (requestSignal !== undefined) executionController.abort(requestAbortError(requestSignal));
    };
    requestSignal?.addEventListener("abort", forwardRequestAbort, {once: true});
    // acquire 完成到 listener 注册之间也可能发生取消，因此注册后立即补查一次。
    if (requestSignal?.aborted === true) forwardRequestAbort();

    const context: ToolExecutionContextType = Object.freeze({
      signal: executionController.signal,
      deadlineAtMs,
      remainingTimeMs: () => Math.max(0, deadlineAtMs - Date.now()),
      throwIfAborted: () => {
        requireActiveSignal(executionController.signal);
        if (Date.now() >= deadlineAtMs) {
          throw new AppError("tool_execution_timeout", "Tool execution exceeded its deadline", {deadline_at_ms: deadlineAtMs});
        }
      },
    });

    let executionPromise!: Promise<void>;
    let resolveExecution!: () => void;
    executionPromise = new Promise<void>((resolve) => {
      resolveExecution = resolve;
    });
    this.activeExecutions.add(executionPromise);

    try {
      const result = await task(context);
      context.throwIfAborted();
      return result;
    } finally {
      clearTimeout(deadlineTimer);
      requestSignal?.removeEventListener("abort", forwardRequestAbort);
      this.activeControllers.delete(executionController);
      this.activeExecutions.delete(executionPromise);
      resolveExecution();
      this.pool.release();
    }
  }

  /** 拒绝全部排队任务、取消活动 Flow，并等待它们真实退出后返回。 */
  async close(): Promise<boolean> {
    if (!this.closed) {
      this.closed = true;
      this.pool.close();
      const shutdownError = new AppError("tool_scheduler_closed", "Tool scheduler is shutting down");
      for (const controller of this.activeControllers) controller.abort(shutdownError);
    }
    await Promise.all([...this.activeExecutions]);
    return true;
  }
}
