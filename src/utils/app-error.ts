/**
 * TypeScript 侧会中断当前流程的结构化异常。
 *
 * Warning 与浏览器子流程的 failed status 不属于该类；只有需要向上抛出并
 * 终止当前操作的错误才创建 AppError。序列化形状与 Python TransferTypes.AppError
 * 保持一致：`{code, message, details}`，没有附加详情时 details 固定为 null。
 */

import type {AppErrorType, JsonValueType} from "../models/backend/bridge-models.js";

export class AppError extends Error {
  readonly code: string;
  readonly details: JsonValueType;

  constructor(
    code: string,
    message: string,
    details: JsonValueType = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TsAppError";
    this.code = code;
    this.details = details;
  }

  /**
   * 跨过第三方库或异步边界时，保留已结构化的 AppError，其他异常收敛为指定模块错误。
   * Warning 不会调用该方法，因为 warning 不进入 throw 路径。
   */
  static fromUnknown(error: unknown, code: string, message: string): AppError {
    if (error instanceof AppError) return error;
    const reason = error instanceof Error ? error.message : String(error);
    return new AppError(code, message, reason, error instanceof Error ? {cause: error} : undefined);
  }

  /** 为 MCP 错误边界输出与 Python Bridge 相同的可序列化形状。 */
  toJSON(): AppErrorType {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}
