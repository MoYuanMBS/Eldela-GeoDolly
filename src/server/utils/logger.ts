/**
 * TS 侧结构化日志，与 Python GeomcpJsonFormatter 共用字段和日志级别约定。
 * MCP 使用 HTTP 后，Node 日志写 stdout；Python Bridge stdout 仍只用于 JSON 响应。
 */

import {browserWarningReportSchema} from "../../models/common/browser-warning-models.js";

function formatTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function serializeLogValue(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return {name: value.name, message: value.message, stack: value.stack};
  return value;
}

function writeLog(level: "INFO" | "WARNING", loggerName: "geomcp.event" | "geomcp.warning", event: string, details: Readonly<Record<string, unknown>>): void {
  const basePayload = {ts: formatTimestamp(new Date()), level, logger: loggerName, event};
  try {
    process.stdout.write(`${JSON.stringify({...basePayload, ...details}, serializeLogValue)}\n`);
  } catch (error) {
    // 日志附加数据不可序列化时仍保留原事件，且日志失败不能中断业务流程。
    const reason = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${JSON.stringify({...basePayload, level: "WARNING", logger: "geomcp.warning", event: "log_serialization_failed", source_event: event, reason})}\n`);
  }
}

export const logger = {
  info(event: string, details: Readonly<Record<string, unknown>> = {}): void {
    // 与 Python logging 一致：默认 WARNING 不输出 INFO，显式降低阈值后才记录。
    const configuredLevel = process.env.GEOMCP_LOG_LEVEL?.trim().toUpperCase() ?? "WARNING";
    if (configuredLevel !== "INFO" && configuredLevel !== "DEBUG" && configuredLevel !== "NOTSET") return;
    writeLog("INFO", "geomcp.event", event, details);
  },
  warning(event: string, details: Readonly<Record<string, unknown>> = {}): void {
    writeLog("WARNING", "geomcp.warning", event, details);
  },
};

/**
 * 校验 Browser warning 白名单并写入 Node 现有结构化 warning logger。
 *
 * 无效 HTTP payload 返回 false 交给 route 响应 400，不 throw、不记录第二条 warning，也不会影响
 * 已经运行的 Browser Map Flow。Browser console 的人类可读格式不属于这个 Node 日志协议。
 */
export function recordBrowserWarning(payload: unknown): boolean {
  const parsedWarning = browserWarningReportSchema.safeParse(payload);
  if (!parsedWarning.success) return false;
  const warning = parsedWarning.data;
  logger.warning(warning.event, {
    source: "browser",
    ...warning.details,
  });
  return true;
}
