# GeoDolly User Guide

**English** · [简体中文](../zh/00-index.md)

The guide follows the order in which most people set up and customize GeoDolly. Start at 01 for a first map, then open the configuration topic you need.

| Order | Guide | What you will find |
| --- | --- | --- |
| 01 | [Getting Started](01-getting-started.md) | Install, connect an MCP client, select a tool, and read map output. |
| 02 | [Configuration](02-configuration.md) | Find the right file and follow the change sequence. |
| 03 | [app.yaml](03-app-yaml.md) | Configure search, Overpass, geometry, IDs, map size and display. |
| 04 | [web.yaml](04-web-yaml.md) | Configure HTTP addresses, tool capacity, sessions and snapshots. |
| 05 | [Basemaps and Filters](05-tiles-and-filters.md) | Edit `tiles.yaml` providers and `filters.yaml` output cleanup. |
| 06 | [Base and Experts](06-base-and-experts.md) | Change default queries and write optional subject rules. |
| 07 | [User Map Styles](07-user-styles.md) | Add a tag style rule, CSS class, or Node icon. |

Configuration changes generally require a restart; browser build settings may also require `npm run build:web`. Each topic explains its own checks.

[← Project home](../../README.md)
