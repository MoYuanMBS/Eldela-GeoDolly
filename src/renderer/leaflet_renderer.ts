/**
 * Current authority source: doc/GeoMCP 技术规范文档.md
 *
 * Rendering will be implemented with standard Leaflet running on top of a
 * simulated DOM (`jsdom`) and node-canvas bindings, rather than the archived
 * `leaflet-headless` package.
 */
export interface LeafletRenderPlan {
  basemapBase64: string;
  geojsonForLeaflet: object | null;
  canvasSize: [number, number];
  stylesCssPath: string;
}

export async function renderLeafletImage(
  _plan: LeafletRenderPlan,
): Promise<string> {
  throw new Error(
    "Leaflet renderer is not implemented yet. Planned runtime: leaflet + jsdom + canvas.",
  );
}
