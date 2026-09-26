# 02 · 配置总览

[English](../en/02-configuration.md) · **简体中文**

GeoDolly 从仓库的 `config/` 目录读取配置。请在现有 YAML 层级内修改字段，重启服务，再生成新地图核对结果。运行中的服务不会自动热更新配置。

## 配置顺序

1. 根据下表找到配置文件，保留其他必填 section。
2. 重启 GeoDolly。若修改 `app.yaml` 的 `ui.decorations_enabled`，先运行 `npm run build:web`；该开关在构建浏览器页面时读取。
3. 用受影响的功能生成新地图，检查启动或调用时的 warning。整个文件格式错误可能阻止启动；单条无效规则可能被跳过。

| 需要调整的内容 | 指南 |
| --- | --- |
| 地点搜索、Overpass、Feature ID、地图显示和输出开关 | [03 · app.yaml](03-app-yaml.md) |
| 地图与 warning 地址、工具容量、Session 有效期和截图限制 | [04 · web.yaml](04-web-yaml.md) |
| 底图提供商和输出 tag 清理 | [05 · Basemap & Filter](05-tiles-and-filters.md) |
| 默认查询和按需启用的专题规则 | [06 · Base & Expert](06-base-and-experts.md) |
| Overlay CSS、tag 样式规则和 Node 图标 | [07 · 用户地图样式](07-user-styles.md) |

各页面解释当前字段及调整方式。实际部署值请以 [`app.yaml`](../../config/app.yaml) 和 [`web.yaml`](../../config/web.yaml) 为准，不要用文中的局部示例覆盖整个文件。

[← 用户指南](00-index.md) · [快速开始](01-getting-started.md) · [app.yaml](03-app-yaml.md)
