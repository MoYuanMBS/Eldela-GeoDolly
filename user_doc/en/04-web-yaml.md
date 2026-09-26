# 04 · web.yaml

**English** · [简体中文](../zh/04-web-yaml.md)

[`config/web.yaml`](../../config/web.yaml) holds the HTTP addresses, tool capacity, session lifetime and Snapshot resource limit. Edit the existing keys and restart GeoDolly. Values below describe the current file; consult the file for the deployment's actual numbers.

## On this page

[HTTP addresses](#http) · [Tool execution](#tool_execution) · [Sessions](#session) · [Snapshots](#snapshot)

### http

| Field | Meaning and adjustment |
| --- | --- |
| `listen_host` | Nonempty address on which both the map and warning HTTP services listen. `127.0.0.1` accepts local connections; choose a reachable listener when using a reverse proxy or another network arrangement. |
| `warning.port` | Positive TCP port, at most 65535, for browser warning reports. This is separate from the map port. |
| `warning.max_body_bytes` | Positive limit on each warning request body before JSON parsing, in bytes. |
| `warning.rate_limit_window_seconds` | Positive duration of the shared warning-report rate-limit window, in seconds. |
| `warning.max_requests_per_window` | Positive number of warning requests permitted per window across the service. |
| `map.port` | Positive TCP port, at most 65535, for map pages, data, snapshots and tiles. |
| `map.public_origin` | Externally reachable HTTP(S) origin used in returned map links; include scheme, host and any public port, with no path, credentials, query or fragment. Changing `map.port` does not update this field automatically. |

For a public deployment, set `map.public_origin` to the URL that users' browsers can reach and route that address to the configured listener. The supplied localhost origin is intended for a browser that can reach the same machine. Ensure the warning endpoint is routed for interactive browser diagnostics if you use a proxy.

### tool_execution

These limits are shared by `location_search`, `tool_a` and `tool_b`. Queue time is separate from the execution timeout.

| Field | Meaning and adjustment |
| --- | --- |
| `max_workers` | Positive number of tool calls that may execute at once. More workers increase simultaneous upstream and Snapshot load. |
| `max_queue_length` | Nonnegative number of calls allowed to wait for a worker. `0` returns busy immediately when all workers are occupied. |
| `timeout_seconds` | Positive overall budget, in seconds, after a call gets a worker. It covers analysis, rendering and publication; individual request timeouts in `app.yaml` do not extend it. |

### session

Interactive maps remain active for the configured lifetime. Expiry checks run periodically, so closure can occur after the exact TTL; reopening or refreshing a map does not extend it. After closure, the page shows the saved Snapshot. The saved map files remain available according to the project's archive behavior.

| Field | Meaning and adjustment |
| --- | --- |
| `ttl_seconds` | Positive lifetime of an active interactive map, in seconds. `86400` is 24 hours. |
| `expiry_check_interval_seconds` | Positive interval between expiry checks, in seconds. `1800` allows roughly 30 minutes of closure delay. |
| `flush_interval_seconds` | Positive interval, in seconds, for saving the session index. A shorter interval saves it more often. |
| `max_timer_delay_ms` | Positive upper bound, in milliseconds, on a single Node timer delay. Keep it within the supported timer range; longer check intervals are capped per timer cycle. |

A new map gets its own lifetime. Existing maps are not renewed by changing this setting; restart and generate a new map to verify the new value.

### snapshot

| Field | Meaning and adjustment |
| --- | --- |
| `max_wrapper_physical_pixels` | Positive maximum physical pixel count of the full Snapshot wrapper, including MapSurface and its reference bar. At the current fixed device scale factor of 1, this bounds screenshot width × height; raising it can increase memory use. |

[← User Guide](00-index.md) · [app.yaml](03-app-yaml.md) · [Basemaps and Filters](05-tiles-and-filters.md)
