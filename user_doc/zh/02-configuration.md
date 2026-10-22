# 02 · 配置总览

[English](../en/02-configuration.md) · **简体中文**

GeoDolly 读取仓库 `config/` 中的 YAML。仅 `app.yaml` 和 `web.yaml` 支持 JSON 环境变量覆盖，其他配置文件均不支持。配置在加载时校验；运行中的后端和已构建的 App 不会自动热更新。

## 配置顺序

1. 保留仓库 YAML 作为基础配置，将 `app.yaml` 和 `web.yaml` 的部署覆盖值集中写入 `deploy/geomcp.env`；其他配置文件直接编辑原文件。字段含义和层级参考对应配置指南。
2. 按下一张表判断是否需要重新构建浏览器产物，构建与后端使用相同的配置环境。
3. 重启后端，必要时重新连接 MCP 客户端。查询或输出规则变化后生成新地图；样式或 UI 重新构建后，重新打开地图检查。
4. 检查启动或调用 warning。整个文件格式错误可能阻止启动；单条无效规则可能被跳过。

| 需要调整的内容 | 指南 |
| --- | --- |
| 地点搜索、Overpass、Feature ID、地图显示和输出开关 | [03 · app.yaml](03-app-yaml.md) |
| MCP/地图地址、HTTPS、工具容量、Session 有效期和 App 截图 | [04 · web.yaml](04-web-yaml.md) |
| 底图提供商和输出 tag 清理 | [05 · Basemap & Filter](05-tiles-and-filters.md) |
| 默认查询和按需启用的专题规则 | [06 · Base & Expert](06-base-and-experts.md) |
| Overlay CSS、tag 样式规则和 Node 图标 | [07 · 用户地图样式](07-user-styles.md) |

实际生效配置由 [`app.yaml`](../../config/app.yaml)、[`web.yaml`](../../config/web.yaml) 和下文的环境变量覆盖共同组成。保留 YAML 的必填 section；文中的局部示例用于覆盖，不是完整配置文件。

## 何时需要重新构建

| 修改内容 | 生效方式 |
| --- | --- |
| 搜索/Overpass/geometry、编号、Base/Expert/Filter、底图 registry、输出开关、工具容量或 Session 设置 | 重启后端；分析或输出内容变化后生成新地图。 |
| UI、Leaflet、初始 padding、浏览器 ready 超时、瓦片成功率等浏览器设置；`web.yaml.snapshot`；用户 CSS/规则或浏览器素材 | 使用 `deploy/geomcp.env` 执行两次浏览器构建、重启后端，再重新打开地图/App；这些设置已打包进浏览器产物。 |
| `http.map.public_origin`，包括部署路径 | 将新地址写入 `deploy/geomcp.env` 并执行两次浏览器构建，再用相同配置重启；同步更新客户端 URL 与代理或隧道。 |

