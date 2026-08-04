import {createRoot} from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "../leaflet/styles/built-in/built-in-css.css";
import "../../styles/web.css";
import {initializeBuiltInStyle} from "../leaflet/styles/built-in-style-loader.js";
import {MapPage} from "./map-page.js";

// 内置 Canvas recipes/rules 在 Leaflet 前冻结；built-in CSS 已由上方静态 import 交给 Vite。
initializeBuiltInStyle();

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("GeoMCP web root element was not found");
}

const mapDataUrl = document.querySelector<HTMLMetaElement>('meta[name="geomcp-map-data-url"]')?.content;

createRoot(rootElement).render(
  <MapPage mapDataUrl={mapDataUrl ?? null} />,
);
