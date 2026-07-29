/**
 * TS 侧结构化日志，与 Python GeomcpJsonFormatter 共用字段和日志级别约定。
 * 日志只写 stderr，避免污染 MCP / Bridge 使用的 stdout。
 */

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
    process.stderr.write(`${JSON.stringify({...basePayload, ...details}, serializeLogValue)}\n`);
  } catch (error) {
    // 日志附加数据不可序列化时仍保留原事件，且日志失败不能中断业务流程。
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({...basePayload, level: "WARNING", logger: "geomcp.warning", event: "log_serialization_failed", source_event: event, reason})}\n`);
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
