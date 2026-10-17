# 市场插件的宿主约束（v0.9.1 实测）

本页记录**市场插件为什么长成现在这个样子**。每一条都由当前发行版实测得出，
不是照抄手册。写这个插件时最重要的三个决定（tab 形态、不做一键装、命令交接）
全部由本页的约束推导而来。

> **取证基线**：`D:\Program Files\OpenRevo\open-revo.exe`
> 体积 **9,368,576 B**、`FileVersion` / `ProductVersion` 均为 **0.9.1**（mtime 2026-10-16 20:29）。
> 前端资产 `/assets/index-CXze12DN.js`（解压 641,939 B / 7,920 个 `{`，sha256 `b56cc0a4952ce6c82225…`）
> 与 `/assets/index-CQ_flESn.css`（解压 59,884 B / 410 个 `{`，sha256 `42e8e3a4715d4e6027c5…`），
> 抽取物在 `_extracted/v091/`。
>
> ⚠️ 仓库里其余文档（`plugin-dev-0.8.8-skill.md` 等）的基线是 **0.8.8**，其中若干结论在 0.9.1 已变，
> 差异见本页 §5。宿主**会自我更新**（0.8.8 → 0.9.1 就发生在两次工作之间），
> 断言前先比 exe 体积与资产文件名：**文件名里的哈希就是内容哈希**，文件名没变才能复用旧抽取物。

---

## 1. 形态枚举：0.9.1 新增 `slot`

0.9.1 前端 JS 里实际出现的 `plugin_type` 字面量共 5 个（`grep 'plugin_type==="[a-z]*"'` 计数）：

| 字面量 | 次数 | 说明 |
|---|---|---|
| `plugin_type==="skin"` | 4 | 主窗皮肤，注入 `openrevo-theme-skin` |
| `plugin_type==="background"` | 4 | 背景壁纸，注入 `openrevo-custom-background` |
| `plugin_type==="tab"` | 2 | **面板插槽**：进顶栏胶囊栏，主体是沙盒 iframe |
| `plugin_type==="widget"` | 2 | 桌面挂件：独立 WebView2 窗口 |
| `plugin_type==="slot"` | **2（0.9.1 新增）** | **微插槽**：按 `target_slot` 填进宿主既有页面的占位 |

exe 明文里的 manifest 字段表（@7401398 起）也印证了 `slot` 的两个专属键：

```
…desired_interval_ms sensors always_on_top skip_taskbar plugin_type dir_name telemetry entry
   target_slot slot_height theme_css background_css …
```

`target_slot` / `slot_height` / `dir_name` 在 0.8.8 的字段表里**没有**；
`plugin_type` 与 `target_slot` 在 exe 里都是**单处明文**（Rust 侧字段名表，被拆成碎片串）。

**已知填过槽的名字**：`power.hardware_limit`（出现在电源页 JSX 里，`n.jsx(a0,{name:"power.hardware_limit",…})`）。
宿主对 slot 的取用逻辑逐字：

```js
const b=(await x("get_custom_plugins")).find(k => k.plugin_type==="slot" && k.target_slot===e && k.enabled);
```

⇒ 一个 slot 插件要生效，**三个条件同时成立**：类型是 `slot`、`target_slot` 命中宿主某个具名槽、且 `enabled`。
宿主的槽位 API 只有 `load_plugin_html({pluginId})`，`slot_height` 缺省 `54px`，iframe **不带 sandbox**
（与 tab/widget 不同）。`service` / `shell` / `driver` 在 0.9.1 前端里**依然没有字面量**，
所以它们是否真的存在仍未证实 —— 不要依据手册矩阵对外承诺。

---

## 2. `tab` 插件的真实契约（市场选它的原因）

### 2.1 宿主如何加载与注入

```
插件页点击 tab → invoke('load_plugin_html', {pluginId}) → 得到整份 HTML 文本
              → 作为 iframe 的 srcDoc 注入
```

逐字（`_extracted/v091/index-CXze12DN.js` @563979）：

```js
n.jsx("iframe",{ref:c, title:e.name, srcDoc:r,
  sandbox:"allow-scripts allow-forms allow-same-origin",
  style:{width:"100%",height:"100%",border:"none",background:"transparent",flex:1}})
```

关键点：

* **`srcDoc` 注入** ⇒ 插件 HTML 是**独立文档**，基准 URL 是宿主文档（`tauri://localhost`），
  **不是**插件目录。任何 `<link rel=stylesheet>` / `<script src>` / `<img src="assets/…">`
  **都取不到插件目录里的文件**。所以市场产物必须是**单文件**（CSS/JS 全内联）。
* **`allow-same-origin` 与 `allow-scripts` 同时给** ⇒ 沙盒形同虚设：iframe 与宿主**同源**，
  既能读 `window.parent.document`，也能拿到 `window.parent.__TAURI_INTERNALS__`。
