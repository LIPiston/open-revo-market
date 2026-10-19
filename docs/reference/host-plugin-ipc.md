# 新宿主插件 IPC 清单（9,437,696 B 那版实测）

本文记录**当前宿主**（`D:\Program Files\OpenRevo\open-revo.exe`，**9,437,696 B**，
sha256 `796b75e0ecc3adaa9a4846aea38de1f63a874224a7e7ebaf8a5577e3ac41c50d`，
mtime 2026-10-18 17:03）新增的插件相关 IPC。

> **取证方法**：直接扫 exe 的两张命令名表 —— 一张是 Rust 的命令注册表（明文连排），
> 另一张是 `invoke` 分发的比较键表。命令名有时被编译器拆成两段重叠窗口存放
> （如 `reload_p` + 偏移 6 的 `_plugins`），所以**「全串 0 命中」不等于「命令不存在」**。
> 判断步骤见本文末尾。

> **版本号陷阱**：这一版 exe 的 `ProductVersion` 仍然报 **0.9.1**，与上一版
> （9,368,576 B，sha256 `85ce81fb24746395…`）**完全一样**。
> 所以任何「按版本号判断能力」的逻辑都会出错 —— 必须**运行时探测**
> `get_plugin_host_capabilities`。

---

## 1. 市场与生命周期 IPC

参数名逐字取自 exe 命令注册表里的 serde 字段，**不是照抄第三方文档**。

| 命令 | 参数 | 返回 | 行为 |
|---|---|---|---|
| `get_plugin_host_capabilities` | — | `host_version` + `can_*` 能力位 | 见 §2 |
| `install_plugin_from_url` | `id`, `url`, `subpath?`, `sha256?` | 安装结果 | 下载 + 校验 + 解压 + 落盘 + 热重载 |
| `uninstall_plugin` | `id` ✅真机 | 布尔 | 停服务 → 清配置 → 移入**回收站** |
| `reload_plugins` | — | 插件列表 | 重扫插件目录 |
| `get_plugin_manifest` | `id` ⚠️未单独实测 | manifest 原文 | 读已装插件的清单 |
| `set_plugin_enabled_unified` | `id`, `enabled` ⚠️未实测 | 布尔 | skin/background/其它统一开关 |
| `open_external_url` | `url` | 布尔 | 系统浏览器打开（仅 http/https） |
| `write_clipboard` | `text` | 布尔 | 宿主代写剪贴板 |
| `start_plugin_service` | `id` ⚠️未实测 | 服务状态 | 拉起伴随服务 |
| `stop_plugin_service` | `id` ⚠️未实测 | 服务状态 | 停止伴随服务 |
| `get_plugin_service_status` | `id` ⚠️未实测 | 服务状态 | 查询运行状态 |

> ⚠️ **注意两族命令的字段名不一样。** 插件管理这族用 **`id`**（`install` / `uninstall`
> 都经真机 serde 报错确认过）；而 `load_plugin_html` / `load_plugin_theme_css` /
> `load_plugin_background_css` 用的是 **`pluginId`**（从 0.9.1 前端 JS 实测）。
> 别把两族的字段名互相套用 —— `pluginId` 在整个 exe 里只出现一次（紧跟
> `open_custom_widget`），那属于那条命令，不是插件管理族的。
> 服务类三条的字段名沿用同族约定但**没有单独实测**，已在表里标出。

> ⚠️ **`restart_plugin_service` 不存在。** 第三方文档里写了这一条，但 exe 里
> `restart_plugin` 全 0 命中，也不在分发比较链里。要重启只能 stop + start。

### 1.1 为什么 `id` 差点被漏掉（取证方法的一次翻车）

命令名后面紧跟的明文是 `install_plugin_from_url` + `subpath` + `sha256`，
`id` 与 `url` **不在这个窗口里** —— 它们被其它命令复用，已被编译器去重到别处。
只照着这个窗口抄，就会得出「参数是 `{ url, subpath?, sha256? }`」的错误结论，
真机上表现为：

```
invalid args `id` for command `install_plugin_from_url`:
command install_plugin_from_url missing required key id
```

**教训**：命令名附近的可打印串只能证明「这些字段属于这条命令」，
**不能证明「这条命令只有这些字段」**。必需字段要另找证据 ——
宿主的 serde 报错正是最硬的证据（`missing required key <名字>`）。
所以「0 命中 ≠ 不存在」这条要再加半句：**「命中了的也只是全部字段的一个子集」**。

### 1.2 同一族里「只出现一次的字段」属于谁

`pluginId` 在整个 exe 里**只出现一次**，位置是：

```
open_custom_widget | pluginId
```

它紧跟在 `open_custom_widget` 后面 —— 那是那条命令的字段。而
`load_plugin_html` / `load_plugin_theme_css` / `load_plugin_background_css`
的 `pluginId` 来自 0.9.1 前端 JS（实测调用点），属于另一族。

插件管理这族（install / uninstall / manifest）用的是 **`id`**，这一点由真机报错确认：

```
invalid args `id` for command `uninstall_plugin`:
command uninstall_plugin missing required key id
```

