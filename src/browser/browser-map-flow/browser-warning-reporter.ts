/** 地图 flow 使用的 Browser warning 控制台发布与 Node 异步回传适配器。 */

import {
  BROWSER_WARNING_ROUTE,
  type BrowserWarningReporterType,
  type BrowserWarningReportType,
} from "../../models/common/browser-warning-models.js";

/**
 * Browser console 面向人工调试，不复用 Node 结构化日志格式。
 *
 * 这里故意只显示 profile、阶段与稳定原因码；完整 URL、provider token 和底层异常对象既不打印，
 * 也不进入回传 payload。
 */
function printBrowserWarning(warning: BrowserWarningReportType): void {
  console.warn("[GeoMCP] Basemap tile is unavailable; displaying an empty tile.", warning.details);
}

/**
 * 创建单个 Interactive Map 页面生命周期使用的 warning reporter。
 *
 * 相同事件在一个页面内只发布一次，避免一个视口的多块失败瓦片同时刷满 Browser 与 Node 日志。
 * 回传固定使用同源 `/browser-warnings`，没有重试，也不参与 ready timeout；部署转发尚未接通时，
 * 地图仍然只依赖本地 console warning 继续运行。
 */
export function createBrowserWarningReporter(): BrowserWarningReporterType {
  const publishedWarningKeys = new Set<string>();

  return (warning): void => {
    const warningKey = `${warning.event}:${warning.details.profile_id}:${warning.details.phase}:${warning.details.reason_code}`;
    if (publishedWarningKeys.has(warningKey)) return;
    publishedWarningKeys.add(warningKey);

    printBrowserWarning(warning);
    try {
      // keepalive 允许页面在 warning 后很快卸载时继续发送这条小型诊断消息。
      void fetch(BROWSER_WARNING_ROUTE, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify(warning),
        cache: "no-store",
        credentials: "same-origin",
        keepalive: true,
      }).then((response) => {
        if (!response.ok) {
          console.warn("[GeoMCP] Browser warning could not be recorded by the Node service.", {status: response.status});
        }
      }).catch(() => {
        console.warn("[GeoMCP] Browser warning could not reach the Node service.");
      });
    } catch {
      // warning reporter 自身的同步失败同样只能留在 Browser 诊断路径。
      console.warn("[GeoMCP] Browser warning could not be sent to the Node service.");
    }
  };
}
