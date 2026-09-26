# GeoDolly

[English](README.md) · **简体中文**

**GeoDolly** 是基于 MCP 的地理信息工具集。它先帮助你确认地点，再根据 OpenStreetMap 数据分析该地点及其周边，并生成可查看的地图。GeoDolly 适合回答“这里及附近已经绘制了什么”“道路和铁路如何分布”等问题。

![GeoDolly 封面](assets/logo/cover.webp)

## 核心能力

| 能力 | 作用 |
| --- | --- |
| 地点确认 | 搜索地点并核对候选结果，避免分析错误的同名地点。 |
| 区域与网络分析 | 根据问题选择道路、铁路等较大范围的网络分析，或分析有边界的地点及周边设施。 |
| 地图输出 | 提供结构化分析、WebP 截图及可在浏览器中查看的地图；支持 MCP app 的客户端还能展示完整互动地图。 |

## 使用流程

1. 调用 `location_search` 搜索地点，并确认返回的一个候选结果。
2. 根据问题调用 `tool_a` 或 `tool_b`，传入搜索 Session ID 和该候选的 index。
3. 选择底图与 `visual_output`，阅读分析结果并打开地图。

| 工具 | 适用场景 |
| --- | --- |
| `location_search` | 查找并确认地点。 |
| `tool_a` | 道路、铁路、交通连接和较大范围的周边环境。 |
| `tool_b` | 公园、校园、街区等有边界的地点及周边设施。 |

地图工具可以返回结构化 YAML、WebP 截图链接或简化地图页面链接；具体取决于分析结果和 `visual_output`。完整互动地图由支持 GeoDolly MCP app 的客户端另外展示。详细区别见[地图输出](user_doc/zh/01-getting-started.md#阅读结果)。

## 快速开始与文档

- [快速开始](user_doc/zh/01-getting-started.md)：安装、构建、连接 MCP 客户端并制作第一张地图。
- [用户指南](user_doc/zh/index.md)：按序阅读完整指南。
- [配置总览](user_doc/zh/02-configuration.md)：查找主要设置与定制主题。
- [工具说明](user_doc/zh/01-getting-started.md#地图工具请求字段)：选择工具并填写请求参数。

GeoDolly 依赖在线地点、要素及底图服务，分析内容受 OpenStreetMap 数据覆盖影响；它不提供路径规划或实时交通。公开工具名为 `location_search`、`tool_a`、`tool_b`。

## 许可与政策

GeoDolly 依据英文 [LICENSE](LICENSE) 以源码可见方式发布，允许的非商业与研究用途、禁止事项、素材和品牌权利均以该文件为准。商业用途和现实军事行动用途被禁止。再分发或部署前，请阅读[使用与数据政策（中文）](POLICY.md#简体中文)。