* **没有 `allow-downloads` / `allow-popups`** ⇒ `<a download>` 的下载与 `window.open` 会被拦。

### 2.2 桥：`__OPENREVO_BRIDGE__` 只注入给 widget，tab 靠自己够到父窗口

宿主**只**给 `widget` 形态注入引导脚本（`window.OpenRevo` / `window.__TAURI__` / import map）。
tab 形态的注入路径里**没有**这段脚本 —— 它在 `D0`（widget 组件）的 `useMemo` 里，
逐字构造 `<script>var b=window.parent.__OPENREVO_BRIDGE__||{}…</script>` 再拼到 widget HTML 前。

但 tab 的 iframe 还挂了 `__OPENREVO_BRIDGE__` 到父窗口（@404208，`ExtensionSlot` 里）：

```js
window.__OPENREVO_BRIDGE__={invoke:x, listen:…, emit:…, getCurrentWebviewWindow:…, pluginId:i.id, slotName:e}
```

⇒ **tab 插件直接读 `window.parent.__TAURI_INTERNALS__.invoke` 或用 `window.parent.__OPENREVO_BRIDGE__.invoke` 即可**。
市场两条路都试，取到哪条用哪条（`hostInvoke()`）。

### 2.3 实测：tab iframe 到底能做什么

用一个探针页在**等价沙盒环境**（逐字复刻 `sandbox="allow-scripts allow-forms allow-same-origin"`
+ `srcDoc` 注入 + 父窗口挂 `__TAURI_INTERNALS__`）里实测，结论：

| 能力 | 结果 | 说明 |
|---|---|---|
| 读 `window.parent.__TAURI_INTERNALS__` | ✅ 可读 | 同源 |
| 读 `window.parent.document` | ✅ 可读 | 同源（可用来镜像主题） |
| `invoke('get_custom_plugins')` | ✅ 成功返回数组 | 只读命令可用 |
| `fetch` 到 GitHub API | ✅ HTTP 200 | 有 CORS 头 `Access-Control-Allow-Origin: *` |
| `fetch` 到本地 HTTP | ✅ HTTP 200 | 回环可达 |
| `window.open(...)` | ❌ 返回 `null` | 无 `allow-popups` |
| `<a download>` | ⚠️ 触发了点击但不会落盘 | 无 `allow-downloads` |
| `navigator.clipboard.writeText` | ⚠️ 视权限而定 | 市场备了三层降级（见 §4） |

⇒ tab 形态**足以**做「浏览 + 取数据 + 渲染」，但**不足以**做「下载文件」。

---

## 3. 为什么市场不做「一键安装」

0.9.1 的 Rust 命令表（@7343488 与 @7437700 两段注册表逐字拼接）里，与插件相关的**只有**：

```
get_custom_plugins   load_plugin_html   load_plugin_theme_css   load_plugin_background_css
set_custom_plugin_enabled   open_plugins_dir   open_custom_widget   close_custom_widget
set_active_skin   set_active_background   get_active_skin   get_active_background   widget_ready
```

以下命令在本版**全部 0 命中**（前端 JS 与 exe 都查过）：
`install_plugin`、`uninstall_plugin`、`remove_plugin`、`reload_plugin`、`write_file`、
`write_text_file`、`read_text_file`、`create_dir`、`fs::write`。

再查 Tauri 侧：exe 里**只挂了两个官方插件** —— `tauri-plugin-autostart-2.5.1`
与 `tauri-plugin-single-instance-2.4.4`（Cargo registry 路径明文）。**没有** `fs` / `dialog` /
`shell` / `http` / `opener` / `store` / `process`；`plugin:fs|`、`plugin:dialog|`、`plugin:shell|`
等权限串**全 0 命中**；`plugin:` 前缀的只有 `window` / `webview` / `app` / `event` / `image` /
`menu` / `path` / `resources` / `tray`，且都**不含**任何写文件原语（`plugin:path|` 只有
`dirname` / `extname` / `is_absolute` / `join` / `normalize` / `resolve` / `resolve_directory`）。

**唯一的写盘通道**是 BRFX 灯效脚本（`save_custom_brfx`），它只写 `custom_effects\*.brfx`，
且接口不接受路径参数（后端固定目录 + `filename`），**不能用来落地插件**。
`open_plugins_dir` 只是用系统资源管理器打开目录，不写任何东西。

⇒ **结论**：本版宿主里，「点一下就下载并装好插件」在技术上不可能实现 ——
不是市场没做，是宿主没开这个口子。所以市场把路径做到最短：

```
复制一条 PowerShell 命令（git clone 到插件目录）→ 用户粘一次 → 回插件页点【刷新】
```

UI 上**明写**这一点（安装弹窗顶部那条 warning 就是），不假装能做到。

---

## 4. 由约束推导出的实现要点

