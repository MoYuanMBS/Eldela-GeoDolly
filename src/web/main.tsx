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
const browserFlow = document.documentElement.dataset.geomcpBrowserFlow;
if (browserFlow !== "interactive" && browserFlow !== "snapshot") {
  throw new AppError("invalid_browser_flow", "GeoMCP Browser flow is missing or invalid");
}

// 只加载所属 flow 的页面与 Leaflet adapter，Snapshot bundle 不静态引入 Interaction 或 Measure Tool。
const root = createRoot(rootElement);
if (browserFlow === "interactive") {
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
