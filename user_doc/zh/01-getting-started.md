# 01 · 快速开始

[English](../en/01-getting-started.md) · **简体中文**

先选择部署地址、配置 `deploy/geomcp.env`，再构建并启动后端，最后在 MCP Host 中安装连接并生成第一张地图。

## 环境要求

- Node.js **22.22.2**，对应仓库 `.nvmrc`。
- Python **3.12**，包含 `venv` 和 `pip`。
- 支持 **Streamable HTTP** 的 Host/客户端；内嵌地图还需要 **MCP Apps**，App 工具和消息/图片交付需要宿主提供相应能力。
- 可以访问依赖下载、地点搜索、地图要素和底图瓦片服务的网络。

项目命令均在**仓库根目录**执行。MCP 连接与 App 浏览器请求都必须能访问后端。托管客户端的 `localhost` 指向托管端自身，不能访问你的电脑。部分 Host 对远程 MCP/App 要求公开 HTTPS 地址，HTTPS 宿主也可能阻止 HTTP 资源；是否接受本地 HTTP 以具体 Host 为准。有此限制时使用下文 HTTPS 方案，另见 [MCP Apps 宿主接入说明](https://apps.extensions.modelcontextprotocol.io/api/documents/testing-mcp-apps.html)。

## 安装依赖与准备配置

Linux 或 macOS：

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
cp -n deploy/geomcp.env.example deploy/geomcp.env
```

Windows 使用 `py -3.12 -m venv .venv`、`.\.venv\Scripts\python.exe -m pip install -r requirements.txt`，再执行 `npm ci`，用对应 shell 或文件管理器复制模板。已有 `geomcp.env` 时保留原文件。

后端自动使用仓库 `.venv`；仅使用其他 Python 时才在环境文件中设置 `PYTHON_PATH`。检查复制出的全部覆盖项，按下文部署场景修改已有的 `GEOMCP_WEB_CONFIG_JSON` 行。JSON 保持单行；格式和优先级见[环境变量覆盖](02-configuration.md#环境变量覆盖)。

## 选择部署方式

| 后端运行位置 | 对外地址 | 操作说明 |
| --- | --- | --- |
| 本机，Host 接受本地 HTTP | `http://127.0.0.1:23336` | [本机 HTTP](#本机-http) |
| 本机，需要供远程或仅接受 HTTPS 的 Host 使用 | 固定 HTTPS 域名转发到 localhost | [Cloudflare Tunnel](#localhost-通过-cloudflare-tunnel-提供-https) |
| 有域名的服务器 | `https://maps.example.com` | [域名与 HTTPS 部署](04-web-yaml.md#域名与-https-服务器部署) |

### 本机 HTTP

在 `deploy/geomcp.env` 中设置：

```dotenv
GEOMCP_WEB_CONFIG_JSON={"http":{"listen_host":"127.0.0.1","listen_protocol":"http","map":{"port":23336,"public_origin":"http://127.0.0.1:23336"}}}
```

随后执行[构建与启动](#构建与启动)，在 Host 安装 `http://127.0.0.1:23336/mcp`。此方式要求 MCP 客户端和地图浏览器均可访问该回环监听端口，且 Host 允许 HTTP。

### Localhost 通过 Cloudflare Tunnel 提供 HTTPS

使用**固定域名的命名隧道**，后端仍运行在 localhost，Host 与 App 通过 HTTPS 访问。需要安装 `cloudflared`、拥有 Cloudflare 账号和已接入 Cloudflare 的域名，安装方式见[官方步骤](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/)。

1. 登录并创建命名隧道：

   ```sh
   cloudflared tunnel login
   cloudflared tunnel create geomcp
   ```

2. 记录返回的 UUID 和凭据文件路径。另建 cloudflared 配置文件，例如 `~/.cloudflared/geomcp.yml`，替换占位符和域名：

   ```yaml
   tunnel: <TUNNEL-UUID>
   credentials-file: /absolute/path/to/.cloudflared/<TUNNEL-UUID>.json
   ingress:
     - hostname: maps.example.com
       service: http://127.0.0.1:23336
     - service: http_status:404
   ```

3. 绑定域名，并在独立终端运行隧道；配置文件使用自己的绝对路径：

   ```sh
   cloudflared tunnel route dns geomcp maps.example.com
   cloudflared tunnel --config /absolute/path/to/.cloudflared/geomcp.yml run geomcp
   ```

4. 在 `deploy/geomcp.env` 中设置相同域名：

   ```dotenv
   GEOMCP_WEB_CONFIG_JSON={"http":{"listen_host":"127.0.0.1","listen_protocol":"http","map":{"port":23336,"public_origin":"https://maps.example.com"}}}
   ```

5. 另开终端执行[构建与启动](#构建与启动)，保持两个进程运行，在 Host 安装 `https://maps.example.com/mcp`。公开 TLS 由 Cloudflare 终止，本机无需配置证书；保留公开 `Host` 请求头，不要改成 `127.0.0.1`。

Cloudflared 的 YAML 管理隧道，`geomcp.env` 管理 GeoDolly 的构建与运行配置，两者用途不同。GeoDolly 不会启动 cloudflared。公开域名变化后，修改环境文件、重新构建两个浏览器产物、重启后端并更新 Host 连接。

简短命令 `cloudflared tunnel --url http://127.0.0.1:23336` 创建的是 Quick Tunnel，随机 `trycloudflare.com` 域名会在重启后变化，且 **Quick Tunnel 不支持 SSE**，而本项目的 Streamable HTTP 传输使用 SSE，因此不能将它作为完整 MCP 部署方案。MCP 连接请使用上面的命名隧道，限制以 [Cloudflare 官方说明](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)为准。

### 有域名的服务器

按[服务器部署步骤](04-web-yaml.md#域名与-https-服务器部署)配置 DNS、Caddy HTTPS 代理、环境文件和后端常驻服务。常规结构为公网 `https://maps.example.com` 的 443 端口 → 本机 HTTP `127.0.0.1:23336`。在浏览器构建**之前**确定公开域名，仅修改 Host 中的连接 URL 不会更新 App。

## 构建与启动

在 `deploy/geomcp.env` 中确定所选公开地址后运行：

```sh
npm run build
node --env-file=deploy/geomcp.env node_modules/vite/bin/vite.js build
node --env-file=deploy/geomcp.env node_modules/vite/bin/vite.js build --config vite.launcher.config.ts
node --env-file=deploy/geomcp.env dist/index.js
```

两条 Vite 命令分别构建完整互动网页与 MCP App；最后一条显式加载同一文件并启动常驻后端，单独执行 `npm start` 不会读取该文件。保持后端及所需代理/隧道运行。关闭 Host 不会停止后端；地点搜索和后续地图调用必须到达同一个后端实例。

## 在 MCP Host 中安装

1. 在 Host 的 MCP/服务器设置中添加**远程或自定义 HTTP 服务器**；如需选择传输方式，选择 **Streamable HTTP**。具体入口名称及自定义服务器可用性以 Host 为准。本后端独立常驻运行，不应将 `node dist/index.js` 配成 stdio 服务器。
2. 填写完整 MCP URL：本地为 `http://127.0.0.1:23336/mcp`，公开域名为 `https://maps.example.com/mcp`。不要填写地图链接或仅填写域名。`public_origin` 带部署路径时，该路径本身就是 MCP 入口，例如 `https://maps.example.com/geomcp` 对应 MCP `https://maps.example.com/geomcp`，不是 `/geomcp/mcp`。
3. 按本文部署时，如有鉴权选项请选择**无鉴权**；后端未实现 Bearer/OAuth。外部访问控制层需另行配置与 Host 兼容的接入方式；HTTPS 提供传输加密，不会自动增加用户身份认证。
4. 保存并重新连接，按 Host 要求在当前会话中启用连接，确认出现 `location_search`、`tool_a`、`tool_b`。Host 调用超时应容纳配置的[工具执行预算与排队时间](04-web-yaml.md#tool_execution)。
5. 调用 `location_search`，再按下文生成地图。检查内嵌 App 是否显示，以及公开的 mapdata、瓦片和字体能否加载。仅 MCP 握手成功不能证明浏览器可达或宿主沙箱已放行。

| Host 能力 | 可期待的结果 |
| --- | --- |
| Streamable HTTP 工具 | 调用搜索与分析；按 Host 支持读取返回的文本/数据。 |
| MCP Apps | 按 `visual_output` 显示内嵌 User/AI 地图。 |
| 将 App 工具暴露给模型 | App 连接时注册的四个 [AI 地图工具](#ai-地图工具)，与三个后端工具分开提供。 |
| App 消息与图片交付 | `screenshot` 模式的自动首张 WebP，以及后续截图交付。 |

Host 缺少某项 App 能力时，可以使用结果中可用的完整互动网页链接；打开网页不会为该 Host 增加 App 工具或图片交付能力。域名或浏览器构建变化后重新连接并打开 App，已有挂载实例可能仍持有旧资源。

## 生成第一张地图

1. 调用 `location_search`，只提交一个查询：

   ```json
   {"queries":[{"query":"Central Park, New York, USA"}]}
   ```

2. 查看返回的 `candidates`，根据地点名称和位置确认目标，并使用该候选对象**实际返回的 `index`**；候选编号从 1 开始，不是数组下标。同时保留这次搜索返回的 `session_id`。如果结果为 `no_match`，请尝试更具体的查询。

3. 调用 `tool_b`。下面是填写模板：请把 `REPLACE_WITH_SEARCH_SESSION_ID` 和 `1` 换成第一步实际返回的值。

   ```json
   {
     "session_id": "REPLACE_WITH_SEARCH_SESSION_ID",
     "selected_indices": [1],
     "basemap": "osm",
     "visual_output": "interactive"
   }
   ```

结果包含由搜索 ID 与所选候选 index 组合的地图 Session ID。兼容宿主会为这个示例展示 User 和 AI 地图。下面继续说明工具选择、参数和地图输出。

## 如何选择分析工具？

| 工具 | 适用问题 | 示例 |
| --- | --- | --- |
| `tool_a` | 较大范围内的道路、铁路、路口、交通走廊、连接关系或其他要素。所选地点用于确定周边区域。 | “这个街区周围有哪些道路和铁路连接？” |
| `tool_b` | 有边界的地点及其周边，例如公园、校园、街区、建筑群或行政区域。所选地点本身是分析重点。 | “这个公园内部及周边有哪些已绘制的设施？” |

两个工具都使用 OpenStreetMap 数据，都不提供路径规划、实时交通或实时运行信息。如果问题关注地点边界和附近设施，优先使用 `tool_b`；如果关注更广的网络，优先使用 `tool_a`。

## 地图工具请求字段

两个分析工具使用相同的请求字段：

| 字段 | 必填 | 填写内容 |
| --- | --- | --- |
| `session_id` | 是 | `location_search` 返回的**搜索** `session_id`。 |
| `selected_indices` | 是 | 仅含一个实际候选 `index` 的数组；例如该候选确实返回 `index: 1` 时才填写 `[1]`。 |
| `basemap` | 是 | 已配置的[底图 Profile](05-tiles-and-filters.md#basemap-profile)。内置 ID 为 `osm` 和 `arcgis_satellite`。 |
| `visual_output` | 是 | `none`、`screenshot` 或 `interactive`；详见[地图输出](#阅读结果)。 |
| `attention_experts` | 否 | 已配置的 [Expert ID](06-base-and-experts.md) 数组；只在该专题与问题相关时填写。 |
| `include_overlay_geojson` | 否 | 需要独立 Overlay JSON 时设为 `true`；部署方也必须允许此输出。 |

确认候选地点后，`tool_a` 的请求形式如下。请将 ID 和 index 替换为自己的搜索结果：

```json
{
  "session_id": "REPLACE_WITH_SEARCH_SESSION_ID",
  "selected_indices": [1],
  "basemap": "osm",
  "visual_output": "screenshot"
}
```

目前每次调用只处理一个候选地点。工具不会自动选择底图或视觉输出，因此每次都要填写这两个字段。分析结果会得到新的地图 Session ID；不要把这个地图 ID 当成下一次分析请求的 `session_id`。原搜索 Session 不可用时，请重新搜索。较大查询可能需要数分钟，客户端自身的超时可能早于后端预算；请预留足够时间。同一 Session 与候选不要并发重复调用，重新生成该地图会替换此前结果。

## 阅读结果

`tool_a` 与 `tool_b` 返回地图 `session_id` 和查询 `bbox`。有分析数据时，`ai_output_yaml` 包含要素索引、记录和概要信息。`include_overlay_geojson: true` 请求**独立**的 `overlay_output_json`；只有 [`output.allow_overlay_geojson`](03-app-yaml.md#output) 已启用且本次确有 Overlay 数据时才会返回。

兼容的 MCP app 宿主在每种模式下都会展示完整的 **User 地图**。`visual_output` 决定附加的 AI 视图和图片：

| 值 | App 地图 | 图片 |
| --- | --- | --- |
| `none` | User 地图 | 无。 |
| `interactive` | User 地图 + 独立 AI 地图 | 视口工具返回实际视野，不生成图片。 |
| `screenshot` | User 地图 + 独立 AI 地图 | 首张 WebP 图片，以及后续 AI 地图操作产生的图片。 |

User 地图支持要素查看和测量。AI 地图有独立视口，调整它不会改变 User 视野。`screenshot` 模式在浏览器中捕获 AI 地图，并尝试通过宿主消息交付首图；显式工具调用可以接管这次首图交付，后续图片随对应 App 工具结果返回。图片展示及模型能否收到图片，取决于宿主的消息和 App 工具支持。

通过 App 中的 **Open map** 或 **Copy** 打开完整互动网页。不支持 MCP app 的客户端仍可读取分析文本；使用随附本地配置时，可访问 `http://127.0.0.1:23336/session/REPLACE_WITH_MAP_SESSION_ID/interactive`，替换为分析返回的**地图** Session ID，并按部署调整公开基础地址。完整网页同样提供要素查看和测量工具。

各模式发布相同的后端地图数据。WebP 图片在 App 内生成并交付宿主；后端归档的是地图数据。

## AI 地图工具

兼容宿主可以向模型提供已挂载 App 的四个工具。所有工具都使用分析返回的**地图** Session ID。它们属于 App；后端提供的工具仍是 `location_search`、`tool_a`、`tool_b`。

| App 工具 | 附加输入 | 操作 |
| --- | --- | --- |
| `geomcp_fit_ai_map_bbox` | `bbox: {south, west, north, east}` | 让 AI 地图容纳目标范围。 |
| `geomcp_set_ai_map_center_zoom` | `center: {longitude, latitude}`、`zoom` | 设置 AI 地图中心与整数缩放级别。 |
| `geomcp_capture_ai_map` | 无 | 捕获当前 AI 视野；仅 `screenshot` 模式可用。 |
| `geomcp_fit_ai_map_to_user_view` | 无 | 让 AI 地图容纳 User 地图当前可见范围。 |

例如，在 `screenshot` 分析后调用截图工具：

```json
{"session_id":"REPLACE_WITH_MAP_SESSION_ID"}
```

工具会等待当前地图就绪。`interactive` 和 `screenshot` 可使用视口工具，截图工具只在 `screenshot` 可执行；`none` 没有 AI 地图，因此工具出现在列表中并不表示当前模式可以调用。截图失败时返回 warning，保留可用地图和视口，可以显式调用截图工具重试。宿主决定是否向模型暴露这些 App 工具。

视口操作只移动已有地图，不会重新收集地理要素。分析其他区域或补充数据需要重新调用分析工具。对齐 User 视野后会返回 AI 地图实际范围；两张地图的比例不同，实际范围可能不完全相同。

## 查看要素与测量

悬停地图要素可查看摘要，点击可打开来源 OSM tags 和可用的 relation 详情。展开 User 地图下方的 **Feature**，可浏览完整分析记录树。

User 地图与完整互动网页提供以下测量工具：

| 工具 | 操作方式 |
| --- | --- |
| Line/Polygon | 单击添加顶点，`Backspace` 撤销末点，双击完成。至少三个不同顶点且末点靠近起点时形成多边形，否则至少两点形成线；仅单击起点不会完成。 |
| Round | 第一次单击确定圆心，移动指针预览半径，第二次独立单击完成。 |

`Esc` 丢弃当前绘制。测量弹窗显示基于 WGS84 的长度、半径、周长或面积，单位为米和平方米。已完成测量可以选择并整体删除，只保留在当前页面中，刷新或关闭后清空；不支持编辑，也不写入后端或分析输出。

## 大范围结果与有效期

面积过大时，`tool_b` 先降级为较宽松的 Tool A 查询模式；若范围仍超限，则生成纯底图预览，不返回分析 YAML 或 Overlay JSON。Tool B 查询降级后，只要地点几何可用，地图仍会标示所选地点。

地图访问有服务有效期：随附默认值为 24 小时，每 30 分钟检查一次，因此过期生效可能略晚。过期后拒绝新的地图数据和瓦片请求，刷新页面会显示“已过期”；已经加载的地图不会自动关闭，落盘数据仍保留。访问、重新打开或重启后端均不续期；成功重新生成同一地图才重置有效期。详见 [Session 配置](04-web-yaml.md#session)。

## 首次运行遇到问题

| 现象 | 检查方法 |
| --- | --- |
| MCP 客户端无法连接 | 使用 `node --env-file=deploy/geomcp.env dist/index.js` 启动，确认两次浏览器构建完成，并检查工作目录、公开 URL、代理/隧道与 Streamable HTTP 入口。 |
| Python 无法启动 | 确认 `.venv` 已创建，或在后端环境中设置 `PYTHON_PATH`。 |
| 后端启动提示 App 地址不匹配 | 按[构建与启动](#构建与启动)重做两次 Vite 构建，与后端使用同一环境文件。 |
| App 或浏览器地图无法加载 | 检查浏览器或宿主沙箱能否访问公开地址，以及宿主是否允许地图数据、瓦片和字体请求；回环地址指向发起请求的机器。 |
| 没有收到图片 | 确认选择 `screenshot`，检查 App warning 和宿主消息/图片支持，再在支持 App 工具的宿主中尝试 `geomcp_capture_ai_map`。 |
| 没有列出 AI 地图工具 | 检查宿主是否支持 App 工具；后端工具列表只有三个搜索/分析工具。 |
| 代理返回 400/403 或连接卡住 | 保留公开 `Host` 和 MCP 会话/协议头，转发完整部署路径，支持 SSE 且不缓冲；不要使用 Quick Tunnel 承载 SSE。 |
| 分析工具提示搜索 Session 不存在 | 重新调用 `location_search`；搜索候选可能过期，后端重启后也不会保留。 |
| 地图已过期 | 重新生成地图；如果搜索 Session 也已失效，先重新搜索。 |

[← 用户指南](00-index.md) · [配置总览](02-configuration.md)
