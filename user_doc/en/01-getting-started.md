# 01 · Getting Started

**English** · [简体中文](../zh/01-getting-started.md)

Choose a deployment address, configure `deploy/geomcp.env`, build and start the backend, then install the connection in your MCP Host and create a first map.

## Requirements

- Node.js **24.22.1**, the current Node 24 deployment baseline, with npm **11.19.1**.
- Python **3.12**, with `venv` and `pip`.
- A Host/client supporting **Streamable HTTP**; embedded maps also require **MCP Apps**. App tools and message/image delivery require corresponding Host support.
- Network access for dependencies, place search, map features, and basemap tiles.

Run project commands from the **repository root**. The MCP connection and the App's browser requests must both reach the backend. A hosted client cannot reach your computer through its own `localhost`. Some Hosts require a public HTTPS URL for remote MCP/App use, and an HTTPS Host may block HTTP resources; local HTTP acceptance depends on the Host. Use the HTTPS routes below when required, and check the [MCP Apps Host guidance](https://apps.extensions.modelcontextprotocol.io/api/documents/testing-mcp-apps.html).

## Install dependencies and prepare configuration

The runtime baseline includes the [October 2026 Node.js security and CA updates](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases). On Linux or macOS with nvm, select the repository's `.nvmrc` version from the repository root before installing dependencies:

```sh
nvm install
nvm use
node --version
npm --version
```

Check for `v24.22.1` and npm `11.19.1`; `.nvmrc` pins Node to `24.22.1`. Updating nvm's default alias does not switch an existing terminal's active version: run `nvm use` there before building or starting the backend. On Windows or without nvm, install this Node/npm version pair and verify the versions in the terminal used to build and start the server.

