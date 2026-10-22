# GeoDolly 用户指南

[English](../en/00-index.md) · **简体中文**

本指南按使用和定制 GeoDolly 的顺序排列。第一次使用从 01 开始；需要修改配置时，直接进入对应主题。

| 顺序 | 指南 | 内容 |
| --- | --- | --- |
| 01 | [快速开始](01-getting-started.md) | 选择本机 HTTP 或 Cloudflare HTTPS 隧道，构建启动、安装到 Host 并使用地图。 |
| 02 | [配置总览](02-configuration.md) | 使用 `geomcp.env` 覆盖 app/web 配置，了解构建启动、优先级和生效规则。 |
| 03 | [app.yaml](03-app-yaml.md) | 配置搜索、Overpass、geometry、编号、地图尺寸和显示。 |
| 04 | [web.yaml](04-web-yaml.md) | 部署域名 HTTPS 与 systemd，配置地址、工具容量、Session 和 App 截图。 |
| 05 | [Basemap & Filter](05-tiles-and-filters.md) | 修改 `tiles.yaml` 底图和 `filters.yaml` 输出清理。 |
| 06 | [Base & Expert](06-base-and-experts.md) | 修改默认查询和按需启用的专题规则。 |
| 07 | [用户地图样式](07-user-styles.md) | 添加 tag 样式规则、CSS class 或 Node 图标。 |

后端设置修改后需要重启；浏览器配置、样式、App 截图预算和公开地址还需要使用与启动相同的 `deploy/geomcp.env` 执行两次浏览器构建。详见[何时需要重新构建](02-configuration.md#何时需要重新构建)与[环境变量覆盖](02-configuration.md#环境变量覆盖)。

[← 项目主页](../../README.zh.md)
