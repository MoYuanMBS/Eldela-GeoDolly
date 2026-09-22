/** 公开 Session 页面的状态预检、低频复查与 archived Snapshot 切换。 */

import {useCallback, useEffect, useRef, useState, type ReactNode} from "react";

import {sessionHttpStatusSchema} from "../../models/common/session-http-models.js";

type SessionPageState =
  | {status: "checking"}
  | {status: "active"}
  | {status: "archived"}
  | {status: "missing"}
  | {status: "error"; message: string};

interface SessionPageProps {
  initialStatus: "active" | "archived";
  statusUrl: string;
  snapshotUrl: string;
  renderActive: (onArchived: () => void) => ReactNode;
}

export function SessionPage({initialStatus, statusUrl, snapshotUrl, renderActive}: SessionPageProps) {
  const [state, setState] = useState<SessionPageState>(initialStatus === "archived" ? {status: "archived"} : {status: "checking"});
  const terminalRef = useRef(initialStatus === "archived");
  const timerRef = useRef<number | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);

  const clearScheduledCheck = useCallback((): void => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const showArchivedSnapshot = useCallback((): void => {
    terminalRef.current = true;
    clearScheduledCheck();
    requestControllerRef.current?.abort();
    setState({status: "archived"});
  }, [clearScheduledCheck]);

  useEffect(() => {
    if (initialStatus === "archived") return;
    terminalRef.current = false;
    let disposed = false;
    let checking = false;
    let checkAgain = false;
    let hasLoadedActiveStatus = false;
    let lastRecheckDelayMs: number | null = null;

    const scheduleCheck = (delayMs: number): void => {
      clearScheduledCheck();
      timerRef.current = window.setTimeout(() => void checkStatus(), delayMs);
    };

    const showMissing = (): void => {
      terminalRef.current = true;
      clearScheduledCheck();
      setState({status: "missing"});
    };

    const checkStatus = async (): Promise<void> => {
      if (disposed || terminalRef.current) return;
      if (checking) {
        checkAgain = true;
        return;
      }
      checking = true;
      let nextDelayMs: number | null = null;
      const requestController = new AbortController();
      requestControllerRef.current = requestController;
      try {
        const response = await fetch(statusUrl, {cache: "no-store", signal: requestController.signal});
        if (response.status === 404) {
          showMissing();
          return;
        }
        if (!response.ok) throw new Error(`Session status request failed with HTTP ${response.status}`);
        const sessionStatus = sessionHttpStatusSchema.parse(await response.json());
        if (sessionStatus.status === "archived") {
          showArchivedSnapshot();
          return;
        }
        hasLoadedActiveStatus = true;
        lastRecheckDelayMs = sessionStatus.recheck_after_ms;
        nextDelayMs = sessionStatus.recheck_after_ms;
        setState({status: "active"});
      } catch (error) {
        if (requestController.signal.aborted || disposed || terminalRef.current) return;
        if (!hasLoadedActiveStatus) {
          setState({status: "error", message: error instanceof Error ? error.message : String(error)});
          return;
        }
        // 暂时的状态请求失败不能主动销毁仍有效的地图；沿用上一次服务端给出的周期重试。
        nextDelayMs = lastRecheckDelayMs;
      } finally {
        if (requestControllerRef.current === requestController) requestControllerRef.current = null;
        checking = false;
        if (disposed || terminalRef.current) return;
        if (checkAgain) {
          checkAgain = false;
          void checkStatus();
        } else if (nextDelayMs !== null) {
          scheduleCheck(nextDelayMs);
        }
      }
    };

    const handleFocus = (): void => void checkStatus();
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "visible") void checkStatus();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void checkStatus();

    return () => {
      disposed = true;
      clearScheduledCheck();
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [clearScheduledCheck, initialStatus, showArchivedSnapshot, statusUrl]);

  if (state.status === "checking") return <main className="geomcp-map-page-state" role="status">Checking map session…</main>;
  if (state.status === "missing") return <main className="geomcp-map-page-state geomcp-map-page-error" role="alert">Map session is unavailable.</main>;
  if (state.status === "error") return <main className="geomcp-map-page-state geomcp-map-page-error" role="alert">{state.message}</main>;
  if (state.status === "archived") {
    return (
      <main aria-label="Archived map snapshot">
        <img src={snapshotUrl} alt="Archived map snapshot" style={{display: "block", maxWidth: "100%", height: "auto"}} />
      </main>
    );
  }
  return <>{renderActive(showArchivedSnapshot)}</>;
}
