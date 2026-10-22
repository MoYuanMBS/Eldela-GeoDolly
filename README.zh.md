# GeoDolly

[English](README.md) · **简体中文**

**GeoDolly** 是基于 MCP 的地理信息工具集。它先帮助你确认地点，再根据 OpenStreetMap 数据分析该地点及其周边，并生成可查看要素详情和进行测量的互动地图。GeoDolly 适合回答“这里及附近已经绘制了什么”“道路和铁路如何分布”等问题。

![GeoDolly 封面](assets/logo/cover.webp)

## 核心能力

| 能力 | 作用 |
| --- | --- |
| 地点确认 | 搜索地点并核对候选结果，避免分析错误的同名地点。 |
| 区域与网络分析 | 根据问题选择道路、铁路等较大范围的网络分析，或分析有边界的地点及周边设施。 |
| 地图输出 | 提供结构化 YAML 与完整互动网页；兼容的 MCP app 宿主还能交付 WebP 图片。 |
| 要素查看与测量 | 查看地图要素详情，进行线、多边形和圆形测量。 |
| AI 地图操作 | 在兼容宿主中让 AI 调整独立地图视口、截图，或对齐用户当前视野。 |

## 使用流程

1. 调用 `location_search` 搜索地点，并确认返回的一个候选结果。
2. 根据问题调用 `tool_a` 或 `tool_b`，传入搜索 Session ID、该候选的 index、底图与 `visual_output`。
3. 阅读分析结果、查看 User 地图，并按所选模式与宿主能力使用 AI 地图或截图。

| 工具 | 适用场景 |
| --- | --- |
| `location_search` | 查找并确认地点。 |
| `tool_a` | 道路、铁路、交通连接和较大范围的周边环境。 |
| `tool_b` | 公园、校园、街区等有边界的地点及周边设施。 |

`visual_output` 决定 MCP app 中的 AI 视图：`none` 展示 User 地图，`interactive` 增加独立的 AI 地图，`screenshot` 还会交付 WebP 图片。App 提供打开或复制完整互动网页链接的入口；图片交付和四个 App 地图工具取决于宿主支持。详细说明见[地图输出](user_doc/zh/01-getting-started.md#阅读结果)与 [AI 地图工具](user_doc/zh/01-getting-started.md#ai-地图工具)。

> **Host 兼容性**：本 README 介绍正式版。部分 Host 尚不支持 MCP Apps，或对 App 工具注册支持不完整，此类环境可选择 [rollback 兼容分支](https://github.com/MoYuanMBS/Eldela-GeoDolly/tree/rollback)。该分支在后端运行 AI 地图，通过后端 MCP 工具提供视口操作，面向 legacy UI 及不支持 App 工具注册的 MCP Apps Host 提供兼容方案。请单独部署该分支，并阅读 [rollback 分支内的部署与使用文档](https://github.com/MoYuanMBS/Eldela-GeoDolly/blob/rollback/user_doc/zh/00-index.md)。
>
> **Rollback release：待发布。**

## 快速开始与文档

- [快速开始](user_doc/zh/01-getting-started.md)：安装依赖、选择部署方式、构建并制作第一张地图。
- [Host 安装](user_doc/zh/01-getting-started.md#在-mcp-host-中安装)：添加 Streamable HTTP URL，检查 MCP Apps、App 工具和图片交付支持。
- [用户指南](user_doc/zh/00-index.md)：按序阅读完整指南。
- [配置总览](user_doc/zh/02-configuration.md#环境变量覆盖)：在 `deploy/geomcp.env` 中统一配置 `app.yaml` 与 `web.yaml` 的覆盖值。
- [工具说明](user_doc/zh/01-getting-started.md#地图工具请求字段)：选择工具并填写请求参数。

**两次浏览器构建与后端启动共用一份 `deploy/geomcp.env`**；指南使用显式的 `node --env-file=deploy/geomcp.env ...` 命令，npm 脚本不会自动读取该文件。先确定公开地址，再构建：

| 部署场景 | 操作指南 |
| --- | --- |
| Host 允许本地 HTTP | [本机部署](user_doc/zh/01-getting-started.md#本机-http) |
| 本地 localhost 通过 HTTPS 对外提供服务 | [Cloudflare 命名隧道](user_doc/zh/01-getting-started.md#localhost-通过-cloudflare-tunnel-提供-https) |
| 正常域名与 HTTPS 服务器 | [DNS、反向代理、证书和常驻服务](user_doc/zh/04-web-yaml.md#域名与-https-服务器部署) |

部分 Host 对远程 MCP/Apps 要求公开 HTTPS，托管客户端也无法通过 localhost 访问你的电脑。本地 HTTPS 请使用固定域名的命名隧道；Cloudflare Quick Tunnel 不支持本后端使用的 SSE。完整步骤与官方参考见上述部署指南。

GeoDolly 依赖在线地点、要素及底图服务，分析内容受 OpenStreetMap 数据覆盖影响；它不提供路径规划或实时交通。后端工具名为 `location_search`、`tool_a`、`tool_b`。

## 许可与政策

GeoDolly 依据英文 [LICENSE](LICENSE) 以源码可见方式发布，允许的非商业与研究用途、禁止事项、素材和品牌权利均以该文件为准。商业用途和现实军事行动用途被禁止。再分发或部署前，请阅读[使用与数据政策（中文）](POLICY.md#简体中文)。
