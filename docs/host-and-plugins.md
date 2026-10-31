# OpenRevo 插件生态（实测）

从 `open-revo.exe` 前端与命令注册表里读到的**实际行为**，不是官方手册的转述。

> 命令签名与安装器防线：[`reference/host-plugin-ipc.md`](reference/host-plugin-ipc.md)。

## 1. 八种形态

`plugin_type` 的八个取值：

| 形态 | 说明 | 注入点 / 载体 | 取证来源 |
|---|---|---|---|
| `skin` | 主窗皮肤 | `<style id="openrevo-theme-skin">` | 前端字面量 |
| `background` | 背景壁纸 | `<style id="openrevo-custom-background">` | 前端字面量 |
| `tab` | **面板插槽**（市场就是它） | 顶栏胶囊 → 沙盒 iframe | 前端字面量 |
| `widget` | 桌面挂件 | 独立 WebView2 窗口 | 前端字面量 |
| `slot` | 微插槽 | 按 `target_slot` 填进宿主既有页面 | 前端字面量 |
| `service` | 无头服务 | 伴随进程（清单 `service` 段） | 官方手册 |
| `shell` | 完整外壳 | 整窗替换 | 官方手册 |
| `driver` | 硬件驱动 | 需要底层驱动 / 提权 | 官方手册 |

后三种在前端 JS 里没有对应的注入分支：它们的取值与语义来自官方手册，
**宿主侧的运行行为没有做过端到端实测**。市场对 `plugin_type` 只做两件事 ——
按取值分组筛选、按取值配色 —— **不据此推断任何运行期行为**，也不承诺这八种都能装得上。

`target_slot` 只在 `slot` 形态下有意义；`slot_height` 同理（CSS 长度串）。

两个**宿主不校验**的字段，市场只在披露区如实转述、不当成授权依据：

- `permissions`：清单自述的权限串数组，宿主不读它做拦截 —— 真正的能力边界仍由沙盒与 IPC 决定；
- `telemetry.enabled` / `telemetry.sensors`：同为自述，市场只写「清单声明…」。

## 2. `tab` 插件如何被加载（市场选它的原因）

```
插件页点 tab → invoke('load_plugin_html', { pluginId }) → 得到整份 HTML 文本
             → 作为 iframe 的 srcDoc 注入
```

三个直接后果：

* **`srcDoc` 注入** ⇒ 插件 HTML 是**独立文档**，基准 URL 是宿主文档（`tauri://localhost`），
  不是插件目录。任何 `<link rel=stylesheet>` / `<script src>` / `<img src="assets/…">`
  **都取不到插件目录里的文件** ⇒ 产物必须是单文件（CSS/JS 全内联）。
* **`allow-same-origin` 与 `allow-scripts` 同时给** ⇒ 沙盒形同虚设：iframe 与宿主**同源**，
  既能读 `window.parent.document`，也能拿到 `window.parent.__TAURI_INTERNALS__`。
* **没有 `allow-downloads` / `allow-popups`** ⇒ `<a download>` 与 `window.open` 会被拦，
  所以下载、解压、落盘只能交给宿主。

### 2.1 三套 sandbox 各不相同

| 形态 | sandbox | 后果 |
|---|---|---|
| `tab` | `allow-scripts allow-forms allow-same-origin` | 无 `allow-downloads` / `allow-popups` / `allow-modals` |
| `widget` | 上者 + `allow-modals` | 多模态对话框 |
| `slot` | **无 sandbox** | 与宿主同源、无隔离 |

`tab` 里 **`window.confirm` / `alert` 会被静默拦掉并返回 `false`** —— 任何「点确认才继续」
的流程必须用页面内弹窗，否则表现为「点了没反应、控制台零报错」。

### 2.2 桥：`__OPENREVO_BRIDGE__` 只注入给 widget

宿主**只**给 `widget` 注入引导脚本（`window.OpenRevo` / `window.__TAURI__` / import map）。
tab 的 iframe 拿不到这段脚本，但宿主把 `__OPENREVO_BRIDGE__` 挂在了**父窗口**上
（`invoke` / `listen` / `emit` / `getCurrentWebviewWindow` / `pluginId`）。