On Linux or macOS:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
cp -n deploy/geomcp.env.example deploy/geomcp.env
```

On Windows, use `py -3.12 -m venv .venv` and `.\.venv\Scripts\python.exe -m pip install -r requirements.txt`, run `npm ci`, and copy the template with your shell or file manager. Preserve any existing `geomcp.env`.

The server uses the repository's `.venv` automatically. Set `PYTHON_PATH` in the environment file only when using another Python executable. Review all copied overrides, and edit the existing `GEOMCP_WEB_CONFIG_JSON` line for the route below. Keep the JSON on one line; see [environment-file format and precedence](02-configuration.md#environment-overrides).

## Runtime upgrades and CA certificates

For an existing installation, switch Node first, then refresh dependencies from the repository root:

```sh
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m pip show certifi
npm ci
```

On Windows, replace `.venv/bin/python` with `.\.venv\Scripts\python.exe`. Confirm `certifi` is **2026.10.19 or newer**, as required by [`requirements.txt`](../../requirements.txt). Then repeat [Build and start](#build-and-start), including both browser builds, and restart the backend or its service. A running process keeps its old runtime and loaded dependencies until restarted.

The repository's [`package.json`](../../package.json) declares npm `allowScripts` approvals for the locked `canvas@3.2.3` and `esbuild@0.28.1` installation scripts. Use npm 11.19.1 for `npm ci` so these declarations are recognized and the native/build dependencies are installed under the selected Node runtime. See [npm's installation-script policy](https://docs.npmjs.com/cli/v11/commands/npm-ci/#allow-scripts).

Node's security/CA updates and Python's `certifi` dependency must both be applied. [HTTPX uses the certifi CA bundle by default](https://www.python-httpx.org/advanced/ssl/#configuring-client-instances) to verify upstream HTTPS; updating Node alone does not update the Python bundle. Keep certificate verification enabled. The public-domain certificate chain and private key in [`http.tls`](04-web-yaml.md#direct-node-https) serve a separate purpose: they let the backend provide HTTPS when Node terminates TLS directly.

## Choose a deployment route

| Where the backend runs | Public address | Instructions |
| --- | --- | --- |
| This computer, with a Host that accepts local HTTP | `http://127.0.0.1:23336` | [Local HTTP](#local-http) |
| This computer, exposed to a remote or HTTPS-only Host | A stable HTTPS domain forwarded to localhost | [Cloudflare Tunnel](#localhost-through-cloudflare-tunnel) |
| A server with a domain | `https://maps.example.com` | [Domain and HTTPS deployment](04-web-yaml.md#server-deployment-with-a-domain-and-https) |

### Local HTTP

In `deploy/geomcp.env`, set:

```dotenv
GEOMCP_WEB_CONFIG_JSON={"http":{"listen_host":"127.0.0.1","listen_protocol":"http","map":{"port":23336,"public_origin":"http://127.0.0.1:23336"}}}
```

Then follow [Build and start](#build-and-start). Install `http://127.0.0.1:23336/mcp` in the Host. This works only when both the MCP client and the map browser can reach that loopback listener and the Host permits HTTP.

### Localhost through Cloudflare Tunnel

A **named tunnel with a stable hostname** lets the backend stay on localhost while the Host and App use HTTPS. You need `cloudflared`, a Cloudflare account, and a domain configured on Cloudflare. Follow the [official setup and installation instructions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/).

1. Authenticate and create a named tunnel:

   ```sh
   cloudflared tunnel login
   cloudflared tunnel create geomcp
   ```

2. Note the UUID and credentials-file path. Create a separate cloudflared file, for example `~/.cloudflared/geomcp.yml`, replacing the placeholders and domain:

   ```yaml
   tunnel: <TUNNEL-UUID>
   credentials-file: /absolute/path/to/.cloudflared/<TUNNEL-UUID>.json
   ingress:
     - hostname: maps.example.com
       service: http://127.0.0.1:23336
     - service: http_status:404
   ```

3. Register the hostname and run the tunnel in a separate terminal, using your configuration file's absolute path:

   ```sh
   cloudflared tunnel route dns geomcp maps.example.com
   cloudflared tunnel --config /absolute/path/to/.cloudflared/geomcp.yml run geomcp
   ```

4. Set this line in `deploy/geomcp.env`, using the same hostname:

   ```dotenv
   GEOMCP_WEB_CONFIG_JSON={"http":{"listen_host":"127.0.0.1","listen_protocol":"http","map":{"port":23336,"public_origin":"https://maps.example.com"}}}
   ```

5. Follow [Build and start](#build-and-start) in another terminal, keep both processes running, and install `https://maps.example.com/mcp` in the Host. Public TLS ends at Cloudflare; no local certificate is needed. Preserve the public `Host` header rather than overriding it with `127.0.0.1`.

Cloudflared's YAML config controls the tunnel; `geomcp.env` controls GeoDolly's build/runtime configuration. GeoDolly does not start cloudflared. If the public domain changes, update the environment file, rebuild both browser artifacts, restart, and update the Host connection.

The short command `cloudflared tunnel --url http://127.0.0.1:23336` creates a Quick Tunnel with a random `trycloudflare.com` hostname that changes on restart. **Quick Tunnels do not support SSE**, which this project's Streamable HTTP transport uses, so this is not a complete MCP deployment path. Use the named tunnel above for the MCP connection; see [Cloudflare's limitations](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

### Server with a domain

Use the [server deployment recipe](04-web-yaml.md#server-deployment-with-a-domain-and-https) for DNS, a Caddy HTTPS proxy, the environment-file values, and a persistent backend service. The normal layout is public `https://maps.example.com` on port 443 → local HTTP `127.0.0.1:23336`. Configure the public domain **before** the browser builds; changing only the Host connection URL is insufficient.

## Build and start

After setting the chosen public address in `deploy/geomcp.env`, run:

```sh
npm run build
node --env-file=deploy/geomcp.env node_modules/vite/bin/vite.js build
node --env-file=deploy/geomcp.env node_modules/vite/bin/vite.js build --config vite.launcher.config.ts
node --env-file=deploy/geomcp.env dist/index.js
```

The two Vite commands build the full browser map and MCP App. The last command explicitly loads the same file and starts the persistent backend; `npm start` alone does not read that file. Keep the backend and any proxy/tunnel running. Closing the Host does not stop them. Search and subsequent map calls must reach the same backend instance.

## Install in your MCP Host

1. In the Host's MCP/server settings, add a **remote/custom HTTP server** and select **Streamable HTTP** when a transport choice is available. Field names and custom-server availability depend on the Host. This backend runs independently; do not configure `node dist/index.js` as a stdio server.
2. Enter the complete MCP URL: local `http://127.0.0.1:23336/mcp` or public `https://maps.example.com/mcp`. Do not paste a map URL or just the domain. If `public_origin` includes a deployment path, that path itself is the MCP endpoint: `https://maps.example.com/geomcp` → MCP `https://maps.example.com/geomcp`, not `/geomcp/mcp`.
3. For the deployment shown here, select **no authentication** if asked; the backend does not implement Bearer/OAuth authentication. An external access layer needs its own Host-compatible setup. HTTPS supplies transport encryption, not user authentication.
4. Save/reconnect, enable the connection in the current conversation if the Host requires it, and confirm `location_search`, `tool_a`, and `tool_b` are available. Set the Host's call timeout to allow the configured [execution budget and queue wait](04-web-yaml.md#tool_execution).
5. Call `location_search`, then generate a map as below. Confirm the embedded App renders and can load its public map-data, tile, and font URLs. A successful MCP handshake alone does not verify browser reachability or the Host's sandbox policy.

| Host capability | What to expect |
| --- | --- |
| Streamable HTTP tools | Search and analysis; read the returned text/data according to Host support. |
| MCP Apps | Embedded User/AI map UI according to `visual_output`. |
| App tools exposed to the model | The four [AI map tools](#ai-map-tools), registered when the App connects; these are separate from the three backend tools. |
| App message and image delivery | Automatic first WebP in `screenshot` mode and subsequent capture delivery. |

If the Host lacks an App capability, use the returned full-browser map link where available. It does not add App tools or image delivery to that Host. After changing the domain or browser build, reconnect and reopen the App; an existing mounted App may still hold the old resources.

## Create your first map

1. Call `location_search` with exactly one query:

   ```json
   {"queries":[{"query":"Central Park, New York, USA"}]}
   ```

2. Inspect the returned `candidates`. Compare the place name and location, then select the matching candidate's **returned `index`**. Candidate numbering starts at 1; this is not an array offset. Keep the search `session_id` from that same response. If the search returns `no_match`, try a more specific query.

3. Call `tool_b`. The following is a template: replace `REPLACE_WITH_SEARCH_SESSION_ID` and `1` with the actual values returned in step 1.

   ```json
   {
     "session_id": "REPLACE_WITH_SEARCH_SESSION_ID",
     "selected_indices": [1],
     "basemap": "osm",
     "visual_output": "interactive"
   }
   ```

The result has a map session ID formed from the search ID and the selected candidate index. A compatible host displays the User and AI maps for this example. Tool choices and output modes are explained below.

## Which analysis should I use?

| Tool | Choose it when your question is about… | Example question |
| --- | --- | --- |
| `tool_a` | Roads, railways, intersections, transport corridors, connectivity, or other features across a wider area. The selected place is a reference for the surrounding region. | “What road and rail connections surround this district?” |
| `tool_b` | A bounded place and its surroundings: a park, campus, district, complex, or administrative area. The selected place remains the area of interest. | “What mapped facilities are in and around this park?” |

Both tools use OpenStreetMap data. Neither provides routing, live traffic, or real-time operational information. If the question is about a place boundary and nearby facilities, start with `tool_b`. If it is about the wider network, start with `tool_a`.

## Map tool inputs

Both analysis tools accept the same request fields:

| Field | Required | What to provide |
| --- | --- | --- |
| `session_id` | Yes | The **search** `session_id` returned by `location_search`. |
| `selected_indices` | Yes | An array with exactly one returned candidate `index`, for example `[1]` if that candidate actually has `index: 1`. |
| `basemap` | Yes | A configured [basemap profile](05-tiles-and-filters.md#basemap-profiles). The bundled IDs are `osm` and `arcgis_satellite`. |
| `visual_output` | Yes | `none`, `screenshot`, or `interactive`. See [Map Output](#reading-the-result). |
| `attention_experts` | No | An array of configured [Expert IDs](06-base-and-experts.md), only when that subject focus is relevant. |
| `include_overlay_geojson` | No | Set to `true` only when you need a separate Overlay JSON result; the deployment must also allow it. |

For example, after confirming a returned candidate, a `tool_a` request has this shape. Replace the ID and index with values from your own search:

```json
{
  "session_id": "REPLACE_WITH_SEARCH_SESSION_ID",
  "selected_indices": [1],
  "basemap": "osm",
  "visual_output": "screenshot"
}
```

The tools currently process one candidate per call. They do not choose a default basemap or visual output, so include both fields every time. The resulting map has a new session ID; do not pass that map ID as the `session_id` of another analysis request. Search again if the original search session is no longer available. Allow several minutes for large queries; the client's own timeout can end a call before the backend budget is exhausted. Avoid concurrent duplicate calls for the same session and candidate: regenerating that map replaces its previous result.

## Reading the result

`tool_a` and `tool_b` return the map `session_id` and query `bbox`. When analysis data is available, `ai_output_yaml` contains feature lookups, records, and summary information. `include_overlay_geojson: true` requests a **separate** `overlay_output_json`; it appears only when [`output.allow_overlay_geojson`](03-app-yaml.md#output) is enabled and Overlay data exists.

A compatible MCP app host shows the full **User map** in every mode. `visual_output` controls the additional AI view and images:

| Value | App maps | Images |
| --- | --- | --- |
| `none` | User map | None. |
| `interactive` | User map + independent AI map | Viewport tools return the actual view without an image. |
| `screenshot` | User map + independent AI map | An initial WebP image and images from later AI map operations. |

The User map supports feature inspection and measurements. The AI map has its own viewport; changing it leaves the User view unchanged. In `screenshot` mode, the App captures the AI map in the browser and attempts to send the first image through a host message. An explicit tool call can take over that initial delivery; later images arrive in the corresponding App tool result. Image display and delivery to the model depend on the host's message and App-tool support.

Use **Open map** or **Copy** in the App to open the full interactive browser page. A client without MCP app support can still read analysis text; its map can be opened at `http://127.0.0.1:23336/session/REPLACE_WITH_MAP_SESSION_ID/interactive` with the local settings. Substitute the returned **map** session ID and your deployment's public base URL. The browser page includes the same feature inspection and measurement tools.

All modes publish the same backend map data. WebP images are generated inside the App and delivered to the host; the backend archives map data rather than screenshots.

## AI map tools

A compatible host can expose four tools from the mounted App. Every tool uses the **map** session ID from the analysis result. These are additional App tools; the backend exposes `location_search`, `tool_a`, and `tool_b`.

| App tool | Additional input | Action |
| --- | --- | --- |
| `geomcp_fit_ai_map_bbox` | `bbox: {south, west, north, east}` | Fit the target bounds into the AI map. |
| `geomcp_set_ai_map_center_zoom` | `center: {longitude, latitude}`, `zoom` | Set the AI center and integer zoom. |
| `geomcp_capture_ai_map` | None | Capture the current AI view; available in `screenshot` mode. |
| `geomcp_fit_ai_map_to_user_view` | None | Fit the User map's current visible bounds into the AI map. |

For example, capture the current view after a `screenshot` analysis:

```json
{"session_id":"REPLACE_WITH_MAP_SESSION_ID"}
```

The tools wait for the current maps to become ready. They operate in `interactive` and `screenshot`, with capture restricted to `screenshot`; `none` does not provide an AI map. A listed tool can therefore be unavailable for the current mode. Screenshot failure returns a warning and keeps the usable map and view; an explicit capture can retry. Host support determines whether App tools are exposed to the model.

Viewport commands only move within the existing map data. To analyze another region or collect more features, run a new analysis. Fitting the User view returns the AI map's actual bounds, which can differ because the two viewports may have different proportions.

## Inspect features and take measurements

Hover over a mapped feature to see its summary, or click it to open its source OSM tags and available relation details. Expand **Feature** below the User map to browse the full analysis record tree.

The User map and full browser page provide these measurement tools:

| Tool | How to use it |
| --- | --- |
| Line/Polygon | Click to add vertices, use `Backspace` to remove the last one, and double-click to finish. At least three distinct vertices with the final point near the start form a polygon; otherwise at least two points form a line. Clicking the start alone does not finish it. |
| Round | Click once for the center, move the pointer to preview the radius, then make a second independent click to finish. |

`Esc` discards the current drawing. The measurement popup shows WGS84 length, radius, perimeter, or area in metres and square metres. Completed measurements can be selected and deleted as a whole; they remain in the current page until refresh or close. They are not editable and are not saved to the backend or analysis output.

## Large-area results and lifetime

For an oversized area, `tool_b` first falls back to the broader Tool A query mode; if that area is still too large, the result is a basemap-only preview without analysis YAML or Overlay JSON. A Tool B query fallback continues to mark the selected place on the map when its geometry is usable.

Map access has a configured lifetime: the bundled default is 24 hours, checked every 30 minutes, so expiration can take effect after the exact TTL. Expired sessions reject new map-data and tile requests; reloading the page displays “已过期” (expired). Already loaded maps are not automatically closed, and saved data remains on disk. Refreshing, reopening, or restarting the backend does not extend the lifetime. A successful regeneration of the same map resets it. See [Session settings](04-web-yaml.md#session).

## If the first run fails

| Symptom | Check |
| --- | --- |
| The MCP client cannot connect | Start with `node --env-file=deploy/geomcp.env dist/index.js`, confirm both browser builds completed, and check the working directory, public URL, proxy/tunnel, and Streamable HTTP endpoint. |
| HTTPS requests report certificate verification failures | Confirm the active Node version, update `certifi` through `requirements.txt`, and check the system clock, upstream certificate chain, and any proxy/private CA configuration; keep verification enabled. See [Runtime upgrades and CA certificates](#runtime-upgrades-and-ca-certificates). |
| Python cannot be started | Confirm `.venv` exists, or set `PYTHON_PATH` in the backend environment. |
| The backend reports an App address mismatch | Repeat both Vite builds in [Build and start](#build-and-start), using the same environment file as the backend. |
| The App or browser map cannot load | Check that the browser or host sandbox can reach the public address and that the host permits map-data, tile, and font requests. Loopback refers to the machine making the request. |
| An image is missing | Choose `screenshot`, check the App warning and host message/image support, then try `geomcp_capture_ai_map` in a host that exposes App tools. |
| AI map tools are not listed | Check the host's App-tool support; the backend tool list contains only the three analysis/search tools. |
| A proxy returns 400/403, or the connection stalls | Preserve the public `Host` and MCP session/protocol headers, forward the full deployment path, and support SSE without buffering; do not use a Quick Tunnel for SSE. |
| The analysis reports a missing search session | Run `location_search` again. Search selections can expire and do not survive a backend restart. |
| The map is expired | Generate it again; repeat the search first if its search session has also expired. |

[← User Guide](00-index.md) · [Configuration](02-configuration.md)
