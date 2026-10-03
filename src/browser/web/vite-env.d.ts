/// <reference types="vite/client" />

declare const __GEOMCP_MAP_PADDING__: {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};

declare const __GEOMCP_MAP_READY_TIMEOUT_MS__: number;
declare const __GEOMCP_SNAPSHOT_MIN_TILE_SUCCESS_RATIO__: number;
declare const __GEOMCP_DECORATIONS_ENABLED__: boolean;
declare const __GEOMCP_MAX_SCALE_WIDTH_PX__: number;
declare const __GEOMCP_FEATURE_UI_MAX_HEIGHT_PX__: number;
declare const __GEOMCP_MEASUREMENT_PREVIEW_REFRESH_INTERVAL_MS__: number;
declare const __GEOMCP_MCP_APP__: boolean;
declare const __GEOMCP_APP_BASE_URL__: string;
declare const __GEOMCP_APP_LEAFLET__: import("../../models/mapsurface/map-config-models.js").LeafletConfigType;
declare const __GEOMCP_APP_STYLE__: import("../../models/mapsurface/style/user-css-style-models.js").RenderStylePayload;
declare const __GEOMCP_IFRAME_MAX_WIDTH_PX__: number;
declare const __GEOMCP_IFRAME_MAX_HEIGHT_PX__: number;
