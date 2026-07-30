import {createRoot} from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "../../styles/web.css";
import {MapPage} from "./map-page.js";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("GeoMCP web root element was not found");
}

const mapDataUrl = document.querySelector<HTMLMetaElement>('meta[name="geomcp-map-data-url"]')?.content;

createRoot(rootElement).render(
  <MapPage mapDataUrl={mapDataUrl ?? null} />,
);
