# 宿主插件 IPC

`D:\Program Files\OpenRevo\open-revo.exe` 里与插件相关的命令。参数名取自 exe 命令注册表里的
serde 字段，**不是照抄第三方文档**。

> 前置结论：**不要用 `ProductVersion` 判断能力。** 有安装 IPC 与没有安装 IPC 的版本
> 可能报同一个版本号。唯一可靠判据是运行时调 `get_plugin_host_capabilities`。

## 1. 市场与生命周期 IPC

| 命令 | 参数 | 返回 | 行为 |
|---|---|---|---|
| `get_plugin_host_capabilities` | — | `host_version` + `can_*` 能力位 | 见 §2 |
| `install_plugin_from_url` | `id`, `url`, `subpath?`, `sha256?` | 安装结果 | 下载 + 校验 + 解压 + 落盘 + 热重载 |
| `uninstall_plugin` | `id` | 布尔 | 停服务 → 清配置 → 移入**回收站** |
| `reload_plugins` | — | 插件列表 | 重扫插件目录 |
| `get_plugin_manifest` | `id` | manifest 原文 | 读已装插件的清单 |
| `set_plugin_enabled_unified` | `id`, `enabled` | 布尔 | skin / background / 其它统一开关 |
| `open_external_url` | `url` | 布尔 | 系统浏览器打开（仅 http/https） |
| `write_clipboard` | `text` | 布尔 | 宿主代写剪贴板 |
| `start_plugin_service` | `id` | 服务状态 | 拉起伴随服务 |
| `stop_plugin_service` | `id` | 服务状态 | 停止伴随服务 |
| `get_plugin_service_status` | `id` | 服务状态 | 查询运行状态 |

> ⚠️ **两族命令的字段名不一样。** 插件管理这族用 **`id`**
> （`install_plugin_from_url` / `uninstall_plugin` / `get_plugin_manifest`）；
> 而 `load_plugin_html` / `load_plugin_theme_css` / `load_plugin_background_css`
> 用的是 **`pluginId`**。两族不能互相套用 —— 传错会以 `missing required key` 被拒收。

> ⚠️ **没有「重启服务」这一条命令。** exe 里 `restart_plugin` 全 0 命中，
> 也不在分发比较链里。要重启只能 stop + start。

> `install_plugin_from_url` 的必需字段是 **`{ id, url }`**，`subpath` / `sha256` 可选。
> 只看到命令名紧跟的 `subpath` / `sha256` 会误以为参数只有三个 ——
> `id` / `url` 被其它命令复用，已被编译器去重到别处。必需字段要以
> 宿主 serde 报错（`missing required key <名字>`）为准。

## 2. `HostCapabilities` 结构

exe 里的字段名连排（逐字）：

```
host_version  can_install  can_uninstall  can_reload  can_open_url
can_write_clipboard  can_read_manifest  can_manage_service
```

**注意**：这是 `${can_*}` 命名，不是第三方文档里写的 `version` / `capabilities: string[]`。
按后者写会拿到 `undefined`，能力判断全部失效。

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

> **下载地址的域名限制**：从错误串只能确认「必须 HTTPS」，没有看到域名白名单。
> 但宿主是否接受 GitHub 之外的下载域名**未实测** —— 所以市场把「走加速镜像」做成
> 默认关闭的显式开关，而不是默认路径（见 [`../host-and-plugins.md`](../host-and-plugins.md) §6）。

## 4. `subpath` 是**归档内**路径，不是仓库内路径

传给宿主的 `subpath` 会直接拼在 `extracted/` 后面去找 `manifest.json`，
宿主**不会剥掉** codeload 归档的包装层：

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

归档根名规则：`<repo 名>-<branch 名>`，分支里的 `/` 换成 `-`
（`feat/x` → `repo-feat-x`）。市场侧由 `archiveSubpath()` 统一构造，
`build_market.py` 断言参数对象的 `subpath` 必须走这个函数。

## 5. 伴随服务（`service`）

manifest 字段表里 `service` 紧跟在 `slot_height` 之后，子字段连排：

```
executable  args  elevated  auto_start  auto_stop  port  health_url  description
```

错误码枚举完整：

```
NO_SERVICE_CONFIGURED  PLUGIN_DIR_NOT_FOUND  BINARY_NOT_FOUND
SPAWN_FAILED  UAC_REJECTED  PERMISSION_DENIED  PATH_SECURITY_VIOLATION
```

> 第三方文档宣称有 `postMessage` 桥（`START_PLUGIN_SERVICE` / `OPENREVO_PLUGIN_SERVICE_STATUS`），
> 但 exe 里这些字面量 **0 命中**。可能只存在于压缩的前端里，未证实。

## 6. 判断一个命令到底存不存在

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

⚠️ 宿主会自我更新，**字节偏移会整体平移**。换过 exe 就要重新定位区间，
不要沿用上一次的偏移常量。

`active_skin` / `active_background` 是已知的**不在命令表里**的两个：
配置键存在，但只有 setter 没有 getter。市场因此不依赖它们。
