# 宿主契约：插件能做什么、不能做什么

> **给谁看 / 什么时候读**：你要判断某个插件行为在当前宿主上可否实现，或者在某处看到「宿主会拒收」「subpath 多一层」这类说法想查依据时读这份。它是宿主行为的**唯一出处** —— 其他地方提到宿主边界都链到这里。
>
> 内容全部来自对 `open-revo.exe` 的实测与命令注册表取证，不是官方手册的转述。

## 形态

`manifest.json` 的 `plugin_type` 有八个取值。前五个在前端 JS 里有对应的注入分支（实测），后三个只有官方手册的说明。

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

后三种在前端 JS 里没有对应的注入分支：取值与语义来自官方手册，**运行行为没有做过端到端实测**。市场对 `plugin_type` 只做两件事 —— 按取值分组筛选、按取值配色 —— 不据此推断任何运行期行为，也不承诺八种都装得上。

`target_slot` 只在 `slot` 形态下有意义，`slot_height` 同理（CSS 长度串）。

## sandbox 与桥

### `tab` 插件怎么被加载

```
插件页点 tab → invoke('load_plugin_html', { pluginId }) → 得到整份 HTML 文本
             → 作为 iframe 的 srcDoc 注入
```

三个直接后果，解释了本仓库大部分看起来奇怪的规定：

- **`srcDoc` 注入** ⇒ 插件 HTML 是独立文档，基准 URL 是宿主文档（`tauri://localhost`），不是插件目录。任何 `<link rel=stylesheet>` / `<script src>` / `<img src="assets/…">` 都取不到插件目录里的文件 ⇒ **产物必须单文件**（CSS / JS 全内联）。
- **`allow-same-origin` 与 `allow-scripts` 同时给** ⇒ 沙盒形同虚设：iframe 与宿主同源，既能读 `window.parent.document`，也能拿到 `window.parent.__TAURI_INTERNALS__`。
- **没有 `allow-downloads` / `allow-popups`** ⇒ `<a download>` 与 `window.open` 会被拦，所以下载、解压、落盘只能交给宿主。

### 三套 sandbox 各不相同

| 形态 | sandbox | 后果 |
|---|---|---|
| `tab` | `allow-scripts allow-forms allow-same-origin` | 无 `allow-downloads` / `allow-popups` / `allow-modals` |
| `widget` | 上者 + `allow-modals` | 多模态对话框 |
| `slot` | **无 sandbox** | 与宿主同源、无隔离 |

`tab` 里 **`window.confirm` / `alert` 会被静默拦掉并返回 `false`** —— 任何「点确认才继续」的流程必须用页面内弹窗，否则表现为「点了没反应、控制台零报错」。

### 桥：`__OPENREVO_BRIDGE__` 只注入给 widget

宿主**只**给 `widget` 注入引导脚本（`window.OpenRevo` / `window.__TAURI__` / import map）。`tab` 的 iframe 拿不到这段脚本，但宿主把 `__OPENREVO_BRIDGE__` 挂在了**父窗口**上（`invoke` / `listen` / `emit` / `getCurrentWebviewWindow` / `pluginId`）。

⇒ `tab` 插件直接读 `window.parent.__TAURI_INTERNALS__.invoke`，或用 `window.parent.__OPENREVO_BRIDGE__.invoke`。市场两条路都试，取到哪条用哪条。

### 实测：`tab` iframe 能做什么

在等价沙盒环境（逐字复刻 sandbox + `srcDoc` 注入 + 父窗口挂 `__TAURI_INTERNALS__`）里实测：

| 能力 | 结果 | 说明 |
|---|---|---|
| 读 `window.parent.__TAURI_INTERNALS__` | ✅ | 同源 |
| 读 `window.parent.document` | ✅ | 同源（用来镜像主题） |
| `invoke('get_custom_plugins')` | ✅ | 只读命令可用；返回的条目**不含 `enabled`** |
| `fetch` 到 GitHub API | ✅ | 有 `Access-Control-Allow-Origin: *` |
| `window.open(...)` | ❌ 返回 `null` | 无 `allow-popups` |
| `<a download>` | ⚠️ 不落盘 | 无 `allow-downloads` |
| `navigator.clipboard.writeText` | ⚠️ 视权限而定 | 市场备了三层降级 |

⇒ `tab` 形态**足以**做「浏览 + 取数据 + 渲染」，**不足以**做「下载文件」。

## 能力位

`ProductVersion` 不能用来判断能力 —— 装了安装 IPC 和没装的版本可能报同一个版本号。唯一可靠判据是启动时调 `get_plugin_host_capabilities`：

