# 01 · Getting Started

**English** · [简体中文](../zh/01-getting-started.md)

Install GeoDolly, create a map, and keep the tool reference and output choices together on this page.

## Requirements

- Node.js **22.22.2**, the version recorded in the repository's `.nvmrc`.
- Python **3.12 or newer**, with `venv` and `pip`.
- An MCP client that can launch a local server command.
- Network access for the Python and npm packages, Playwright Chromium, place search, map features, and basemap tiles.

Run the commands below from the **repository root**. The default configuration serves map links from `http://127.0.0.1:23336`, so the browser opening those links must be on the same machine or otherwise able to reach that address.

## Install and build

On Linux or macOS:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
npx playwright install chromium
npm run build
npm run build:web
```

On Windows, create the virtual environment with `py -3.12 -m venv .venv` and install Python packages with `.\.venv\Scripts\python.exe -m pip install -r requirements.txt`. Then run the same npm commands in your Windows shell.

The server automatically uses the Python executable in the repository's `.venv`. To use another environment, set `PYTHON_PATH` to the full path of its Python executable in the MCP server process.

## Add GeoDolly to your MCP client

Add GeoDolly as a local command in your MCP client. Client configuration formats vary, but these values are required:

| Setting | Value |
| --- | --- |
| Command | `node` |
| Arguments | `dist/index.js` |
| Working directory | Absolute path to the repository root |
| Environment | `PYTHON_PATH` only if you are not using the repository's `.venv` |

The map service starts when the client launches GeoDolly. Keep port `23336` available; if you change the map address, the returned links must point to an address your browser can reach. See [Configuration](02-configuration.md) for the settings involved.

## Create your first map

1. Call `location_search` with exactly one query:

   ```json
   {"queries":[{"query":"Central Park, New York, USA"}]}
   ```

2. Inspect the returned `candidates`. Compare the place name and location, then select the matching candidate's **returned `index`**. Keep the search `session_id` from that same response. If the search returns `no_match`, try a more specific query.

3. Call `tool_b`. The following is a template: replace `REPLACE_WITH_SEARCH_SESSION_ID` and `0` with the actual values returned in step 1.

   ```json
   {
     "session_id": "REPLACE_WITH_SEARCH_SESSION_ID",
     "selected_indices": [0],
     "basemap": "osm",
     "visual_output": "interactive"
   }
   ```

The result has a new map session ID. Tool choices and output modes are explained below.

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
| `selected_indices` | Yes | An array with exactly one returned candidate `index`, for example `[0]` if that candidate actually has `index: 0`. |
| `basemap` | Yes | A configured [basemap profile](03-tiles-and-filters.md#basemap-profiles). The bundled IDs are `osm` and `arcgis_satellite`. |
| `visual_output` | Yes | `none`, `screenshot`, or `interactive`. See [Map Output](#reading-the-result). |
| `attention_experts` | No | An array of configured [Expert IDs](04-base-and-experts.md), only when that subject focus is relevant. |
| `include_overlay_geojson` | No | Set to `true` only when you need a separate Overlay JSON result; the deployment must also allow it. |

For example, after confirming a returned candidate, a `tool_a` request has this shape. Replace the ID and index with values from your own search:

```json
{
  "session_id": "REPLACE_WITH_SEARCH_SESSION_ID",
  "selected_indices": [0],
  "basemap": "osm",
  "visual_output": "screenshot"
}
```

The tools currently process one candidate per call. They do not choose a default basemap or visual output, so include both fields every time. The resulting map has a new session ID; do not pass that map ID as the `session_id` of another analysis request. Search again if the original search session is no longer available.

## Reading the result

`tool_a` and `tool_b` return a new map session ID. When analysis data is available, the result also contains structured YAML for feature lookup, records, and summary information. `include_overlay_geojson: true` asks for a **separate** Overlay JSON result. It appears only when [`output.allow_overlay_geojson`](02-configuration.md#appyaml) is enabled and the analysis contains Overlay data.

`visual_output` selects the visual link in the tool's text response:

| Value | Link | Use |
| --- | --- | --- |
| `none` | No visual link | Read the text result only. |
| `screenshot` | WebP snapshot | View or save a static map. |
| `interactive` | Simplified map page | Pan and zoom the map in a browser. |

The simplified page linked by `interactive` does not include the full feature inspection and measurement interface. A client that supports the GeoDolly MCP app displays the full interactive map separately. Choosing `none` does not skip server-side map and snapshot generation; it only omits the visual link from the tool's text response.

## Large-area results and lifetime

For an oversized area, a tool may produce a basemap-only preview without analysis YAML or Overlay JSON. `tool_b` may first use a broader bounding-box analysis. Interactive access has a configured lifetime: the current default is 24 hours, checked every 30 minutes, so closure can be delayed slightly. Once it closes, the map page displays the saved snapshot. Map content depends on online services and OpenStreetMap coverage.

## If the first run fails

| Symptom | Check |
| --- | --- |
| The client cannot start the server | Confirm both build commands finished, the working directory is the repository root, and `node` uses the required version. |
| Python cannot be started | Confirm `.venv` exists, or set `PYTHON_PATH` in the server environment. |
| Snapshot generation fails | Confirm `npx playwright install chromium` completed and Chromium can start on this machine. |
| A map link does not open | Confirm the server is still running and the browser can reach the configured map address. The default `127.0.0.1` address is local to the server machine. |
| The analysis tool reports a missing search session | Run `location_search` again. Search selections do not survive a server restart and can expire. |

[← User Guide](index.md) · [Configuration](02-configuration.md) · [Base and Experts](04-base-and-experts.md)
