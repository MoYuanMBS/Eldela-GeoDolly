import {createRoot} from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "../../styles/web.css";
import {initializeBuiltInCanvasStyle} from "../leaflet/styles/built-in-style.js";
import {MapPage} from "./map-page.js";

// 内置 Canvas rules/recipes 在 Leaflet 创建前组装一次，后续 resolver 只读取冻结缓存。
initializeBuiltInCanvasStyle();

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("GeoMCP web root element was not found");
}

const mapDataUrl = document.querySelector<HTMLMetaElement>('meta[name="geomcp-map-data-url"]')?.content;

createRoot(rootElement).render(
  <MapPage mapDataUrl={mapDataUrl ?? null} />,
);