```
get_plugin_host_capabilities -> { host_version, can_install, can_uninstall, can_reload,
                                  can_open_url, can_write_clipboard, can_read_manifest,
                                  can_manage_service }
```

exe 里的字段名连排（逐字）：

```
host_version  can_install  can_uninstall  can_reload  can_open_url
can_write_clipboard  can_read_manifest  can_manage_service
```

这是 `${can_*}` 命名，**不是**第三方文档里写的 `version` / `capabilities: string[]`。按后者写会拿到 `undefined`，能力判断全部失效。

命令不存在（宿主版本较旧）或某个 `can_*` 为假 ⇒ 市场按能力位降级，**不按版本号猜、也不假装能装**。

## 插件 IPC

| 命令 | 参数 | 返回 | 行为 |
|---|---|---|---|
| `get_plugin_host_capabilities` | — | `host_version` + `can_*` | 见上节 |
| `install_plugin_from_url` | `id`, `url`, `subpath?`, `sha256?` | 安装结果 | 下载 + 校验 + 解压 + 落盘 + 热重载 |
| `uninstall_plugin` | `id` | 布尔 | 停服务 → 清配置 → 移入**回收站** |
| `reload_plugins` | — | 插件列表 | 重扫插件目录 |
| `get_plugin_manifest` | `id` | manifest 原文 | 读已装插件的清单 |
| `set_plugin_enabled_unified` | `id`, `enabled` | 布尔 | skin / background / 其它统一开关 |
| `set_custom_plugin_enabled` | `pluginId`, `enabled` | 布尔 | 同上，但字段名不同 |
| `open_external_url` | `url` | 布尔 | 系统浏览器打开（仅 http/https） |
| `write_clipboard` | `text` | 布尔 | 宿主代写剪贴板 |
| `start_plugin_service` | `id` | 服务状态 | 拉起伴随服务 |
| `stop_plugin_service` | `id` | 服务状态 | 停止伴随服务 |
| `get_plugin_service_status` | `id` | 服务状态 | 查询运行状态 |

**没有「重启服务」这一条命令。** exe 里 `restart_plugin` 全 0 命中，也不在分发比较链里。要重启只能 stop + start。

## 字段名：两族不能互相套用

| 命令族 | 字段名 |
|---|---|
| `install_plugin_from_url` / `uninstall_plugin` / `get_plugin_manifest` | **`id`** |
| `load_plugin_html` / `load_plugin_theme_css` / `load_plugin_background_css` | **`pluginId`** |

`install_plugin_from_url` 的必需字段是 `{ id, url }`，`subpath` / `sha256` 可选。传错字段名宿主会直接以 `missing required key` 拒收，且**什么都还没做**。

> 只看到命令名紧跟的 `subpath` / `sha256` 会误以为参数只有三个 —— `id` / `url` 被其它命令复用，已被编译器去重到别处。必需字段要以宿主 serde 报错（`missing required key <名字>`）为准。

## `subpath` 是归档内路径

传给宿主的 `subpath` 会直接拼在 `extracted/` 后面去找 `manifest.json`，宿主**不会剥掉** codeload 归档的包装层：

```
.tmp_install_<id>\
  package.zip
  extracted\
    <repo>-<branch>\          ← 归档固定包装层
      <插件目录>\manifest.json
```

所以：

* 插件在仓库子目录 `plugin-market` ⇒ 传 `<repo>-<branch>/plugin-market`；
* 插件就在仓库根 ⇒ 至少要传归档根那一段 `<repo>-<branch>`。

归档根名规则：`<repo 名>-<branch 名>`，分支里的 `/` 换成 `-`（`feat/x` → `repo-feat-x`）。市场侧由 `archiveSubpath()` 统一构造，`build_market.py` 断言参数对象的 `subpath` 必须走这个函数。

## 安装器防线

从 exe 里的错误串可以直接还原宿主安装器做了什么：

| 错误串 | 说明 |
|---|---|
| `Security violation: Plugin download URL must strictly use HTTPS` | 强制 HTTPS |
| `Security violation: Plugin ID contains illegal characters or path separators` | id 白名单 |
| `Security violation: subpath cannot contain '..'` | 防路径穿越 |
| `Integrity check failed: Expected sha256 …, but downloaded archive hash is …` | sha256 校验 |
| `Verification failed: No valid 'manifest.json' detected in plugin root` | 必须有 manifest |
| `manifest.json not found in resolved content directory` | 解压后仍找不到 manifest |
| `Security violation: Target is outside of plugins directory` | 落盘边界 |
| `DeleteDirectory(..., 'SendToRecycleBin')` | 卸载走回收站 |