下文[构建与启动](#使用同一文件构建与启动)的两条 Vite 命令对应 `npm run build:web` 中完整互动网页与 MCP App 的两次构建。地图归档只保存业务数据：重新构建样式后，已有地图重新打开也可使用新样式；查询规则变化则需要重新分析。已经交付的图片保持原来的外观。

## 环境变量覆盖

推荐将 `deploy/geomcp.env` 作为浏览器构建与后端运行共用的部署配置。配置覆盖仅支持 `app.yaml` 和 `web.yaml`；其他配置文件（包括 `tiles.yaml`、`base.yaml`、`filters.yaml`）均不支持环境变量覆盖，需要直接编辑原文件。

| 环境变量 | 应用范围 |
| --- | --- |
| `GEOMCP_APP_CONFIG_JSON` | 按 `app.yaml` 层级覆盖；TypeScript 和 Python 各自校验消费的 section。 |
| `GEOMCP_WEB_CONFIG_JSON` | 支持 `web.yaml` 的全部 section：`http`、`tool_execution`、`session`、`snapshot`；由 TypeScript 后端及需要这些配置的浏览器构建消费。 |
| `PYTHON_PATH` | 可选的 Python 可执行文件绝对路径；不设置时使用仓库 `.venv`。 |
| `GEOMCP_LOG_LEVEL` | 可选日志级别；设置为 `INFO` 可查看启动时的监听入口。 |

JSON 变量值必须是**对象**，不是文件路径。对象递归合并，数组和标量整体替换对应 YAML 值；明确提供的 `false`、`0`、`[]`、`null` 不视为缺失，但最终值仍须满足字段 schema。YAML 必须存在且合法。变量缺失时使用 YAML；空值、非法 JSON 或非对象值会报配置错误。

### 准备 geomcp.env

在仓库根目录复制一次[模板](../../deploy/geomcp.env.example)，保留已有部署文件：

```sh
cp -n deploy/geomcp.env.example deploy/geomcp.env
```

Windows 可用文件管理器或对应 shell 复制。构建前编辑复制出的文件。以下是公开地址为 `https://maps.example.com`、经代理或隧道回源的完整变量行示例：

```dotenv
GEOMCP_WEB_CONFIG_JSON={"http":{"listen_host":"127.0.0.1","listen_protocol":"http","map":{"port":23336,"public_origin":"https://maps.example.com"}}}
GEOMCP_APP_CONFIG_JSON={"ui":{"iframe_max_width_px":1600,"iframe_max_height_px":1000}}
GEOMCP_LOG_LEVEL=INFO
```

将域名换成自己的地址，替换文件中的对应变量行，不要重复定义同名变量。检查模板中的其他覆盖项，只保留实际需要的内容；未提供的字段仍读取 YAML。本地 HTTP 使用[本机配置](01-getting-started.md#本机-http)；公开 HTTPS 可按[隧道](01-getting-started.md#localhost-通过-cloudflare-tunnel-提供-https)或[服务器部署](04-web-yaml.md#域名与-https-服务器部署)流程操作。

每行写一个 `NAME=value`，每个 JSON 对象保持在一行。数字、布尔和数组使用 JSON 原生类型，如 `2`、`false`、`[]`，不要写成字符串。这是由 Node 加载的环境文件，不要加 `export`，也不要用 `source` 执行。JSON 字符串中的 `#` 写成 `\u0023`，避免被环境文件解析器当作注释。实际 `*.env` 文件已被 Git 忽略，不应提交部署值。

### 使用同一文件构建与启动

依赖安装完成后，在仓库根目录运行：

```sh
npm run build
node --env-file=deploy/geomcp.env node_modules/vite/bin/vite.js build
node --env-file=deploy/geomcp.env node_modules/vite/bin/vite.js build --config vite.launcher.config.ts
node --env-file=deploy/geomcp.env dist/index.js
```

第一条编译后端；接下来的两条分别使用部署配置构建完整互动网页与 MCP App；最后一条启动常驻后端。保持后端运行，并单独启动代理或隧道。Python 子进程继承后端环境。

`npm start` 和 `npm run build:web` **不会自动加载** `deploy/geomcp.env`；只有进程环境已经提供相同变量时才能直接使用。本指南以显式加载文件的命令为准，配置 loader 也不会自行读取 `.env`。常驻服务需要使用相同工作目录和文件，见 [systemd 示例](04-web-yaml.md#保持后端常驻运行)。

### 优先级与修改生效

对同名变量，已有进程/终端环境值优先于 Node `--env-file` 中的值。切换部署前应清除旧的 `GEOMCP_APP_CONFIG_JSON`、`GEOMCP_WEB_CONFIG_JSON` 导出值。选中的 JSON 对象再按字段覆盖 YAML；两个同名环境变量定义不会互相合并。

编辑文件不会更新已启动的进程或已构建的 App。仅后端配置变化时重启；浏览器配置或 `public_origin` 变化时，重新执行两次 Vite 构建、用同一文件重启、更新 Host URL 并重新打开 App。后端启动时会核对 App 构建内的公开地址。具体范围见[何时需要重新构建](#何时需要重新构建)。

[← 用户指南](00-index.md) · [快速开始](01-getting-started.md) · [app.yaml](03-app-yaml.md)
