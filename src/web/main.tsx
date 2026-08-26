import {createRoot} from "react-dom/client";
import "../../styles/ui-palette.css";
import "../../styles/web.css";
import "../../styles/standard-bar.css";
import "../../styles/drawing.css";
import {MapSurfaceView} from "../browser-map-flow/map-surface-view.js";
import {AppError} from "../utils/app-error.js";
import {MapPage} from "./map-page.js";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new AppError("missing_web_root", "GeoMCP web root element was not found");
}

const mapDataUrl = document.querySelector<HTMLMetaElement>('meta[name="geomcp-map-data-url"]')?.content;

// composition root 只负责把地图 adapter 注入纯 UI port；MapPage 和组件不会导入 Leaflet。
createRoot(rootElement).render(<MapPage mapDataUrl={mapDataUrl ?? null} MapSurfaceComponent={MapSurfaceView} />);
