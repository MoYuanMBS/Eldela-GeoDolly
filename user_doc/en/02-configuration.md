# 02 · Configuration

**English** · [简体中文](../zh/02-configuration.md)

GeoDolly reads the repository's `config/` YAML files. Only `app.yaml` and `web.yaml` support JSON environment overrides; other configuration files do not. Settings are validated when loaded; a running backend or built App does not reload them automatically.

## How to change a setting

1. Keep the repository YAML files as the base configuration. Put deployment-specific overrides for `app.yaml` and `web.yaml` in `deploy/geomcp.env`; edit other configuration files directly. Use the topic guides for field names and meaning.
2. Rebuild the browser artifacts when required by the next table, using the same configuration environment as the backend.
3. Restart the backend and reconnect the MCP client if needed. Generate a new map for query or output changes; reopen a map to check a rebuilt style or UI.
4. Check startup or tool warnings. A malformed file can prevent startup; an invalid individual rule may instead be skipped.

| Task | Guide |
| --- | --- |
| Search, Overpass, generated IDs, map display, output switches | [03 · app.yaml](03-app-yaml.md) |
| MCP/map addresses, HTTPS, execution limits, session lifetime, App snapshots | [04 · web.yaml](04-web-yaml.md) |
| Basemap providers and output tag cleanup | [05 · Basemaps and Filters](05-tiles-and-filters.md) |
| Default queries and optional subject rules | [06 · Base and Experts](06-base-and-experts.md) |
| Overlay CSS, tag style rules, and Node icons | [07 · User Map Styles](07-user-styles.md) |

The effective configuration combines the actual [`app.yaml`](../../config/app.yaml) and [`web.yaml`](../../config/web.yaml) with the environment overrides below. Keep required YAML sections intact; the partial examples are overrides, not replacement files.

## When to rebuild

| Change | Apply it with |
| --- | --- |
| Search/Overpass/geometry, IDs, Base/Expert/Filter rules, basemap registry, output switches, tool capacity, or session settings | Restart the backend and generate a new map for changed analysis or output. |
| Browser settings such as UI, Leaflet, initial padding, browser ready timeout, tile success threshold; `web.yaml.snapshot`; user CSS/rules or browser assets | Run both browser builds with `deploy/geomcp.env`, restart the backend, and reopen the map/App. Browser artifacts contain these settings. |
| `http.map.public_origin`, including its deployment path | Put the new address in `deploy/geomcp.env`, run both browser builds, and restart with the same file; update the client URL and proxy or tunnel too. |

The two Vite commands in [Build and run](#build-and-run-with-the-same-file) perform the full browser-page and MCP App builds normally run by `npm run build:web`. Map archives store business data; a style rebuild can affect an existing map when reopened, while changing query rules requires a new analysis. A previously delivered image keeps its original appearance.

## Environment overrides

Use `deploy/geomcp.env` as the shared deployment configuration for browser builds and the running backend. Configuration overrides apply only to `app.yaml` and `web.yaml`. Other configuration files, including `tiles.yaml`, `base.yaml`, and `filters.yaml`, do not support environment overrides and must be edited directly.

| Variable | Applies to |
| --- | --- |
| `GEOMCP_APP_CONFIG_JSON` | Fields under `app.yaml`; TypeScript and Python validate the sections they consume. |
| `GEOMCP_WEB_CONFIG_JSON` | All `web.yaml` sections: `http`, `tool_execution`, `session`, and `snapshot`; consumed by the TypeScript backend and, where applicable, the browser builds. |
| `PYTHON_PATH` | Optional absolute Python executable path; omit to use the repository's `.venv`. |
| `GEOMCP_LOG_LEVEL` | Optional log level; `INFO` includes the listening endpoint at startup. |

The JSON variables contain **objects**, not file paths. Objects merge recursively; arrays and scalar values replace the corresponding YAML value. Explicit `false`, `0`, `[]`, and `null` are not treated as absent, but must still satisfy the field's schema. YAML must remain present and valid. An absent variable uses YAML; an empty value, malformed JSON, or a non-object value is a configuration error.

### Prepare geomcp.env

From the repository root, copy the [template](../../deploy/geomcp.env.example) once, preserving an existing deployment file:

```sh
cp -n deploy/geomcp.env.example deploy/geomcp.env
```

On Windows, copy the template with your file manager or shell. Edit the copied file before building. For a proxy or tunnel with the public address `https://maps.example.com`, these are example complete variable lines:

```dotenv
GEOMCP_WEB_CONFIG_JSON={"http":{"listen_host":"127.0.0.1","listen_protocol":"http","map":{"port":23336,"public_origin":"https://maps.example.com"}}}
GEOMCP_APP_CONFIG_JSON={"ui":{"iframe_max_width_px":1600,"iframe_max_height_px":1000}}
GEOMCP_LOG_LEVEL=INFO
```

Replace the domain with your own. Replace the corresponding line rather than adding a second definition of the same variable. Review the template's other overrides and keep only the ones you want; omitted fields come from YAML. For local HTTP, use the [local profile](01-getting-started.md#local-http); for public HTTPS, follow the [tunnel](01-getting-started.md#localhost-through-cloudflare-tunnel) or [server deployment](04-web-yaml.md#server-deployment-with-a-domain-and-https).

Write one `NAME=value` per line, with each JSON object on one line. Use JSON numbers, booleans, and arrays directly: `2`, `false`, `[]`, not their string equivalents. This is an environment file loaded by Node; do not add `export` or execute it with `source`. Inside a JSON string, encode `#` as `\u0023` so the environment-file parser does not treat it as a comment. The actual `*.env` file is ignored by Git; do not commit deployment values.

### Build and run with the same file

After installing dependencies, run from the repository root:

```sh
npm run build
node --env-file=deploy/geomcp.env node_modules/vite/bin/vite.js build
node --env-file=deploy/geomcp.env node_modules/vite/bin/vite.js build --config vite.launcher.config.ts
node --env-file=deploy/geomcp.env dist/index.js
```

The first command compiles the backend. The next two build the full browser map and MCP App with the deployment configuration; the last starts the persistent backend. Keep it running, and start the proxy or tunnel separately. Python subprocesses inherit the backend environment.

`npm start` and `npm run build:web` do **not** load `deploy/geomcp.env` automatically. They work when the same variables have already been supplied by the process environment; use the explicit commands above for this guide's file-based workflow. The loaders do not automatically read `.env` either. A service must use the same working directory and file, as in the [systemd example](04-web-yaml.md#keep-the-backend-running).

### Precedence and changes

For the same variable, an existing process/shell environment value takes precedence over Node's `--env-file` value. Remove a stale exported `GEOMCP_APP_CONFIG_JSON` or `GEOMCP_WEB_CONFIG_JSON` before switching deployments. The selected JSON object then overrides YAML field by field; this does not merge two competing definitions of the same environment variable.

Editing the file does not update an existing process or built App. Restart for backend-only changes; for browser settings or a changed `public_origin`, repeat both Vite builds, restart with the same file, update the Host URL, and reopen the App. The backend checks the App's built-in public address at startup. See [When to rebuild](#when-to-rebuild).

[← User Guide](00-index.md) · [Getting Started](01-getting-started.md) · [app.yaml](03-app-yaml.md)
