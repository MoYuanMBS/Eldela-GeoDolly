# 04 · web.yaml

**English** · [简体中文](../zh/04-web-yaml.md)

[`config/web.yaml`](../../config/web.yaml) controls the shared MCP/map listener, separate warning service, tool capacity, session lifetime, and App screenshot budgets. Restart the backend after changes; address and screenshot build settings also require both browser builds with the same `deploy/geomcp.env`. See [Configuration](02-configuration.md#when-to-rebuild).

## On this page

[HTTP addresses](#http) · [Server HTTPS](#server-deployment-with-a-domain-and-https) · [Direct TLS](#direct-node-https) · [Tool execution](#tool_execution) · [Sessions](#session) · [Snapshots](#snapshot)

### http

| Field | Meaning and adjustment |
| --- | --- |
| `listen_host` | Nonempty bind address for MCP/maps and the separate warning service. `127.0.0.1` accepts local connections; a proxy or tunnel on that machine can forward to it. |
| `listen_protocol` | Optional `http` or `https` for the local MCP/map listener; when omitted, it follows the normalized public URL protocol. Use `http` when a proxy or tunnel terminates public HTTPS. |
| `warning.port` | Positive TCP port, at most 65535, for browser warning reports. This is separate from the MCP/map port. |
| `warning.max_body_bytes` | Positive limit on each warning request body before JSON parsing, in bytes. |
| `warning.rate_limit_window_seconds` | Positive duration of the shared warning-report rate-limit window, in seconds. |
| `warning.max_requests_per_window` | Positive number of warning requests permitted per window across the service. |
| `map.port` | Positive TCP port, at most 65535, for MCP, full map pages, map data, assets, App fonts, and tiles. |
| `map.public_origin` | Public base URL, optionally including a deployment path. Localhost/IP addresses normalize to HTTP, domains to HTTPS; trailing slashes are removed. Credentials, wildcard bind addresses, query, fragment, and unsafe paths are rejected. |
| `tls.cert_file` | Server certificate-chain file for a local HTTPS listener; default `config/key/fullchain.pem`. Not read for local HTTP. |
| `tls.key_file` | Matching private-key file for a local HTTPS listener; default `config/key/privkey.pem`. Invalid HTTPS certificate/key configuration fails startup. |

Bind address, local port, local protocol, and public URL are independent. Changing `map.port` does not update the public URL. A proxy or tunnel can expose HTTPS on port 443 while forwarding to local HTTP on `23336`.

The deployment path itself is the MCP endpoint; without a path, the endpoint is `/mcp`:

| `map.public_origin` | Client MCP URL | Full browser map |
| --- | --- | --- |
| `http://127.0.0.1:23336` | `http://127.0.0.1:23336/mcp` | `http://127.0.0.1:23336/session/<id>/interactive` |
| `https://maps.example.com` | `https://maps.example.com/mcp` | `https://maps.example.com/session/<id>/interactive` |
| `https://maps.example.com/geomcp` | `https://maps.example.com/geomcp` | `https://maps.example.com/geomcp/session/<id>/interactive` |

For remote use, make this address reachable from both the MCP client and map browser/App sandbox. A reverse proxy or externally managed tunnel can provide HTTPS; GeoDolly does not start the tunnel. After changing the public address, rebuild and start with the [same environment](02-configuration.md#environment-overrides); startup checks the App's built-in address against the backend configuration.

For optional full-page browser diagnostics, start the separate warning listener with the same environment file:

```sh
node --env-file=deploy/geomcp.env dist/server/http/browser-warning-service-main.js
```

Route same-origin `POST /browser-warnings` separately to the warning port (bundled value `23446`); the main listener does not handle it. The minimal Caddy example below omits this optional route. MCP Apps keep their warnings in the browser and do not depend on that reporting service.

#### Server deployment with a domain and HTTPS

This example runs GeoDolly on a server behind **Caddy**, with public HTTPS on 443 and a local HTTP backend on 23336. Another reverse proxy can use the same layout.

1. Point `maps.example.com` A/AAAA records to your server; only publish an AAAA record if that IPv6 address works. Make ports **80 and 443** reachable. Install Node/Python and project dependencies using [Getting Started](01-getting-started.md#install-dependencies-and-prepare-configuration), then [install Caddy](https://caddyserver.com/docs/install). Replace the example domain throughout.
2. In the server's `deploy/geomcp.env`, replace the web override with:

   ```dotenv
   GEOMCP_WEB_CONFIG_JSON={"http":{"listen_host":"127.0.0.1","listen_protocol":"http","map":{"port":23336,"public_origin":"https://maps.example.com"}}}
   ```

   `public_origin` is the address used by the Host and App; `listen_protocol=http` explicitly selects HTTP for the private upstream. If `listen_protocol` is absent from the effective merged configuration, the public domain selects HTTPS and requires local certificates. Caddy on this machine can reach the loopback listener; a proxy in another container or machine needs a bind address and upstream reachable from there.
3. From the repository root, build with the same file and start the backend:

   ```sh
   npm run build
   node --env-file=deploy/geomcp.env node_modules/vite/bin/vite.js build
   node --env-file=deploy/geomcp.env node_modules/vite/bin/vite.js build --config vite.launcher.config.ts
   node --env-file=deploy/geomcp.env dist/index.js
   ```

4. Add this site block to `/etc/caddy/Caddyfile`, preserving any existing sites:

   ```caddyfile
   maps.example.com {
       reverse_proxy 127.0.0.1:23336
   }
   ```

   With the official Linux systemd package, validate and start/reload the service in another terminal:

   ```sh
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl enable --now caddy
   sudo systemctl reload caddy
   ```

   Caddy obtains and renews the domain certificate automatically when DNS and certificate validation are reachable. The HTTP upstream preserves the public `Host`; SSE responses are streamed. See [automatic HTTPS](https://caddyserver.com/docs/quick-starts/https), [proxy behavior](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), and [service operation](https://caddyserver.com/docs/running).
5. Keep the backend running as below, then [install the Host connection](01-getting-started.md#install-in-your-mcp-host) at `https://maps.example.com/mcp`. Generate a map and verify both the embedded App and its full-browser link.

Forward the **whole public site**, including MCP, `/session/...`, `/basemap/...`, `/front/fonts/...`, and `/assets/...`; forwarding only `/mcp` leaves the map broken. Preserve `Host`, `Mcp-Session-Id`, `MCP-Protocol-Version`, and streaming responses. Allow the configured tool execution/queue time in proxy and Host timeouts. Do not cache MCP or session map-data responses. With a deployment prefix such as `/geomcp`, preserve that prefix upstream rather than stripping it; use the endpoint table above.

##### Keep the backend running

For a Linux server using systemd, the following example assumes an existing service account `geomcp`, a repository with installed dependencies at `/opt/geomcp`, and Node 24.22.1 at `/usr/bin/node`. Replace those values with your actual paths/account (`command -v node` shows your Node path). The service account needs access to the Python environment and write access to the project's runtime directories.

Set `ExecStart` below to the actual Node 24 executable path. For upgrades, follow [Runtime upgrades and CA certificates](01-getting-started.md#runtime-upgrades-and-ca-certificates) to update dependencies and builds; after changing the unit, run `sudo systemctl daemon-reload` and `sudo systemctl restart geomcp`.

Create `/etc/systemd/system/geomcp.service`:

```ini
[Unit]
Description=GeoDolly MCP and map backend
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=geomcp
WorkingDirectory=/opt/geomcp
ExecStart=/usr/bin/node --env-file=/opt/geomcp/deploy/geomcp.env /opt/geomcp/dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Stop the foreground Node process first so the listener is free, then run:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now geomcp
sudo systemctl status geomcp --no-pager
sudo journalctl -u geomcp -n 50 --no-pager
```

This service loads the same `geomcp.env` used for browser builds; it does not build them. After changing build-time settings, repeat both Vite builds from the repository root and run `sudo systemctl restart geomcp`. Caddy remains a separate service. For a persistent local tunnel, also keep cloudflared running using its [service instructions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/).

#### Direct Node HTTPS

A reverse proxy is optional. To let Node terminate TLS itself, provide a domain certificate chain and matching private key readable by the backend account. For example, with a directly reachable HTTPS port 23336, set this line in `deploy/geomcp.env`:

```dotenv
GEOMCP_WEB_CONFIG_JSON={"http":{"listen_host":"0.0.0.0","listen_protocol":"https","map":{"port":23336,"public_origin":"https://maps.example.com:23336"},"tls":{"cert_file":"/absolute/path/to/fullchain.pem","key_file":"/absolute/path/to/privkey.pem"}}}
```

Build both browser artifacts and start with the same file as above. Point DNS at the server, allow port 23336, and install `https://maps.example.com:23336/mcp` in the Host. The certificate must cover the domain and be trusted by the Host/browser; a self-signed certificate is not a general remote-Host solution. Unlike the Caddy route, certificate issuance/renewal and reloading Node after certificate replacement are your responsibility. Public and listener ports must match unless another forwarding layer maps them.

### tool_execution

`location_search`, `tool_a`, and `tool_b` share a bounded worker pool and queue; each call has its own execution timer. Queue time is separate from execution time.

| Field | Meaning and adjustment |
| --- | --- |
| `max_workers` | Positive number of tool calls that may execute at once. More workers increase simultaneous upstream requests and backend load. |
| `max_queue_length` | Nonnegative number of calls allowed to wait for a worker. `0` returns busy immediately when all workers are occupied. |
| `timeout_seconds` | Positive budget in seconds after a call gets a worker, covering Python processing, TypeScript data preparation, file checks, and publication. Individual request timeouts in `app.yaml` do not extend it. |

When workers and queue are full, a call returns a structured busy error. Cancellation or timeout stops the corresponding work and later publication. Browser map initialization and App screenshots occur after the backend result and use the independent [`browser_map.ready_timeout_seconds`](03-app-yaml.md#browser_map) budget. The client's own timeout remains independent.

### session

Map data and new tile requests share the same lifetime. Expiry checks run periodically; an expired session returns HTTP 410, and a reloaded browser page shows “已过期” (expired). Already loaded maps are not closed automatically, but new requests are rejected after expiry. Saved data remains on disk; screenshots are delivered by the App and are not archived by the backend.

| Field | Meaning and adjustment |
| --- | --- |
| `ttl_seconds` | Positive active-map lifetime in seconds; `86400` is 24 hours. |
| `expiry_check_interval_seconds` | Positive expiry scan interval in seconds; `1800` allows around 30 minutes of delay. |
| `flush_interval_seconds` | Positive interval in seconds for saving the Session index. Lower values save more frequently. |
| `max_timer_delay_ms` | Positive cap on a single Node timer delay, in milliseconds; keep it within runtime limits. Longer configured intervals are capped for each timer. |

Access, refresh, and backend restart do not renew a map. A successful regeneration of the same search/candidate map replaces its record and resets the lifetime. Reopening an expired map does not renew it, and there is currently no renewal endpoint. New settings do not extend saved map records retroactively. Idle MCP protocol sessions use the same timing settings but track their own activity separately from map expiry.

### snapshot

These values are validated by the backend and frozen into the MCP App at build time. Repeat both browser builds with `deploy/geomcp.env` and restart after changing them.

| Field | Meaning and adjustment |
| --- | --- |
| `max_wrapper_physical_pixels` | Positive cap on the original AI-map capture, including MapSurface and its reference bar. Capture uses `dpr=1`, `scale=1`; an oversized original fails before encoding. The host's actual screen DPR is independent. |
| `max_base64_bytes` | Final Base64 `image.data` must be strictly smaller than this positive integer byte count, excluding the Data URL prefix. The bundled value is 2000000 bytes; this is an application budget, not the binary WebP size or a host protocol limit. |
| `max_encode_retries` | Nonnegative number of encoding retries after the first attempt, shared by quality and size changes; the bundled value is 3. At most one final small-image fallback is allowed afterward. |

The App captures once, composites a white background, and exports an opaque, static, lossy WebP. To fit the byte budget it lowers quality, then resizes the captured image proportionally; it keeps the whole composition and geographic view. Quality limits and fallback dimensions are browser built-in values, not YAML fields. The final fallback uses a longest side of 640px without enlarging a smaller original. A remaining failure produces a warning and preserves the usable map; encoding retries do not extend the App operation timeout.

[← User Guide](00-index.md) · [app.yaml](03-app-yaml.md) · [Basemaps and Filters](05-tiles-and-filters.md)
