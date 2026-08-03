import {createRoot} from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "../../styles/web.css";
import {initializeBuiltInStyle} from "../leaflet/styles/built-in-style-loader.js";
import {MapPage} from "./map-page.js";

// 三个内置地图样式主入口在 Leaflet 创建前加载一次，后续 runtime plan 只读取冻结缓存。
initializeBuiltInStyle();

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("GeoMCP web root element was not found");
}

const mapDataUrl = document.querySelector<HTMLMetaElement>('meta[name="geomcp-map-data-url"]')?.content;

createRoot(rootElement).render(
  <MapPage mapDataUrl={mapDataUrl ?? null} />,
);