**这是同一个盲区踩的第三次**：第一次漏了 `id`（安装），第二次把仓库内路径当
`subpath`（安装），第三次把 `pluginId` 当卸载字段名。三次的共同点是
**拿「某个名字在某处出现过」当成「它属于这条命令」**。

> 判据升级：一个字段名要认定为某命令的参数，需要**该命令自己的**证据 ——
> serde 报错、前端调用点、或 README 里的示例。exe 里「邻近出现过」不算。

## 2. `HostCapabilities` 结构

exe 里的字段名连排（逐字）：

```
host_version  can_install  can_uninstall  can_reload  can_open_url
can_write_clipboard  can_read_manifest  can_manage_service
```

**注意**：这是 `${can_*}` 命名，不是第三方文档里写的 `version` / `capabilities: string[]`。
市场按前者实现；按后者写会拿到 `undefined`，能力判断全部失效。

## 3. 安装器的实际防线

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

解压用 `tar.exe -xf` 或 `Expand-Archive` 双路由；下载用 `curl -fsSL -o` 或
`Invoke-WebRequest`（含 TLS 1.2 强制）。

### 3.1 `subpath` 是**归档内**路径，不是仓库内路径（已实测）

真机装自己时报：

```
安装失败: manifest.json not found in resolved content directory:
"C:\Users\...\OpenRevo\plugins\.tmp_install_plugin-market\extracted\plugin-mar…
```

现场留下的目录说明了一切：

```
.tmp_install_plugin-market\
  package.zip
  extracted\
    open-revo-market-main\          ← codeload 固定包装层
      plugin-market\manifest.json   ← 插件真正在这里
```

宿主把 `subpath` **直接拼在 `extracted/` 后面**，**不会剥** codeload 的
`<repo>-<branch>/` 包装层。所以：

* 传仓库内路径 `plugin-market` → 去找 `extracted\plugin-market` → 不存在 → 报错；
* 必须传 `open-revo-market-main/plugin-market`（= 归档根 + 仓库内路径）；
* 插件就在仓库根时，`subpath` 至少要传归档根那一段（`<repo>-<branch>`）。

归档根名规则：`<repo 名>-<branch 名>`，分支里的 `/` 换成 `-`
（`feat/x` → `repo-feat-x`）。市场侧由 `archiveSubpath()` 统一构造，
`build_market.py` 断言参数对象的 `subpath` 必须走这个函数。

> 这条长期被写成「未实测」，代价是真机上一发即错。**未实测的假设不能只写在
> 「已知边界」里就算交代过了 —— 要么验，要么在代码里给出保守取值。**

## 4. 伴随服务（`service`）

manifest 字段表里 `service` 紧跟在 `slot_height` 之后，子字段连排：

```
executable  args  elevated  auto_start  auto_stop  port  health_url  description
```

`src\system\plugin_service.rs` 存在，错误码枚举完整：

```
NO_SERVICE_CONFIGURED  PLUGIN_DIR_NOT_FOUND  BINARY_NOT_FOUND
SPAWN_FAILED  UAC_REJECTED  PERMISSION_DENIED  PATH_SECURITY_VIOLATION
```

> 第三方文档宣称有 `postMessage` 桥（`START_PLUGIN_SERVICE` / `OPENREVO_PLUGIN_SERVICE_STATUS`），
> 但 exe 里这些字面量 **0 命中**。它们可能只存在于压缩的前端里，未证实。

## 5. 零 Base64 资产内联

exe 里能直接读到内联器的模板串：

```
<link  stylesheet  href  ./  <style data-inlined="…">…</style>
<script  src  module  </script> type="module"
<script … data-inlined="…">…</script>
<style  </style>
<img <audio <video <source   data:…;base64,   src="…"   src='…'
```

**未证实**：这些是给插件 HTML 用（第三方文档这么说），还是只给皮肤 CSS 用。
两者都合理，需要真机验收才能定论。

## 6. 判断一个命令到底存不存在

命令名可能被编译器拆开存放，直接 `bytes.count(b'cmd_name')` 会漏。可靠顺序：

1. **命令注册表**：约 7.499M–7.506M，明文连排。短名整串可命中。
2. **分发比较键表**：约 7.398M–7.412M。长名会拆成「首 16 字节」与「末 16 字节」两个窗口。
3. **`movabs` 立即数链**：`.text` 里两条 `48 b9` / `48 ba` 立即数按 `xor` 偏移拼接。

```python
import pathlib
D = pathlib.Path(r'D:\Program Files\OpenRevo\open-revo.exe').read_bytes()

def present(cmd):
    if cmd.encode() in D:
        return 'exact'
    t = D[7_398_000:7_412_000]
    if len(cmd) <= 16:
        return 'short-miss'
    return 'windowed' if (cmd[:16].encode() in t and cmd[-16:].encode() in t) else 'absent'

for c in ['install_plugin_from_url', 'reload_plugins', 'restart_plugin_service',
          'get_plugin_host_capabilities', 'get_active_skin']:
    print(f'{c:32s} {present(c)}')
```

`get_active_skin` / `get_active_background` 是已知的**不在命令表里**的两个：
配置键存在（`active_skin` / `active_background`），但只有 setter 没有 getter。
市场因此不依赖它们。
