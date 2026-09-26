# GeoDolly 用户指南

[English](../en/00-index.md) · **简体中文**

本指南按使用和定制 GeoDolly 的顺序排列。第一次使用从 01 开始；需要修改配置时，直接进入对应主题。

| 顺序 | 指南 | 内容 |
| --- | --- | --- |
| 01 | [快速开始](01-getting-started.md) | 安装、连接 MCP 客户端、选择工具并理解地图输出。 |
| 02 | [配置总览](02-configuration.md) | 查找配置文件并按顺序修改。 |
| 03 | [app.yaml](03-app-yaml.md) | 配置搜索、Overpass、geometry、编号、地图尺寸和显示。 |
| 04 | [web.yaml](04-web-yaml.md) | 配置 HTTP 地址、工具容量、Session 和截图。 |
| 05 | [Basemap & Filter](05-tiles-and-filters.md) | 修改 `tiles.yaml` 底图和 `filters.yaml` 输出清理。 |
| 06 | [Base & Expert](06-base-and-experts.md) | 修改默认查询和按需启用的专题规则。 |
| 07 | [用户地图样式](07-user-styles.md) | 添加 tag 样式规则、CSS class 或 Node 图标。 |

一般配置变更需要重启；部分浏览器构建开关还需要执行 `npm run build:web`。具体检查方法见各主题页面。

[← 项目主页](../../README.zh.md)