⇒ tab 插件直接读 `window.parent.__TAURI_INTERNALS__.invoke`
或用 `window.parent.__OPENREVO_BRIDGE__.invoke` 即可。市场两条路都试，取到哪条用哪条。

### 2.3 实测：tab iframe 能做什么

在等价沙盒环境（逐字复刻 sandbox + `srcDoc` 注入 + 父窗口挂 `__TAURI_INTERNALS__`）里实测：

| 能力 | 结果 | 说明 |
|---|---|---|
| 读 `window.parent.__TAURI_INTERNALS__` | ✅ | 同源 |
| 读 `window.parent.document` | ✅ | 同源（用来镜像主题） |
| `invoke('get_custom_plugins')` | ✅ | 只读命令可用 |
| `fetch` 到 GitHub API | ✅ | 有 `Access-Control-Allow-Origin: *` |
| `window.open(...)` | ❌ 返回 `null` | 无 `allow-popups` |
| `<a download>` | ⚠️ 不落盘 | 无 `allow-downloads` |
| `navigator.clipboard.writeText` | ⚠️ 视权限而定 | 市场备了三层降级 |

⇒ tab 形态**足以**做「浏览 + 取数据 + 渲染」，**不足以**做「下载文件」。

## 3. 插件命令：能力靠运行时探测

`ProductVersion` 不能用来判断能力 —— 装了安装 IPC 和没装的版本可能报同一个版本号。
唯一可靠判据是启动时调 `get_plugin_host_capabilities`：

```
get_plugin_host_capabilities -> { host_version, can_install, can_uninstall, can_reload,
                                  can_open_url, can_write_clipboard, can_read_manifest,
                                  can_manage_service }
```

命令不存在（宿主版本较旧）或某个 `can_*` 为假 ⇒ 市场按能力位降级，
**不按版本号猜、也不假装能装**（见 [`market.md`](market.md) §2）。

另外注意：宿主**没有「重启服务」这一条命令**（`restart_plugin` 在 exe 里 0 命中），
重启只能 stop + start。

## 4. 字段名：两族不能互相套用

| 命令族 | 字段名 |
|---|---|
| `install_plugin_from_url` / `uninstall_plugin` / `get_plugin_manifest` | **`id`** |
| `load_plugin_html` / `load_plugin_theme_css` / `load_plugin_background_css` | **`pluginId`** |

`install_plugin_from_url` 的必需字段是 `{ id, url }`，`subpath` / `sha256` 可选。
传错字段名宿主会直接以 `missing required key` 拒收，且**什么都还没做**。

## 5. 让宿主认到新插件

插件页【刷新】= **重扫列表 + 热重载当前样式**，所以装新目录、改样式
**都只需点一次【刷新】**，不必拨开关、不必重启。

## 6. 下载链路与加速

国内直连 GitHub 常常超时，所以市场与安装脚本都留了**加速链路**（gh-proxy.com）：
把完整 GitHub URL 直接拼在 `https://gh-proxy.com/` 后面即可代理，
`raw.githubusercontent.com` / `api.github.com` / `codeload.github.com` / `github.com` 都验证可用。

| 链路 | 默认 | 说明 |
|---|---|---|
| 拉目录（`market/catalog.json`） | 直连 → 加速 → jsDelivr | 三条依次尝试 |
| 「实时发现」（GitHub 搜索 API） | 直连 → 加速 | 失败只影响发现结果，不影响目录 |
| 一键安装（宿主下载归档） | **可选开关，默认关** | 见下方说明 |
| 手动 `git clone` 备用命令 | 走加速 | 加速地址不通时可去掉前缀 |
| `_tools/install-market.ps1` | 走加速，失败自动回退直连 | `-Direct` 可强制直连 |

> **一键安装为什么默认不走加速**：加速后的归档实测仍以 `<repo>-<branch>/` 为根目录，
> 所以 `subpath` 语义不变；但**宿主是否接受非 github.com 的下载域名尚未实测**。
> 因此做成安装弹窗里的显式勾选框，并在界面里写明「报安全策略错误就关掉重试」——
> 不把未验证的路径设成默认。
