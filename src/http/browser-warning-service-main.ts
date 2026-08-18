/** 独立 Browser warning HTTP service 进程入口。 */

import type {Server} from "node:http";
import {BROWSER_WARNING_ROUTE} from "../models/common/browser-warning-models.js";
import {config} from "../utils/config-loader.js";
import {logger} from "../utils/logger.js";
import {createBrowserWarningHttpService} from "./browser-warning-http-service.js";

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleError = (error: Error): void => reject(error);
    server.once("error", handleError);
    server.listen(port, host, () => {
      server.off("error", handleError);
      resolve();
    });
  });
}

async function main(): Promise<void> {
  // 独立进程只加载自己消费的 web.yaml，不强制初始化 MCP Tool、样式或 Basemap 配置。
  const httpConfig = config.getWebConfig().http;
  const server = createBrowserWarningHttpService(httpConfig);
  await listen(server, httpConfig.warning.port, httpConfig.listen_host);
  // 启动完成后的 listener 错误只能影响诊断通道，不能反向终止独立运行的地图/MCP 流程。
  server.on("error", (error) => logger.warning("browser_warning_http_service_error", {reason: error.message}));
  logger.info("browser_warning_http_service_started", {
    listen_host: httpConfig.listen_host,
    port: httpConfig.warning.port,
    route: BROWSER_WARNING_ROUTE,
  });

  let closing = false;
  const closeService = (): void => {
    if (closing) return;
    closing = true;
    // 停止接收新连接后让正在处理的小型 warning 请求自然结束。
    server.close((error) => {
      if (error !== undefined) logger.warning("browser_warning_http_service_close_failed", {reason: error.message});
    });
    server.closeIdleConnections();
  };
  process.once("SIGINT", closeService);
  process.once("SIGTERM", closeService);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