1. **单文件产物**：`build_market.py` 把 `market.css` + `market.js` 内联进 `index.html`，
   并在构建期断言产物里**零外部引用**（`<link rel=stylesheet>` / `<script src>` / `@import` / 非 data 的 `<img src>`）。
   理由见 §2.1：srcDoc 下相对路径必然 404。
2. **主题不自带不了**：iframe 是独立文档，宿主 `:root` 的令牌**不会继承**。
   市场自动内联了一整份与宿主同名同值的令牌，并用 `MutationObserver` 监听父文档
   `data-theme`（cyber / mono / light）实时镜像。
3. **能力披露是三态**，不是布尔：
   * `["network"]` = 扫过，检出；
   * `[]` = 扫过，未检出；
   * `null` / 缺字段 = **没扫过**。
   抓取器一律写 `null`（它确实没扫），UI 渲染成"**未扫描**"。**绝不能写 `[]`** —— 那等于撒谎说"检查过，很干净"。
4. **剪贴板三层降级**：`navigator.clipboard` → `document.execCommand('copy')` → 让用户手动选中。
   沙盒里第一层可能被权限拦，所以后两层是必需的，不是冗余。
5. **身份 = `owner/repo[/subpath]`**，`id` 只作为插件目录名（新增校验 E2 检查 id 唯一）。
   展示名撞车只警告、不改身份。
6. **`stars` 取不到时写 `null` 而不是 `0`**：排序把 `null` 放最后，
   绝不把"取不到"读成"比 0 还不受欢迎"。
7. **失败不伪装**：目录拉不到时保留兜底数据，并在 meta 行**如实**写
   `内置目录 · N 条（未连上在线目录：HTTP 404）`；爬虫失败时**不写文件**，
   让上一次的产物继续服务，也绝不假装"目录里没有插件"。

---

## 5. 与仓库既有 0.8.8 文档的差异

同一份基线在两次工作之间从 `v0.8.8-dbfe615`（8,826,368 B）变成了 **0.9.1**（9,368,576 B）。
逐条对照如下，**以本页为准**：

| 项 | 0.8.8 文档 | 0.9.1 实测 |
|---|---|---|
| 形态枚举 | 前端只出现 4 个（无 `slot`） | **+`slot`**，且 manifest 字段表新增 `target_slot` / `slot_height` / `dir_name` |
| `permissions` 字段 | exe / JS 全 0 命中，不存在 | 仍**不存在**（市场不声明它） |
| 插件卡片徽标 | 4 种 + default 分支 | **5 种**（多一个 `微插槽 [target_slot]` 的 accent 徽标） |
| tab 的 iframe sandbox | `allow-scripts allow-forms allow-same-origin` | **一致** |
| widget 的 iframe sandbox | 多一个 `allow-modals` | **一致** |
| tab 能否够到桥 | 未实测 | **实测可够到**（同源），见 §2.3 |
| 安装 / 写盘 IPC | 不存在 | 仍**不存在**，见 §3 |
| 【刷新】热重载 | `v0.8.8-dbfe615` 起重扫列表 + 重放样式 | 0.9.1 的 handler 为 `M=async(j=!1)=>{…get_custom_plugins…if(j){…重放…}}`，语义一致 |
| `:root` 令牌 | 17 个（两版一致） | **一致**（`--surface-*` / `--border-*` / `--text-*` / `--status-*` / `--radius-*`） |

`slug` 无关但值得记：0.9.1 前端多了 `data-form-factor`（`gaming` / `thin_light`）与
`--debug` 机型模拟卡片，**对插件无新增钩子面**（不挂 `documentElement`）。

---

## 6. 本机验证的边界（诚实记录）

* **能验证的**：产物结构（单文件、零外部引用）、宿主对插件目录的枚举结果
  （`manifest.json` 合法、`entry` 存在）、等价沙盒环境下的渲染与交互
  （`_tools/market-verify.sh` 跑预览页，抓 JS 错误 + 渲染计数 + 安装弹窗）、目录校验（`validate_catalog.py`）。
* **不能验证的**：无法在**真实宿主**里驱动 CDP 抓图。原因有两条硬约束：
  1. `open-revo.exe` 的清单是 `requireAdministrator`，进程以 `RunLevel=Highest` 由计划任务启动，
     普通权限 `Stop-Process` 得到「拒绝访问」；`Start-Process -Verb RunAs` 在本机**不会静默提权**
     （实测：提权子进程没有落盘），所以拿不到带 `--remote-debugging-port` 的实例。
  2. 端口 9222 被用户自己的 Chrome（PID 4840）占着，WebView2 无法复用。
* 因此本机验证的**上限**是「等价沙盒 + 宿主目录枚举」，这一点已在上面写明。
  要在真实宿主里出图，需要一次人工 UAC 点击后按 `_tools\relaunch-debug.ps1` 的思路重启。
