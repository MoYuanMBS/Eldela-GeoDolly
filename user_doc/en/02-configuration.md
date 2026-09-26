# 02 · Configuration

**English** · [简体中文](../zh/02-configuration.md)

GeoDolly reads configuration from the repository's `config/` directory. Edit the existing YAML keys, restart the service, and make a new map to check the result. Running services do not reload configuration automatically.

## How to change a setting

1. Find the relevant file below and keep its required sections intact.
2. Restart GeoDolly. If you change `app.yaml`'s `ui.decorations_enabled`, run `npm run build:web` before restarting; that switch is read during the browser build.
3. Try the affected feature and check startup or tool warnings. A malformed file can prevent startup; an invalid individual rule may instead be skipped.

| Task | Guide |
| --- | --- |
| Search, Overpass, generated IDs, map display, output switches | [03 · app.yaml](03-app-yaml.md) |
| Map and warning addresses, execution limits, session lifetime, snapshots | [04 · web.yaml](04-web-yaml.md) |
| Basemap providers and output tag cleanup | [05 · Basemaps and Filters](05-tiles-and-filters.md) |
| Default queries and optional subject rules | [06 · Base and Experts](06-base-and-experts.md) |
| Overlay CSS, tag style rules, and Node icons | [07 · User Map Styles](07-user-styles.md) |

The guides describe the current YAML fields and how to tune them. Use the actual [`app.yaml`](../../config/app.yaml) and [`web.yaml`](../../config/web.yaml) as the source for deployed values; avoid replacing either file with an abbreviated example.

[← User Guide](00-index.md) · [Getting Started](01-getting-started.md) · [app.yaml](03-app-yaml.md)
