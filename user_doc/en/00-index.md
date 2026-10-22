# GeoDolly User Guide

**English** · [简体中文](../zh/00-index.md)

The guide follows the order in which most people set up and customize GeoDolly. Start at 01 for a first map, then open the configuration topic you need.

| Order | Guide | What you will find |
| --- | --- | --- |
| 01 | [Getting Started](01-getting-started.md) | Choose local HTTP or a Cloudflare HTTPS tunnel, build/start, install in a Host, and use maps. |
| 02 | [Configuration](02-configuration.md) | Use `geomcp.env` for app/web overrides, build/start commands, precedence, and rebuild rules. |
| 03 | [app.yaml](03-app-yaml.md) | Configure search, Overpass, geometry, IDs, map size and display. |
| 04 | [web.yaml](04-web-yaml.md) | Deploy a domain with HTTPS and systemd; configure addresses, tool capacity, sessions, and App screenshots. |
| 05 | [Basemaps and Filters](05-tiles-and-filters.md) | Edit `tiles.yaml` providers and `filters.yaml` output cleanup. |
| 06 | [Base and Experts](06-base-and-experts.md) | Change default queries and write optional subject rules. |
| 07 | [User Map Styles](07-user-styles.md) | Add a tag style rule, CSS class, or Node icon. |

Backend settings require a restart; browser configuration, styles, App screenshot budgets, and the public address also require both browser builds with the same `deploy/geomcp.env` used at startup. See [When to rebuild](02-configuration.md#when-to-rebuild) and [Environment overrides](02-configuration.md#environment-overrides).

[← Project home](../../README.md)
