# 03 · app.yaml

**English** · [简体中文](../zh/03-app-yaml.md)

[`config/app.yaml`](../../config/app.yaml) controls place search, feature queries, generated IDs, map sizing, and display. The file is shared by multiple components. Edit the keys in their existing sections and restart GeoDolly; `ui.decorations_enabled` also requires `npm run build:web`.

## On this page

[Tool descriptions](#prompts) · [Place search](#nominatim) · [Overpass](#overpass) · [Geometry](#geometry) · [Feature IDs](#feature_id) · [Map sizing](#iframe_adaptive) · [Browser startup](#browser_map) · [MCP app](#mcp_apps) · [Basemap requests](#basemap) · [Output](#output) · [UI](#ui) · [Leaflet](#leaflet)

### prompts

The `location_search`, `tool_a`, and `tool_b` entries each contain `title` and `description`. `title` is the name shown to the MCP client; `description` explains when and how an AI should call the tool. Edit these texts if your deployment needs clearer guidance. Keep tool names and YAML structure intact. Descriptions guide clients; they are not enforcement of the [usage policy](../../POLICY.md).

### nominatim

| Field | Meaning and adjustment |
| --- | --- |
| `location_limit` | Maximum place candidates returned per search; integer from 1 to 50. Higher values offer more choices but make selection harder. |
| `user_agent` | Nonempty identifier sent to the place-search provider. Use a suitable identity for your deployment. |
| `timeout_seconds` | Positive timeout for a single place-search HTTP request, in seconds. A timeout fails that search request. |

### overpass

#### Endpoints and request limits

The `overpass` section in [`config/app.yaml`](../../config/app.yaml) controls which Overpass API instances receive feature queries. The fragment below uses the current single-instance setup; keep the other `overpass` keys already in the file:

```yaml
overpass:
  endpoint: "https://overpass-api.de/api/interpreter"
  endpoints: []
  endpoint_strategy: "round_robin"
```

- `endpoint` is required. When `endpoints: []`, it is the **only** address used. The strategy has no visible effect with one address.
- `endpoints` is an optional ordered list of instance URLs. When it contains entries, requests use **only those entries**; `endpoint` is not automatically added as a fallback. To include it in the pool, list it there too. For example, replace the example addresses below with actual instances you may use:

  ```yaml
  endpoints:
    - "https://your-overpass-1.example/api/interpreter"
    - "https://your-overpass-2.example/api/interpreter"
  ```

- `endpoint_strategy: "failover"` starts every query at the first pool entry and advances to the next entry on a retry. `"round_robin"` rotates the starting entry between queries, then advances on retries. If retries are disabled, `failover` keeps using the first entry.
- `retry_attempts` counts **additional** tries: `3` permits up to four attempts for a query. Connection failures, timeouts, HTTP 429/5xx, and invalid JSON can trigger a retry; ordinary HTTP 4xx errors and an Overpass query error reported in a successful response do not. `retry_delay_seconds` is the initial wait; later retry waits double, and a longer provider `Retry-After` takes precedence. `timeout_seconds` limits each Overpass request, not the whole map-tool call.
- `user_agent` identifies this deployment to Overpass. Configure an appropriate, identifiable value for your service. The same applies to `nominatim.user_agent` and `basemap.user_agent` for their respective providers.

The remaining Overpass fields control the size and pace of more complex queries:

| Field | Effect |
| --- | --- |
| `relation_parent_depth` | How many levels of parent relations to look up for matched features; `0` disables that lookup. |
| `relation_member_depth` | How far to expand nested relation members for the map Overlay; a nonnegative integer limits depth, while `"all"` continues through nested relations. |
| `overlay_skel_id_batch_size` | Maximum IDs in one follow-up element request; also limits a single missing-area-way follow-up request. |
| `overlay_skel_concurrency` | Maximum concurrent follow-up batches. |
| `overlay_skel_batch_delay_seconds` | Minimum spacing between the starts of follow-up batches. |

Changing these values can change upstream load and query time. Start with the supplied values and adjust only for a specific service or data-coverage need.

### geometry

These settings control search extent and geometry size. Distances use the units in their names; area limits use square kilometres (`km²`). Changing them can affect data volume, analysis time, and detail.

| Field | Meaning and adjustment |
| --- | --- |
| `line_buffer_meter` | Buffer around LineString/MultiLineString features, in metres; nonnegative. Increase to include a wider corridor. |
| `tool_a_bbox_expand_km` | Expansion of Tool A's query bounding box, in kilometres; nonnegative. |
| `tool_b_bbox_expand_km` | Expansion of Tool B's tile bounding box, in kilometres; nonnegative. |
| `base_tolerance_meter` | Lower bound for geometry simplification tolerance, in metres; nonnegative. |
| `max_tolerance_meter` | Upper bound for simplification tolerance, in metres; positive; keep it at least as large as `base_tolerance_meter`. Larger values can remove more detail. |
| `max_node` | Positive cap on exterior ring nodes after simplification. Lower values reduce geometry detail. |
| `max_retry` | Nonnegative maximum number of simplification corrections after the first attempt. |
| `tool_a_max_area_km2` | Positive maximum area for Tool A's analysis mode. |
| `tool_b_max_area_km2` | Positive maximum area for Tool B's core-area analysis; oversized requests may use a broader query or basemap-only preview. |
| `max_core_area_km2` | Positive independent limit for the Overpass core polygon; it does not set the tile bounding-box area limit. |

### feature_id

#### Formats and display characters

`feature_id` has two jobs: `id_scheme` sets the generated **canonical `feature_id`**, while `render` optionally changes the **`display_id` shown on the map and in analysis output**. A generated Feature ID is not an OpenStreetMap element ID. `node`, `way`, `area`, and `relation` each have their own ID namespace, so the same text can occur in different types.

The current configuration is a complete example of the section:

```yaml
feature_id:
  alphabet_pool: "DFHJPWXYKC"
  id_scheme:
    node: {template: "{num}", mode: global}
    way: {template: "{alpha}{num}", mode: grouped, group: 20}
    area: {template: "{num}{alpha}", mode: global}
    relation: {template: "{alpha}-{num}", mode: round}
  render:
    active_skins: default_skin
    skins:
      alphabet:
        ganzhi: "甲乙丙丁庚辛壬癸子丑"
      digits:
        chinese: "〇一二三四五六七八九"
```

- `alphabet_pool` is an ordered set of distinct ASCII letters `A`–`Z`. Its order determines generated alphabetic parts and the position-by-position mapping used by an alphabet display skin.
- `id_scheme` defines a `template` and `mode` for each type. `{num}` is a number; `{alpha}` is drawn from the pool. With the defaults, the *formats* are `1` for node, `D1` for way, `1D` for area, and `D-1` for relation. Actual first IDs can differ when a value conflicts with a feature's `ref`. `global` increments the number across the type; `grouped` numbers features in groups of `group` before advancing the letter; `round` advances through letters before incrementing the number. Keep `group` positive when using `grouped`.
- `template` accepts `{num}`, `{alpha}`, or both in either order, optionally separated by one `-`, `_`, `~`, or `=`. It does not accept arbitrary prefixes or suffixes.
- `render.active_skins: default_skin` displays generated IDs with their canonical characters. To use the registered example skins, replace that value under `render` with:

  ```yaml
  active_skins:
    alphabet: ganzhi
    digits: chinese
  ```

  You can select only one of these groups; an omitted group stays on `default_skin`. An alphabet skin needs one distinct character for each character in `alphabet_pool`, in matching order; a digit skin needs ten distinct characters for `0`–`9`. A selected skin must exist under the corresponding `render.skins` group.
- If a Feature has a usable `ref`, its display ID uses that `ref` instead of the generated ID; skins do not change refs. Duplicate refs may be disambiguated. Changing a skin changes presentation only, while changing `alphabet_pool` or `id_scheme` changes canonical IDs generated for **new maps**. Keep the supplied schemes unless you intentionally want new ID formats.

### iframe_adaptive

These values determine the recommended map canvas size. Adjust them only when the maps are consistently too small, too large, or clipped; bigger screenshots cost more time and memory. The browser may raise inconsistent maximum size or pixel limits to fit required minimums and emit a warning.

| Field | Meaning and adjustment |
| --- | --- |
| `node_weight`, `way_weight`, `area_weight`, `relation_weight` | Numeric contributions of each final feature type to the content-based size estimate. Higher weights make dense maps count more strongly. |
| `secondary_factor_weight` | Numeric contribution of the secondary factor beyond the base multiplier. |
| `max_area_factor` | Cap on the recommended area multiplier. |
| `min_screenshot_width`, `max_screenshot_width` | Minimum and maximum MapSurface width, in logical pixels; positive integers. The maximum may be raised if required for the minimum or aspect ratio. |
| `min_screenshot_height`, `max_screenshot_height` | Corresponding MapSurface height bounds, in logical pixels; positive integers. |
| `max_screenshot_pixels` | Maximum MapSurface logical pixel area (`width × height`); positive integer. This is separate from the physical wrapper budget in `web.yaml`. |
| `reference_screenshot_area` | Positive reference area in logical pixels when the recommended area factor is 1. |
| `min_aspect_ratio`, `max_aspect_ratio` | Positive width/height ratio bounds; minimum must not exceed maximum. |
| `padding.top`, `padding.right`, `padding.bottom`, `padding.left` | Positive logical-pixel space around the initial map bounds. Left and right must match; top and bottom must match. Padding must leave usable canvas space. |
| `min_map_display_width`, `min_map_display_height` | Positive minimum readable MapSurface dimensions in logical pixels; they can raise the effective screenshot minimums. |

The Snapshot reference bar is measured separately from MapSurface height; the final wrapper also has a limit in [web.yaml](04-web-yaml.md#snapshot).

### browser_map

| Field | Meaning and adjustment |
| --- | --- |
| `ready_timeout_seconds` | Positive upper bound, in seconds, for the initial browser map and visual parts to become ready. Increase only when startup consistently needs more time; the overall tool timeout in `web.yaml` still applies. |

### mcp_apps

| Field | Meaning and adjustment |
| --- | --- |
| `interactive_map_launcher.preferred_height_px` | Positive preferred CSS height for the full interactive map when the MCP host does not specify one; the host can still cap the height. |
| `interactive_map_launcher.load_notice_delay_ms` | Nonnegative delay in milliseconds before the launcher updates its manual-open or copy-link hint when the iframe has not become available. |

### basemap

These are service requests for the selected basemap. Provider URLs, names and attribution are configured in [`tiles.yaml`](05-tiles-and-filters.md#basemap-profiles).

| Field | Meaning and adjustment |
| --- | --- |
| `user_agent` | Nonempty identifier sent by GeoDolly when requesting upstream tiles. |
| `upstream_timeout_seconds` | Positive timeout, in seconds, for each upstream tile request. |
| `snapshot_min_tile_success_ratio` | Required fraction of initial Snapshot tiles that load successfully, from `0` to `1`. `1` requires every needed tile; `0` permits an empty basemap. Missing tiles that still meet the threshold produce a warning. |

### output

| Field | Meaning and adjustment |
| --- | --- |
| `allow_overlay_geojson` | Boolean deployment switch for separate Overlay JSON output. A tool request must also set `include_overlay_geojson: true`, and Overlay data must exist. |

### ui

| Field | Meaning and adjustment |
| --- | --- |
| `decorations_enabled` | Boolean switch for optional Interactive decorations. Run `npm run build:web` after changing it; the switch is read at build time. |
| `max_scale_width_px` | Positive maximum logical-pixel width of the metric scale. |
| `feature_ui_max_height_px` | Positive maximum logical-pixel height of expanded Feature UI before its content scrolls internally. |
| `measurement_preview_refresh_interval_ms` | Positive minimum interval, in milliseconds, between mouse-move measurement preview updates. Larger values reduce update frequency. |

### leaflet

These settings control the visible map and interaction sizes. Pixel units here are screen logical pixels; changing hit areas affects how easily nearby features can be selected.

| Field | Meaning and adjustment |
| --- | --- |
| `viewport.max_zoom` | Positive maximum visual zoom level; independent of a basemap provider's `max_native_zoom`. |
| `render_batch_size` | Positive number of features rendered before the browser yields to other work. Smaller batches can keep the interface responsive but add scheduling overhead. |
| `node_zoom.hidden_max_zoom` | Positive zoom level at or below which Node features are hidden. |
| `node_zoom.compact_max_zoom`, `node_zoom.medium_max_zoom` | Positive boundaries for compact and medium Node sizes. All three zoom boundaries must strictly increase. |
| `node_zoom.compact_scale`, `node_zoom.medium_scale` | Node radius multipliers above 0 and at most 1; compact scale must not exceed medium scale. Above medium zoom, full radius is used. |
| `relation_membership.node_radius_px`, `node_stroke_width_px`, `way_width_px`, `area_band_total_width_px` | Positive logical-pixel dimensions for relation member markers, lines and area edge bands. They must fit within the visual limits below. |
| `interaction.node_extra_radius_px`, `way_extra_width_px`, `area_edge_width_px` | Positive logical-pixel allowances around visible Node, Way and Area geometry for pointer selection. |
| `interaction.min_node_radius_px`, `max_node_radius_px`, `min_way_width_px`, `max_way_width_px`, `max_area_edge_width_px` | Positive lower and upper hit-size bounds. Each minimum must not exceed its maximum; `area_edge_width_px` must not exceed its maximum. Invisible features remain non-interactive. |
| `visual_limits.max_canvas_node_radius_px`, `max_canvas_stroke_width_px` | Positive logical-pixel safety caps for Canvas and relation visuals. Oversized Canvas/relation settings can fail validation; oversized user CSS gets a warning and the hit layer still obeys its bounds. |

[← User Guide](00-index.md) · [Configuration](02-configuration.md) · [web.yaml](04-web-yaml.md)
