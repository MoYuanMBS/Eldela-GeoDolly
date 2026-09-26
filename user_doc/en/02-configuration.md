# 02 · Configuration

**English** · [简体中文](../zh/02-configuration.md)

GeoDolly reads its settings from the repository's `config/` directory. Make a change in the file responsible for that behavior, keep the surrounding YAML structure, restart the service, and generate a new map to check the result. Configuration is not reloaded while the service is running.

## Configuration sequence

1. Find the file in the table below and edit its existing keys. Keep the other required sections in place.
2. Restart GeoDolly. If you changed `app.yaml`'s `ui.decorations_enabled`, run `npm run build:web` before restarting because that switch is read during the browser build.
3. Make a new map with the affected setting and check startup or tool warnings. A malformed file can prevent startup; an invalid individual rule may instead be skipped.

| What you want to change | File or guide |
| --- | --- |
| Search, Overpass, map behavior, or output switches | [`config/app.yaml`](../../config/app.yaml), below |
| Map address, tool execution, or session lifetime | [`config/web.yaml`](../../config/web.yaml), below |
| Basemap providers or output tag cleanup | [03 · Basemaps and Filters](03-tiles-and-filters.md) |
| Default queries or optional subject rules | [04 · Base and Experts](04-base-and-experts.md) |
| Overlay CSS, tag style rules, or Node icons | [05 · User Map Styles](05-user-styles.md) |

## app.yaml

[`config/app.yaml`](../../config/app.yaml) groups settings by purpose. Edit the existing section rather than replacing the whole file.

| Section | Common change |
| --- | --- |
| `nominatim` | Search limit, request timeout, and User-Agent for place search. |
| `overpass` | Endpoint pool, request timeout, retries, and User-Agent for feature queries. |
| `basemap` | Tile request User-Agent and timeout, plus the minimum successful-tile ratio for a snapshot. Provider URLs and attribution are configured in [`tiles.yaml`](03-tiles-and-filters.md#basemap-profiles). |
| `output` | `allow_overlay_geojson` enables the option to return a separate Overlay JSON result. A request must also set `include_overlay_geojson: true`, and Overlay data must exist. |
| `ui` | `decorations_enabled` controls optional browser decorations at build time. Rebuild the browser app after changing it. |
| `geometry`, `iframe_adaptive`, `leaflet` | Geographic limits and map display parameters; retain their existing field structure when tuning them. |

For a deployed service, replace the test User-Agent values in `nominatim.user_agent`, `overpass.user_agent`, and `basemap.user_agent` with identifiers appropriate to that service.

## web.yaml

[`config/web.yaml`](../../config/web.yaml) contains the map address and runtime limits:

| Section | What it controls |
| --- | --- |
| `http.listen_host`, `http.map.port` | Where the map service listens. The local map port is `23336`. |
| `http.map.public_origin` | Base address in returned map links. Set this to an address the user's browser can reach. Changing the listening port alone does not update returned links. |
| `tool_execution` | Worker count, waiting queue length, and timeout for each tool call. |
| `session` | Interactive lifetime and expiry/checkpoint intervals. The local default lifetime is 24 hours, checked every 30 minutes. |
| `snapshot` | Maximum snapshot wrapper pixel budget. |

For a public deployment, make `http.map.public_origin` match the externally reachable map address and route traffic to the configured listener. The current `127.0.0.1` address is only suitable when the browser can reach the server machine locally.

[← User Guide](00-index.md) · [Getting Started](01-getting-started.md) · [Basemaps and Filters](03-tiles-and-filters.md)
