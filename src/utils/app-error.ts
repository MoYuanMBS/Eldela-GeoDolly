/**
 * TypeScript 侧会中断当前流程的结构化异常。
 *
 * Warning 与浏览器子流程的 failed status 不属于该类；只有需要向上抛出并
 * 终止当前操作的错误才创建 AppError。序列化形状与 Python TransferTypes.AppError
 * 保持一致：`{code, message, details}`，没有附加详情时 details 固定为 null。
 */

import type {AppErrorType, JsonValueType} from "../models/bridge-models.js";

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

  /** 为 MCP 错误边界输出与 Python Bridge 相同的可序列化形状。 */
  toJSON(): AppErrorType {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}
