import {createRoot} from "react-dom/client";
import "../../../styles/ui-palette.css";
import "../../../styles/ui-typography.css";
import "../../../styles/web.css";
import "../../../styles/ui-bars.css";
import "../../../styles/ui-panels.css";
import "../../../styles/ui-assets.css";
import "../../../styles/ui-scrollbar.css";
import {AppError} from "../../shared/app-error.js";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new AppError("missing_web_root", "GeoMCP web root element was not found");
}

const mapDataUrl = document.querySelector<HTMLMetaElement>('meta[name="geomcp-map-data-url"]')?.content;
const browserFlow = document.documentElement.dataset.geomcpBrowserFlow;
if (browserFlow !== "interactive") {
  throw new AppError("invalid_browser_flow", "GeoMCP Browser flow is missing or invalid");
}

const root = createRoot(rootElement);
const [{MapPage}, {MapSurfaceView}] = await Promise.all([
  import("./map-page.js"),
  import("../browser-map-flow/map-surface-view.js"),
]);
root.render(<MapPage mapDataUrl={mapDataUrl ?? null} MapSurfaceComponent={MapSurfaceView} />);
