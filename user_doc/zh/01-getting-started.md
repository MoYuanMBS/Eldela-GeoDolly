# 01 · 快速开始

[English](../en/01-getting-started.md) · **简体中文**

这一页把安装、第一张地图、工具参数和地图输出放在一起，方便按顺序操作与查阅。

## 环境要求

- Node.js **22.22.2**，版本记录在仓库的 `.nvmrc` 中。
- Python **3.12 或更高版本**，并具备 `venv` 与 `pip`。
- 能够启动本地服务命令的 MCP 客户端。
- 能够下载 Python 和 npm 依赖、Playwright Chromium，并访问地点搜索、地图要素和底图瓦片所需的在线服务。

下面的命令都应在**仓库根目录**执行。默认配置返回 `http://127.0.0.1:23336` 下的地图链接，因此打开链接的浏览器需要运行在同一台机器上，或能够访问这个地址。

## 安装与构建

Linux 或 macOS：

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
npx playwright install chromium
npm run build
npm run build:web
```

Windows 用户可以运行 `py -3.12 -m venv .venv` 创建虚拟环境，再用 `.\.venv\Scripts\python.exe -m pip install -r requirements.txt` 安装 Python 依赖；npm 命令在 Windows shell 中相同。

服务会自动使用仓库 `.venv` 中的 Python。如果改用其他环境，请在 MCP 服务进程的环境变量 `PYTHON_PATH` 中填写该 Python 可执行文件的完整路径。

## 将 GeoDolly 加入 MCP 客户端

在 MCP 客户端中将 GeoDolly 添加为本地命令。不同客户端的配置格式不同，但需要提供以下值：

| 设置 | 值 |
| --- | --- |
| 启动命令 | `node` |
| 命令参数 | `dist/index.js` |
| 工作目录 | 仓库根目录的绝对路径 |
| 环境变量 | 仅在不使用仓库 `.venv` 时设置 `PYTHON_PATH` |

客户端启动 GeoDolly 时，地图服务也会启动。请确保端口 `23336` 可用；如果修改地图地址，返回的链接必须能被浏览器访问。相关字段见[配置总览](02-configuration.md)。

### 手动启动单一服务，供多个客户端连接

如果客户端会为每个会话启动独立进程，可以改用 HTTP MCP，避免多个进程争用地图端口。先完成上述构建，然后在仓库根目录手动运行：

```powershell
$env:PYTHONUTF8 = "1"
npm run start:http
```

保持该终端运行。MCP 地址为 `http://127.0.0.1:23337/mcp`，地图服务仍使用配置中的端口（默认 `23336`）。HTTP MCP 仅监听本机，不需要为每个客户端再启动进程。关闭客户端连接不会停止服务；在启动终端按 Ctrl+C 停止服务。

Codex 的 `~/.codex/config.toml` 配置为：

```toml
[mcp_servers.geodolly]
url = "http://127.0.0.1:23337/mcp"
enabled = true
```

将原来的 GeoDolly 命令配置替换为这一段，不要同时保留 stdio 启动配置。服务重启会清空搜索会话，需要重新搜索地点。

## 生成第一张地图

1. 调用 `location_search`，只提交一个查询：

   ```json
   {"queries":[{"query":"Central Park, New York, USA"}]}
   ```

2. 查看返回的 `candidates`，根据地点名称和位置确认目标，并使用该候选对象**实际返回的 `index`**。同时保留这次搜索返回的 `session_id`。如果结果为 `no_match`，请尝试更具体的查询。

3. 调用 `tool_b`。下面是填写模板：请把 `REPLACE_WITH_SEARCH_SESSION_ID` 和 `0` 换成第一步实际返回的值。

   ```json
   {
     "session_id": "REPLACE_WITH_SEARCH_SESSION_ID",
     "selected_indices": [0],
     "basemap": "osm",
     "visual_output": "interactive"
   }
   ```

结果会包含新的地图 Session ID。下面继续说明工具选择、参数和地图输出。

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
| `selected_indices` | 是 | 仅含一个实际候选 `index` 的数组；例如该候选确实返回 `index: 0` 时才填写 `[0]`。 |
| `basemap` | 是 | 已配置的[底图 Profile](05-tiles-and-filters.md#basemap-profile)。内置 ID 为 `osm` 和 `arcgis_satellite`。 |
| `visual_output` | 是 | `none`、`screenshot` 或 `interactive`；详见[地图输出](#阅读结果)。 |
| `attention_experts` | 否 | 已配置的 [Expert ID](06-base-and-experts.md) 数组；只在该专题与问题相关时填写。 |
| `include_overlay_geojson` | 否 | 需要独立 Overlay JSON 时设为 `true`；部署方也必须允许此输出。 |

确认候选地点后，`tool_a` 的请求形式如下。请将 ID 和 index 替换为自己的搜索结果：

```json
{
  "session_id": "REPLACE_WITH_SEARCH_SESSION_ID",
  "selected_indices": [0],
  "basemap": "osm",
  "visual_output": "screenshot"
}
```

目前每次调用只处理一个候选地点。工具不会自动选择底图或视觉输出，因此每次都要填写这两个字段。分析结果会得到新的地图 Session ID；不要把这个地图 ID 当成下一次分析请求的 `session_id`。原搜索 Session 不可用时，请重新搜索。

## 阅读结果

`tool_a` 与 `tool_b` 返回新的地图 Session ID。有分析数据时，结果还包含结构化 YAML，用于查找要素、查看记录和概要信息。`include_overlay_geojson: true` 请求的是**独立**的 Overlay JSON；只有 [`output.allow_overlay_geojson`](03-app-yaml.md#output) 已启用且本次确有 Overlay 数据时才会返回。

`visual_output` 只决定工具文本结果附带哪一种视觉链接：

| 值 | 链接 | 用途 |
| --- | --- | --- |
| `none` | 无视觉链接 | 只需要文本结果。 |
| `screenshot` | WebP 截图 | 保存或查看静态地图。 |
| `interactive` | 简化地图页面 | 在浏览器中平移、缩放地图。 |

`interactive` 链接打开的简化页面不提供完整的要素查看和测量界面。支持 GeoDolly MCP app 的客户端会另外展示完整互动地图。选择 `none` 也不会跳过服务端的地图和截图生成，只是不在工具文本中返回视觉链接。

## 大范围结果与有效期

面积过大时，工具可能生成仅含底图的预览；此时没有分析 YAML 或 Overlay JSON。`tool_b` 还可能先改用较大范围的 bbox 分析。互动地图有服务有效期：当前默认 24 小时，每 30 分钟检查一次，因此关闭可能略晚。互动服务关闭后，地图页面展示已保存的截图。地图内容受在线服务与 OpenStreetMap 数据覆盖影响。

## 首次运行遇到问题

| 现象 | 检查方法 |
| --- | --- |
| 客户端无法启动服务 | 确认两个构建命令均已完成、工作目录为仓库根目录，且 `node` 版本正确。 |
| Python 无法启动 | 确认 `.venv` 已创建，或在服务环境中设置 `PYTHON_PATH`。 |
| 截图生成失败 | 确认 `npx playwright install chromium` 已完成，且 Chromium 能在当前机器启动。 |
| 地图链接打不开 | 确认服务仍在运行，且浏览器能访问配置的地图地址。默认 `127.0.0.1` 仅指向服务所在机器。 |
| 分析工具提示搜索 Session 不存在 | 重新调用 `location_search`。搜索候选不会在服务重启后保留，也可能过期。 |

[← 用户指南](00-index.md) · [配置总览](02-configuration.md)