解压用 `tar.exe -xf` 或 `Expand-Archive` 双路由；下载用 `curl -fsSL -o` 或 `Invoke-WebRequest`（含 TLS 1.2 强制）。

> **下载地址的域名限制**：从错误串只能确认「必须 HTTPS」，没有看到域名白名单。但宿主是否接受 GitHub 之外的下载域名**未实测** —— 所以市场把「走加速镜像」做成默认关闭的显式开关，而不是默认路径。

## 生命周期操作

已安装插件的卡片底部有两组按钮，**都是无状态的命令按钮，不是开关**：

| 按钮 | 发出 | 说明 |
|---|---|---|
| 【启用】/【停用】 | `set_plugin_enabled_unified { id, enabled }` | `get_custom_plugins` **不返回 `enabled`**，市场不知道当前态，所以不做 toggle、不显示开关色 |
| 【启动服务】/【停止服务】 | `start_plugin_service` / `stop_plugin_service { id }` | 仅在清单声明 `service` 且宿主 `can_manage_service` 时可用 |

三条口径：

* **不显示状态，只报告查到的**：服务状态来自 `get_plugin_service_status`，只读 `pid` 与 `detail`。没查过显示「状态未查询」，查询失败显示「无法查询：…」，**绝不把查不到说成「已停止」**。
* **能力缺失要看得见**：宿主没开放服务管理时按钮 `disabled`（不隐藏），且**一条服务类 IPC 都不发** —— 旧宿主上那条查询命令本身就会报错，硬发会把「没这个功能」误报成「查询失败」。
* **没有重启命令**：宿主的服务命令只有启动与停止两条，重启 = stop + start。

## 伴随服务

manifest 字段表里 `service` 紧跟在 `slot_height` 之后，子字段连排：

```
executable  args  elevated  auto_start  auto_stop  port  health_url  description
```

错误码枚举完整：

```
NO_SERVICE_CONFIGURED  PLUGIN_DIR_NOT_FOUND  BINARY_NOT_FOUND
SPAWN_FAILED  UAC_REJECTED  PERMISSION_DENIED  PATH_SECURITY_VIOLATION
```

> 第三方文档宣称有 `postMessage` 桥（`START_PLUGIN_SERVICE` / `OPENREVO_PLUGIN_SERVICE_STATUS`），但 exe 里这些字面量 **0 命中**。可能只存在于压缩的前端里，未证实。

## 兼容性徽章

目录条目的 `min_host_version` 与宿主版本在卡片上比对，结果用一个徽章表达：

* 两侧版本都能解析成三段数字 SemVer 时**才渲染**「需宿主 ≥ X」；
* 宿主版本低于要求时同一徽章转警戒色并追加「当前过低」；
* 任一侧解析失败（`>=0.9.3`、两段、`v` 前缀、预发布后缀）**不渲染徽章** —— 比不出来就不占位，不猜。

宿主版本取自 `get_plugin_host_capabilities` 的 `host_version`，与能力位同源。`min_host_version` 的形状由校验器 E14 强制（三段数字或 `null`），爬虫把范围表达式收敛成 `null`。

## 宿主不校验的清单字段

清单里 `permissions` 与 `telemetry` 两个字段，**宿主不读它们做拦截**。真正的能力边界仍由沙盒与 IPC 决定。

市场因此在披露区如实转述、并写明「清单自述，宿主不据此授权」。

## 刷新语义

插件页【刷新】= **重扫列表 + 热重载当前样式**，所以装新目录、改样式**都只需点一次【刷新】**，不必拨开关、不必重启。

## 判断一个命令到底存不存在

命令名可能被编译器拆开存放，直接搜完整字符串会漏。要按这三处交叉确认：

1. **命令注册表**：明文连排，短名整串可命中。
2. **分发比较键表**：长名会拆成「首 16 字节」与「末 16 字节」两个窗口。
3. **`movabs` 立即数链**：`.text` 里的立即数按 `xor` 偏移拼接。

```python
import pathlib
D = pathlib.Path(r'D:\Program Files\OpenRevo\open-revo.exe').read_bytes()

def present(cmd):
    if cmd.encode() in D:
        return 'exact'
    return 'absent'

for c in ['install_plugin_from_url', 'reload_plugins', 'get_plugin_host_capabilities',
          'get_plugin_service_status']:
    print(f'{c:32s} {present(c)}')
```

⚠️ 宿主会自我更新，**字节偏移会整体平移**。换过 exe 就要重新定位区间，不要沿用上一次的偏移常量。

`active_skin` / `active_background` 是已知的**不在命令表里**的两个：配置键存在，但只有 setter 没有 getter。市场因此不依赖它们。
