/** Tool scheduler 与实际执行流程之间共享的单次执行上下文。 */

/**
 * deadline 从取得 worker 时开始计算，排队时间不计入；所有 Python、Browser 与文件分支
 * 只消费这里的同一个 signal，不能在下游重置整次 Tool 的执行预算。
 */
export interface ToolExecutionContextType {
  readonly signal: AbortSignal;
  readonly deadlineAtMs: number;
  remainingTimeMs(): number;
  throwIfAborted(): void;
}

export type ScheduledToolTaskType<TResult> = (context: ToolExecutionContextType) => Promise<TResult>;
