/** Browser warning 的本地发布与 Node 异步回传适配器。 */

import type {BrowserWarningReporterType} from "../models/common/browser-warning-models.js";

/**
 * 将服务端提供的 warning route 解析为同源 URL。
 *
 * warning route 可能包含 session/one-time token，因此拒绝跨 origin，并且任何诊断日志都不得输出 URL。
 */
function resolveWarningReportUrl(reportUrl: string | null): string | null {
  if (reportUrl === null) return null;
  try {
    const resolvedUrl = new URL(reportUrl, globalThis.location.href);
    if (resolvedUrl.origin !== globalThis.location.origin) {
      console.warn("browser_warning_report_url_rejected", {reason: "cross_origin"});
      return null;
    }
    return resolvedUrl.href;
  } catch {
    console.warn("browser_warning_report_url_rejected", {reason: "invalid_url"});
    return null;
  }
}

/**
 * 创建单个 Map 页面生命周期使用的 warning reporter。
 *
 * warning 首先在 Browser console 发布，再通过同源 POST 尽力回传 Node。回传没有重试，也不参与
 * Basemap ready、Flow timeout 或 React 生命周期；同一 reporter 收到的相同 warning 只发布一次。
 *
 * @param reportUrl Node map service 写入页面的 session-scoped warning route；null 表示仅记录 Browser warning。
 * @returns 不会向调用方 throw 的 warning 发布函数。
 */
export function createBrowserWarningReporter(reportUrl: string | null): BrowserWarningReporterType {
  const resolvedReportUrl = resolveWarningReportUrl(reportUrl);
  const publishedWarningKeys = new Set<string>();

  return (warning): void => {
    const warningKey = `${warning.event}:${warning.details.profile_id}:${warning.details.reason_code}`;
    if (publishedWarningKeys.has(warningKey)) return;
    publishedWarningKeys.add(warningKey);

    console.warn(warning.event, warning.details);
    if (resolvedReportUrl === null) return;

    // keepalive 允许页面在 warning 后很快卸载时继续发送小型日志；失败只能留在 Browser console。
    void fetch(resolvedReportUrl, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(warning),
      cache: "no-store",
      credentials: "same-origin",
      keepalive: true,
    }).then((response) => {
      if (!response.ok) {
        console.warn("browser_warning_report_failed", {event: warning.event, status: response.status});
      }
    }).catch(() => {
      console.warn("browser_warning_report_failed", {event: warning.event, reason: "network_error"});
    });
  };
}
