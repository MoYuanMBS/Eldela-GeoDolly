import {createRoot} from "react-dom/client";
import "../../styles/ui-palette.css";
import "../../styles/ui-typography.css";
import "../../styles/web.css";
import "../../styles/ui-bars.css";
import "../../styles/ui-panels.css";
import "../../styles/ui-assets.css";
import "../../styles/ui-scrollbar.css";
import {AppError} from "../utils/app-error.js";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new AppError("missing_web_root", "GeoMCP web root element was not found");
}

const mapDataUrl = document.querySelector<HTMLMetaElement>('meta[name="geomcp-map-data-url"]')?.content;
const sessionStatusUrl = document.querySelector<HTMLMetaElement>('meta[name="geomcp-session-status-url"]')?.content;
const sessionSnapshotUrl = document.querySelector<HTMLMetaElement>('meta[name="geomcp-session-snapshot-url"]')?.content;
const sessionInitialStatus = document.querySelector<HTMLMetaElement>('meta[name="geomcp-session-initial-status"]')?.content;
const browserFlow = document.documentElement.dataset.geomcpBrowserFlow;
if (browserFlow !== "interactive" && browserFlow !== "snapshot") {
  throw new AppError("invalid_browser_flow", "GeoMCP Browser flow is missing or invalid");
}

const root = createRoot(rootElement);
const hasAnySessionMetadata = sessionStatusUrl !== undefined || sessionSnapshotUrl !== undefined || sessionInitialStatus !== undefined;
if (hasAnySessionMetadata) {
  if (sessionStatusUrl === undefined || sessionSnapshotUrl === undefined || (sessionInitialStatus !== "active" && sessionInitialStatus !== "archived")) {
    throw new AppError("invalid_session_page", "Public Session page metadata is missing or invalid");
  }
  const {SessionPage} = await import("./session-page.js");
  if (sessionInitialStatus === "archived") {
    // 已归档页面只加载轻量 Snapshot 展示，不下载或初始化任何 Leaflet adapter。
    root.render(
      <SessionPage initialStatus={sessionInitialStatus} statusUrl={sessionStatusUrl} snapshotUrl={sessionSnapshotUrl}
        renderActive={() => null} />,
    );
  } else if (browserFlow === "interactive") {
    const [{MapPage}, {MapSurfaceView}] = await Promise.all([
      import("./map-page.js"),
      import("../browser-map-flow/map-surface-view.js"),
    ]);
    root.render(
      <SessionPage initialStatus={sessionInitialStatus} statusUrl={sessionStatusUrl} snapshotUrl={sessionSnapshotUrl}
        renderActive={(onArchived) => <MapPage mapDataUrl={mapDataUrl ?? null} onArchived={onArchived} MapSurfaceComponent={MapSurfaceView} />} />,
    );
  } else {
    const [{SnapshotMapPage}, {SnapshotMapSurfaceView}] = await Promise.all([
      import("./snapshot-map-page.js"),
      import("../browser-map-flow/snapshot-map-surface-view.js"),
    ]);
    root.render(
      <SessionPage initialStatus={sessionInitialStatus} statusUrl={sessionStatusUrl} snapshotUrl={sessionSnapshotUrl}
        renderActive={(onArchived) => <SnapshotMapPage mapDataUrl={mapDataUrl ?? null} onArchived={onArchived} SnapshotMapSurfaceComponent={SnapshotMapSurfaceView} />} />,
    );
  }
} else if (browserFlow === "interactive") {
  // 非 Session 页面保持既有入口；内部 Snapshot token 不经过公开状态检查。
  const [{MapPage}, {MapSurfaceView}] = await Promise.all([
    import("./map-page.js"),
    import("../browser-map-flow/map-surface-view.js"),
  ]);
  root.render(<MapPage mapDataUrl={mapDataUrl ?? null} MapSurfaceComponent={MapSurfaceView} />);
} else {
  const [{SnapshotMapPage}, {SnapshotMapSurfaceView}] = await Promise.all([
    import("./snapshot-map-page.js"),
    import("../browser-map-flow/snapshot-map-surface-view.js"),
  ]);
  root.render(<SnapshotMapPage mapDataUrl={mapDataUrl ?? null} SnapshotMapSurfaceComponent={SnapshotMapSurfaceView} />);
}
