# OpenRevo 插件生态（实测）

从 `open-revo.exe` 前端里抽出的**实际行为**，不是官方手册的转述。
手册的每条承诺与发行版实际行为的对照，见 [`reference/market-host-constraints.md`](reference/market-host-constraints.md)。

> 命令签名与安装器防线：[`reference/host-plugin-ipc.md`](reference/host-plugin-ipc.md)。

## 1. 五种形态

前端 JS 里实际出现的 `plugin_type` 字面量：

| 形态 | 说明 | 注入点 / 载体 |
|---|---|---|
| `skin` | 主窗皮肤 | `<style id="openrevo-theme-skin">` |
| `background` | 背景壁纸 | `<style id="openrevo-custom-background">` |
| `tab` | **面板插槽**（市场就是它） | 顶栏胶囊 → 沙盒 iframe |
| `widget` | 桌面挂件 | 独立 WebView2 窗口 |
| `slot` | 微插槽（0.9.1 新增） | 按 `target_slot` 填进宿主既有页面 |

`service` / `shell` / `driver` 在 0.9.1 前端里**没有字面量**，只在官方手册矩阵中出现，
是否真实存在**未证实** —— 不要依据手册对外承诺。

## 2. 三种 iframe 的 sandbox 各不相同

| 形态 | sandbox | 后果 |
|---|---|---|
| `tab` | `allow-scripts allow-forms allow-same-origin` | 无 `allow-downloads` / `allow-popups` / `allow-modals` |
| `widget` | 上者 + `allow-modals` | 多模态对话框 |
| `slot` | **无 sandbox** | 与宿主同源、无隔离 |

`tab` 里 **`window.confirm` / `alert` 会被静默拦掉并返回 `false`** —— 任何「点确认才继续」
的流程必须用页面内弹窗，否则表现为「点了没反应、控制台零报错」。市场踩过这个坑。

> `tab` 同时给 `allow-same-origin` + `allow-scripts` ⇒ **沙盒形同虚设**：iframe 与宿主同源，
> 既能读 `window.parent.document`，也能拿 `window.parent.__TAURI_INTERNALS__.invoke`。
> **绝不**把「跑在 iframe 里」当安全边界。

## 3. 插件命令：分两代宿主

两代 exe 的 `ProductVersion` **都是 0.9.1**，版本号无法区分能力。老宿主只有 13 条插件命令：

```
get_custom_plugins          load_plugin_html            load_plugin_theme_css
load_plugin_background_css  set_custom_plugin_enabled   open_plugins_dir
open_custom_widget          close_custom_widget         widget_ready
set_active_skin             get_active_skin             set_active_background
get_active_background
```

老宿主这 13 条里**没有一条能**：下载 / 写盘 / 删除插件 / 重载目录 / 开外链 / 读任意文件 / 读宿主版本。

新宿主（9,437,696 B）新增了整族市场与生命周期 IPC：`install_plugin_from_url`、`uninstall_plugin`、
`reload_plugins`、`get_plugin_manifest`、`set_plugin_enabled_unified`、`get_plugin_host_capabilities`、
`open_external_url`、`write_clipboard`、`start_plugin_service` / `stop_plugin_service`。
完整签名与安装器的实际防线见 [`reference/host-plugin-ipc.md`](reference/host-plugin-ipc.md)。

**所以插件代码绝不能按版本号分支** —— 只能运行时探测 `get_plugin_host_capabilities`，
命令不存在就说明是老宿主、走降级路径。市场就是这么做的（见 [`market.md`](market.md) §2）。
另外 `restart_plugin_service` **不存在**，重启只能 stop + start。

> 判据补充：插件管理这族字段名是 `id`，而 `load_plugin_*` 那族是 `pluginId`，**两族不能互相套用**。

## 4. 让宿主认到新插件

插件页【刷新】= **重扫列表 + 热重载当前样式**，所以装新目录、改样式
**都只需点一次【刷新】**，不必拨开关、不必重启。
