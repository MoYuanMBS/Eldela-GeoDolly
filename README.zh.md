# GeoDolly

[English](README.md) · **简体中文**

**GeoDolly** 是基于 MCP 和 OpenStreetMap 数据的地理信息工具集。这里是 **rollback 兼容分支**，面向尚不支持 MCP Apps 或 App 工具注册不完善的 Host：AI 地图在后端运行，视口操作通过普通 MCP 工具提供。正式版请见 [master](https://github.com/MoYuanMBS/Eldela-GeoDolly/blob/master/README.zh.md)。

![GeoDolly 封面](assets/logo/cover.webp)

## rollback 的不同之处

| 项目 | 本分支行为 |
| --- | --- |
| AI 地图 | 服务器通过 Playwright Chromium，为启用 AI 的每个地图 Session 持续维护独立视图，不依赖 App 工具注册。 |
| User 地图 | MCP Apps 展示 User 地图；支持 legacy UI 的 Host 可嵌入 HTML resource；其他客户端可在浏览器打开 `interactive_map_url`。 |
| `visual_output` | `none` 只提供 User 地图，不创建 AI 会话；`interactive` 与 `screenshot` 是兼容别名，都会创建后端 AI 地图并尝试首图。 |
| 图片 | 通过可选的 `visual_url` 返回图片链接，不发送 Base64 image 或 App 图片消息。`web.yaml` 使用 `snapshot.max_image_bytes`，默认限制为 20 MiB WebP 二进制，而非 master 的 `max_base64_bytes`。 |

## 部署本分支

使用 **Node.js 24.22.1**、npm 11.19.1 和 **Python 3.12**。使用 nvm 时，在仓库内执行 `nvm install`、`nvm use` 即可。以下为 Linux/macOS 命令，请检出 `rollback` 分支后，在仓库根目录执行：

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
npx playwright install chromium
cp -n deploy/geomcp.env.example deploy/geomcp.env
```

即使请求使用 `none`，服务启动也需要 Chromium。请使用运行后端的同一账户安装；Linux 缺少系统库时可用 `npx playwright install --with-deps chromium`。Windows 使用 `py -3.12 -m venv .venv`、`.\.venv\Scripts\python.exe`，并手动复制 env 示例。已有环境还需按[运行环境升级与 CA 证书](https://github.com/MoYuanMBS/Eldela-GeoDolly/blob/master/user_doc/zh/01-getting-started.md#运行环境升级与-ca-证书)更新，保留 `requirements.txt` 中的 `certifi>=2026.10.19`。

编辑 `deploy/geomcp.env`，将其中两项 `GEOMCP_*_CONFIG_JSON` 替换为下方本机示例；每个变量只保留一项定义：

```dotenv
GEOMCP_WEB_CONFIG_JSON={"http":{"listen_host":"127.0.0.1","listen_protocol":"http","map":{"port":23336,"public_origin":"http://127.0.0.1:23336"}}}
GEOMCP_APP_CONFIG_JSON={"ui":{"iframe_max_width_px":1600,"iframe_max_height_px":1000}}
GEOMCP_LOG_LEVEL=INFO
```

**配置环境覆盖仅支持 `app.yaml` 与 `web.yaml`**，分别对应 `GEOMCP_APP_CONFIG_JSON` 和 `GEOMCP_WEB_CONFIG_JSON`；其他 YAML 必须直接修改文件。变量内容是 JSON 对象：对象按字段合并，数组和标量整体替换；基础 YAML 仍须存在，非法覆盖会报错。可选的 `PYTHON_PATH` 指定 Python 3.12 可执行文件的绝对路径，未设置时使用项目 `.venv`。完整规则见[环境变量配置](https://github.com/MoYuanMBS/Eldela-GeoDolly/blob/master/user_doc/zh/02-configuration.md#环境变量覆盖)。

**构建前**先确定公开地址：

| 部署方式 | 配置与参考 |
| --- | --- |
| 本机 HTTP | Host 允许本地 HTTP 时使用上方示例；云端 Host 无法访问你电脑上的 `localhost`。 |
| localhost 对外提供 HTTPS | 按 [Cloudflare 命名隧道](https://github.com/MoYuanMBS/Eldela-GeoDolly/blob/master/user_doc/zh/01-getting-started.md#localhost-通过-cloudflare-tunnel-提供-https)配置固定域名，回源 `http://127.0.0.1:23336`；Quick Tunnel 不支持 SSE。 |
| 正常域名服务器 | 将 `public_origin` 改为实际域名，例如 `https://maps.example.com`，按 [DNS、HTTPS 反向代理与 systemd 部署](https://github.com/MoYuanMBS/Eldela-GeoDolly/blob/master/user_doc/zh/04-web-yaml.md#域名与-https-服务器部署)配置。 |

部分 Host 要求 MCP 连接或 Apps 使用公开 HTTPS。**本分支 Node 仅监听 HTTP**：保持 `listen_protocol: "http"`，由代理或隧道提供 HTTPS；旧 `http.tls` 字段不生效。代理须转发整个站点，包括地图、图片、瓦片、字体和构建资源，保留公开 Host 头，并支持 MCP 流式响应/SSE。后端未内置 Bearer/OAuth 鉴权。Playwright 通过内部 HTTP 渲染。

构建和运行使用**同一份 env 文件**：

```bash
npm run build
node --env-file=deploy/geomcp.env node_modules/vite/bin/vite.js build
node --env-file=deploy/geomcp.env node_modules/vite/bin/vite.js build --config vite.launcher.config.ts
node --env-file=deploy/geomcp.env dist/index.js
```

`npm start` 与 `npm run build:web` 不会自动加载该文件。公开地址改变后，须重建两个浏览器产物并重启；浏览器或样式变更也需重建。systemd 使用实际 Node 24 的绝对路径、仓库根目录作为 `WorkingDirectory`，并加载该 env 文件；修改 unit 后执行 `sudo systemctl daemon-reload`、`sudo systemctl restart geomcp`。后端及代理/隧道应独立于 Host 持续运行。

## 连接 Host 并制作地图

在 Host 中添加 **Streamable HTTP** 服务：本机地址为 `http://127.0.0.1:23336/mcp`，公开域名示例为 `https://maps.example.com/mcp`。若 `public_origin` 带前缀，例如 `https://maps.example.com/geomcp`，MCP endpoint 就是该完整地址，不再追加 `/mcp`。直接部署且未增加外部鉴权层时，选择无认证；按 Host 要求在当前对话启用连接及工具，并为分析与排队预留足够的调用时间。

确认 Host 能列出全部 **5 个后端工具**：

| 工具 | 用途 / 输入 |
| --- | --- |
| `location_search` | 查找并确认地点。 |
| `tool_a` | 分析道路、铁路及较大范围的交通网络。 |
| `tool_b` | 分析有边界的地点及周边设施。 |
| `geomcp_fit_ai_map_bbox` | 通过 `{session_id, bbox: {south, west, north, east}}` 调整 AI 视图。 |
| `geomcp_set_ai_map_center_zoom` | 通过 `{session_id, center: {longitude, latitude}, zoom}` 调整 AI 视图，`zoom` 为非负整数。 |

先调用 `location_search`：

```json
{"queries":[{"query":"Central Park, New York, USA"}]}
```

核对候选后，将**搜索** Session ID 和候选实际返回的 `index` 交给 `tool_b`。编号从 1 开始，下方两项示例值都需替换；若返回 `no_match`，先细化搜索词：

```json
{"session_id":"REPLACE_WITH_SEARCH_SESSION_ID","selected_indices":[1],"basemap":"osm","visual_output":"screenshot"}
```

阅读返回的分析，打开 `interactive_map_url`，并在有 `visual_url` 时查看图片。后续 AI 视口工具使用**本次地图结果中的最终 `session_id`**；每次操作返回实际视口并尝试新截图，仅改变 AI 视图，不重新查询地理数据。本分支没有独立的 App 截图或 User → AI 对齐工具。

请分别检查 User 地图嵌入、两个 AI 工具和图片 URL 获取。legacy 嵌入取决于 Host 支持，收到图片链接也不保证 Host 能抓取或展示；不能内嵌时可打开浏览器地图。部署变更后重新连接并打开 UI。

地图 Session 默认有效 24 小时，访问不续期。AI 会话持续占用服务器浏览器内存，容量为 `tool_execution.max_workers × 10`（默认 20）；满额时关闭最早到期的会话。过期、浏览器故障或取消/超时可能关闭地图和图片。后端重启不恢复旧会话，需要重新生成地图。图片仅存内存，保留首图和最新工具图，工具图 URL 会复用；截图失败时返回 warning，不附本次图片 URL。

## 共用文档

完整指南保留在 **master**；本分支由 README 承载用户说明，不再单独维护 `user_doc/`。分支有差异时以本页为准，尤其是 AI 工具、输出模式、HTTPS 终止和图片预算。

| 主题 | master 参考 |
| --- | --- |
| 配置与可选地图请求字段 | [环境变量覆盖](https://github.com/MoYuanMBS/Eldela-GeoDolly/blob/master/user_doc/zh/02-configuration.md#环境变量覆盖) · [地图工具请求字段](https://github.com/MoYuanMBS/Eldela-GeoDolly/blob/master/user_doc/zh/01-getting-started.md#地图工具请求字段) |
| 底图与过滤 | [瓦片与过滤规则](https://github.com/MoYuanMBS/Eldela-GeoDolly/blob/master/user_doc/zh/05-tiles-and-filters.md) |
| Base 规则与专家 | [Base 与 Experts](https://github.com/MoYuanMBS/Eldela-GeoDolly/blob/master/user_doc/zh/06-base-and-experts.md) |
| Overlay 样式 | [用户样式](https://github.com/MoYuanMBS/Eldela-GeoDolly/blob/master/user_doc/zh/07-user-styles.md) |
| User 地图要素详情与测量 | [查看要素与测量](https://github.com/MoYuanMBS/Eldela-GeoDolly/blob/master/user_doc/zh/01-getting-started.md#查看要素与测量) |

GeoDolly 依赖在线地点、要素及底图服务，分析内容受 OpenStreetMap 数据覆盖影响；它不提供路径规划或实时交通。

## 许可与政策

GeoDolly 依据英文 [LICENSE](LICENSE) 以源码可见方式发布，允许的非商业与研究用途、禁止事项、素材和品牌权利均以该文件为准。商业用途和现实军事行动用途被禁止。再分发或部署前，请阅读[使用与数据政策（中文）](POLICY.md#简体中文)。
