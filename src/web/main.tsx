import {createRoot} from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "../leaflet/styles/leaflet-font.css";
import "../leaflet/styles/built-in/built-in-css.css";
import "../../styles/ui-palette.css";
import "../../styles/web.css";
import "../../styles/standard-bar.css";
import "../../styles/drawing.css";
import {initializeBuiltInStyle} from "../leaflet/styles/built-in-style-loader.js";
import {AppError} from "../utils/app-error.js";
import {MapPage} from "./map-page.js";

// 内置 Canvas recipes/rules 在 Leaflet 前冻结；built-in CSS 已由上方静态 import 交给 Vite。
initializeBuiltInStyle();

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new AppError("missing_web_root", "GeoMCP web root element was not found");
}

const mapDataUrl = document.querySelector<HTMLMetaElement>('meta[name="geomcp-map-data-url"]')?.content;

createRoot(rootElement).render(
  <MapPage mapDataUrl={mapDataUrl ?? null} />,
);
