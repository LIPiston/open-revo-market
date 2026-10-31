# 插件市场对齐官方插件规范 · 设计

日期：2026-10-30
状态：待批准

## 1. 意图与背景

用户要求「依照两份官方资料与两个示例插件，更新现在的插件市场」。

两份资料是 `D:\LIPis\Documents\code\open-revo\docs\OpenRevo_第三方插件开发手册.md`
（下称「手册」）与 `...\docs\openrevo_skills\openrevo-plugin-dev\SKILL.md`（下称「Skill」）。
示例是 `...\plugins_sample\eva01-core`（widget）与 `battery-hardware-limit`（slot）。

它们相对仓库现状有三个落差：

1. **形态变全了**：手册列 8 种形态（新增 `service` / `shell` / `driver`），
   仓库文档与市场筛选只承认 5 种。
2. **清单字段变多了**：`target_slot` / `slot_height` / `service` / `shortcuts` /
   `watchers` / `permissions` / `min_host_version` / `theme_css` / `background_css` /
   `image` / `window` / `telemetry` —— 市场一个都不披露，作者也无法在目录里表达。
3. **生命周期命令到位了**：`set_plugin_enabled_unified` 与伴随服务的
   `start/stop/get_plugin_service_status` 在宿主里存在，市场没接。

### 1.1 已取证的事实（本机 `open-revo.exe` 0.9.5，13385216 字节）

| 事实 | 结论 |
|---|---|
| 命令 `install_plugin_from_url` / `uninstall_plugin` / `get_plugin_manifest` / `set_plugin_enabled_unified` / `reload_plugins` / `start_plugin_service` / `stop_plugin_service` / `get_plugin_service_status` | 全部 exact 命中 |
| `restart_plugin_service` | **不存在**（0 命中）；重启只能 stop + start |
| `HostCapabilities` 真实字段 | `host_version` + `can_install` / `can_uninstall` / `can_reload` / `can_open_url` / `can_write_clipboard` / `can_read_manifest` / `can_manage_service` |
| 手册写的 `{ version, tauri_version, capabilities: string[] }` | 与宿主不符，**不采信** |
| `CustomPluginItem` 字段 | `plugin_type dir_name entry target_slot slot_height service shortcuts watchers permissions min_host_version is_compatible compatibility_notice` + `theme_css background_css background_image wallpaper rules min_version openrevo_version` |
| `CustomPluginItem` 里的 `enabled` | **不存在**。`get_custom_plugins` 拿不到启停状态 |
| `PluginServiceConfig` 字段 | `executable elevated auto_start auto_stop health_url`（**无 `port`、无 `description`**） |
| `PluginServiceStatus` 字段 | 只见 `pid` 与 `detail`。`running` / `healthy` / `last_error` / `uptime_secs` 未逐字确认 |
| `PluginTelemetryConfig` 字段 | `desired_interval_ms sensors desiredIntervalMs`（**无 `enabled`**） |
| `permissions` 串（如 `telemetry:read`） | 宿主 0 命中 → 只是清单自述，**不被校验、不构成授权** |
| `plugin_type` 的取值枚举 | **无法从 exe 证实**。裸子串计数（`tab` 226、`driver` 91…）被无关字符串污染，不能作为「支持这些值」的证据 |
| `__OPENREVO_BRIDGE__` / `data-theme` / `data-skin` | exe 里 0 命中（可能在压缩前端资产里）→ 主题镜像与父窗口桥保持现状的「双路径 + 失败降级」，本轮不改其判据 |

## 2. 目标

- **G1** 市场承认并筛选全部 8 种形态，形态徽标有独立配色；`mono` 主题下仍整体去饱和。
  形态取值以官方手册为准，市场只做**透传与展示**，不声称宿主已实机验证每种形态的运行行为。
- **G2** 目录携带形态专属清单字段，卡片按形态披露；缺失即不展示，不编造。
- **G3** 兼容性可见：目录条目声明 `min_host_version` 时，市场用探测到的 `host_version` 比对并给出徽章；
  比不出来（宿主没给版本、或版本串非法）就不显示徽章。
- **G4** 已安装插件可原地启停；声明了 `service` 且宿主 `can_manage_service` 时给启停按钮与状态。
- **G5** 两个示例插件进仓库、进目录，能被市场一键装。
- **G6** 文档与验收闸同步到同一套事实；验收闸覆盖新增的筛选、披露、生命周期路径。

## 3. 非目标

- **N1** 不做静态能力扫描。`capabilities` 维持三态语义（`null` = 未扫描），爬虫仍写 `null`。
- **N2** 不接 `raw_ec_*`（底层 EC 读写）与 `register_custom_watcher` / `register_custom_shortcut`。
  前者是高危物理写，市场不提供入口；后者属于插件自身运行期行为，不是市场职责。
- **N3** 不改宿主的主题镜像判据（`data-theme` 读取逻辑保持原样）。
- **N4** 不引入构建期依赖（保持纯 Python 标准库）；不改单文件产物形态。

## 4. 反目标

- 把 `permissions` 当成「已授权」或「已校验」来展示 —— 宿主不看它。
- 把 `telemetry.enabled === false` 说成「不订阅遥测」—— 该字段同样不被宿主校验，
  只能写「清单声明不启用遥测」。
- 在没有状态来源的情况下显示「已启用 / 已停用」态 —— `get_custom_plugins` 不返回 `enabled`。
- 用 `min_host_version` 缺失来暗示兼容，或用猜测的版本号拼出「兼容」结论。
- 声称 8 种 `plugin_type` 取值「已被宿主验证」—— 只能声称「手册如此规定，市场接受并透传」。
- 为凑齐「一键装」而给 `service` 插件做特权提权 —— 市场只发宿主已有的 IPC。
- 把 `restart_plugin_service` 写进代码或文档。

## 5. 约束

- 产物必须单文件（`srcDoc` 注入，外部引用必 404）；`build_market.py` 的自检断言必须继续通过。
- 目录校验 E1–E12 不得放松；新增字段只能加严。
- 安装参数链不变：`install_plugin_from_url { id, url, subpath, sha256? }`，
  `subpath` 必须是**归档内**路径（`archiveSubpath()`）。
- 加速下载仍是默认关闭的可选项。
- 所有权口径不变：`author` 必须等于 `repo` 的 owner；`id` 唯一且是目录名。
- **第三方作者的清单不得让本仓库的验收闸变红**：远端数据的不合规取值由爬虫收敛，校验器只管本仓库产物。
- 仓库不留旧痕迹：被替换的「五种形态」「未证实」表述直接改写，不保留版本沿革。

## 6. 怎么改（已由对话与取证决定的部分）

### 6.1 目录 schema 扩展（`market/crawl_topic.py`）

`build_entry()` 与 `local_entries()` 从 manifest 抽取以下字段写入条目。
**缺失一律写 `null`（或省略），绝不补默认值。**

| 字段 | 形状 | 来源 |
|---|---|---|
| `entry` | `string \| null` | `manifest.entry` |
| `target_slot` | `string \| null` | `manifest.target_slot` / `manifest.slot` |
| `slot_height` | `string \| null` | `manifest.slot_height` / `manifest.slotHeight` |
| `min_host_version` | `string \| null` | `min_host_version` / `min_version` / `openrevo_version` |
| `permissions` | `string[] \| null` | `manifest.permissions`（`null` = 未声明，`[]` = 声明为空） |
| `service` | `object \| null` | `{executable, elevated, auto_start, auto_stop, health_url, port?}` |
| `shortcuts` | `[{id, name, combo}] \| null` | `manifest.shortcuts` |
| `watchers` | `[{id, name, when}] \| null` | `manifest.watchers` / `manifest.rules`，`when` 只取条件 `type` |
| `window` | `{width, height, transparent, always_on_top, resizable, decorations, skip_taskbar} \| null` | `manifest.window` |
| `telemetry` | `{enabled, sensors}` | `manifest.telemetry`，`enabled` 按声明原样记（宿主不校验） |
| `theme_css` / `background_css` / `image` | `string \| null` | 同名 manifest 字段（`image` 兼容 `wallpaper`） |

`service.port` 与 `service.description`：宿主 `PluginServiceConfig` 里没有这两个字段，
但手册允许作者声明。目录**按声明透传**（有就记，没有就 `null`），UI 标注为「清单声明」，
不作为宿主行为承诺。

`args` 一律不写入目录 —— 可能含路径或口令，且宿主结构里未见该字段。

**合规收敛（回答「远端脏数据会不会让闸变红」）**：爬虫把**形状不合法**的可选字段收敛为 `null`，
而不是照抄，也不是瞎改。规则：

- `min_host_version` 不匹配 `^\d+\.\d+\.\d+$` → `null`
- `permissions` 非字符串数组 → `null`；数组里非字符串元素丢弃
- `shortcuts` / `watchers` 非数组 → `null`；元素缺 `id` 或非对象 → 丢弃该元素；数组空则 `null`
- `service` 非对象、或缺非空 `executable` → `null`
- `target_slot` / `slot_height` / `entry` / `theme_css` / `background_css` / `image` 非字符串或空串 → `null`

这是「丢弃无法理解的声明」，不是编造值，与「缺失即不展示」同一口径。

`merge()` 的人工字段保留列表相应扩展：`min_host_version` / `target_slot` / `permissions` /
`service` / `shortcuts` / `watchers` 在爬虫抓不到时沿用旧值。

### 6.2 目录校验（`market/validate_catalog.py`）

新增：

- **E13 形态专属字段形状**：`target_slot` / `slot_height` / `entry` / `theme_css` /
  `background_css` / `image` / `min_host_version` 必须是非空字符串或 `null`；
  `permissions` 必须是字符串数组或 `null`；`service` 必须是对象或 `null` 且 `executable` 为非空字符串，
  `port` 若存在必须是正整数；`shortcuts` / `watchers` 必须是数组或 `null`，元素必须含 `id`。
- **E14 `min_host_version` 形状**：匹配 `^\d+\.\d+\.\d+$` 或 `null`。
- **E15 slot 必须声明 `target_slot`**：`plugin_type == "slot"` 且 `target_slot` 缺失即报错。

E1–E12 不动。E13–E15 只校验本仓库的 `catalog.json`；远端脏数据已在 6.1 收敛。

### 6.3 市场 UI（`market/src/market.js` + `market.css`）

1. **形态筛选**：筛选栏加入 `service` / `shell` / `driver`（沿用「计数 > 0 才显示」的既有规则）。
   徽标补 `.mkt-badge.type-service` / `.type-shell` / `.type-driver` 三套配色，并在 `mono` 去饱和列表里补齐。
2. **形态披露**（卡片与安装弹窗共用）：新增 `manifestDisclosure(entry)`，按形态只展示相关项——
   - 全部：`permissions`（措辞「清单声明」+ 注明宿主不据此授权）、`shortcuts` 数量与组合键、
     `watchers` 数量与触发类型；
   - `slot`：`target_slot` + `slot_height`；
   - `skin`：`theme_css`；`background`：`background_css` 或 `image`（标「零代码壁纸」）；
   - `widget` / `tab` / `shell`：`entry` + 窗口几何（宽高、透明、置顶、跳过任务栏、原生标题栏）；
   - 有 `service`：可执行文件名、是否提权、`health_url`、`port`（若声明）、自动启停策略；
   - `telemetry`：声明 `enabled === false` 时写「清单声明不启用遥测」，否则列 `sensors`。
3. **兼容性徽章**：`min_host_version` 存在且 `state.caps.host_version` 可解析时做三段 SemVer 比较；
   满足显示 `需宿主 ≥ X`（中性色），不满足显示 `需宿主 ≥ X · 当前过低`（告警色）。
   任一侧解析失败 → **不渲染徽章**。
4. **生命周期（无状态设计）**：`get_custom_plugins` 不返回 `enabled`，所以市场**不显示任何启停状态**，
   只提供两个幂等动作按钮：【启用】【停用】。
   - 调 `set_plugin_enabled_unified { id, enabled }`；
     失败且错误含 `missing required key|invalid args` 时回退 `set_custom_plugin_enabled { pluginId, enabled }`
     （exe 里另一条命令，字段名是 `pluginId`）。
   - 成功后 `reload_plugins` + `refreshInstalled`，toast 只说「已发送启用/停用」，不断言当前态。
   - 磁盘口径的启停（`active_skin` / `active_background`）由宿主自行处理，市场不另做分支。
5. **伴随服务**：条目有 `service` 且 `can_manage_service` 时给【启动服务】【停止服务】按钮与一段状态文字。
   `get_plugin_service_status` **防御式读取**：只有 `pid` 与 `detail` 被确认；
   显示规则为 `pid` 存在且非空 → 「运行中 (PID n)」，否则「已停止」；`detail` 有字符串就附带显示。
   其余字段不读、不显示。重启 = stop + start，**不调用 `restart_plugin_service`**。
   状态**不轮询**，只在打开弹窗与点按钮后各查一次。
6. **`normalizeCatalog`**：透传新字段（缺失 → `null`），非法形状丢弃为 `null`。

### 6.4 示例插件进仓库

放仓库根（与 `plugin-market/` 同级），这样 `crawl_topic.local_entries()` 的一层扫描直接收录：

- `eva01-core/`：`manifest.json` 规范化为 `plugin_type` + `always_on_top`，
  补 `entry` / `permissions` / `min_host_version`；**补 `index.html`**（原样本没有入口文件，
  装上就是空白挂件）：透明机体、结温呼吸、风扇联动、`pointerdown` 拖拽、一键强冷。
- `battery-hardware-limit/`：`manifest.json` 规范化为 `plugin_type`，补 `permissions` / `min_host_version`；
  `index.html` 保持既有实现（`get_power_settings` / `set_battery_hardware_limit` 均已确认存在于宿主）。

两者由市场按 `repo = LIPiston/open-revo-market`、`subpath = <目录名>` 安装。

**目录如何更新（回答「没有网络/token 时怎么办」）**：给 `crawl_topic.py` 加 `--local-only`：
跳过网络，从现有 `catalog.json` 出发，只重建本仓库的 `local_entries()` 并合并（远端条目原样保留）。
实现时用 `python market/crawl_topic.py --local-only --merge` 生成，**不手写目录条目** ——
手写会与下一次 CI 全量刷新产生无意义 diff。

### 6.5 文档与验收闸

- `README.md`：形态口径、字段披露、生命周期能力各一句，细节指向 docs。
- `docs/market.md`：新增「形态与清单披露」「生命周期操作」「兼容性」三节；删除「五种形态」旧表述。
- `docs/host-and-plugins.md`：形态表补 `service` / `shell` / `driver`，并写明取值来自官方手册、
  市场只透传；写明 `permissions` / `telemetry.enabled` 不被宿主校验；
  写明 `get_custom_plugins` 不返回 `enabled`；写明 `restart_plugin_service` 不存在。
- `docs/reference/host-plugin-ipc.md`：补 `set_plugin_enabled_unified` 与 `set_custom_plugin_enabled` 的
  字段名差异与回退链、服务三条命令、`PluginServiceConfig` / `PluginServiceStatus` 的实际字段边界。
- `docs/project-status.md`：把「`widget` / `slot` 未实测」「`service`/`shell`/`driver` 无字面量」
  改写成当前可支撑的表述：字段与命令已逐字确认在 exe 内，**形态取值的运行行为未做端到端实测**。
- `market/PLUGIN_README.md`：作者须知补新字段与形态。
- `_tools/market-verify.sh` + `market-preview.html`：
  - mock 增加 `set_plugin_enabled_unified` / `set_custom_plugin_enabled` / 服务三命令；
  - 断言新增筛选按钮存在、`slot` 条目显示 `target_slot`、`min_host_version` 徽章按版本正确、
    启用按钮真的发 IPC 且字段名为 `id`、服务按钮在 `can_manage_service=false` 时禁用；
  - 「当前过低」与「服务按钮降级」两条分支用**闸内合成目录**驱动（沿用已有的
    `_shots/_big-catalog.json` 模式），合成条目只存在于 `_shots/`，不进 `market/catalog.json`。
- 版本号 `1.1.0` → `1.2.0`（`build_market.py` 的 `MANIFEST` 与 `plugin-market/manifest.json`）。

## 7. 留给实现者的判断

- 披露块在卡片上的折叠策略（默认显示几行、是否收进「详情」）——以「不撑爆卡片、不隐藏关键项」为准。
- SemVer 比较的实现位置（内联在 `market.js` 的 `cmpSemver()`）。
- 示例插件的视觉细节（配色、动效强度），只要符合 Design Tokens 与 `mono` 去饱和即可。

## 8. 验收标准

1. `python build_market.py --check` 通过。
2. `python market/validate_catalog.py market/catalog.json` 通过，且目录含 4 条
   （`plugin-market` / `eva01-core` / `battery-hardware-limit` / 外部 `openrevo-plugin-power`）。
3. `bash _tools/market-verify.sh cyber` 与 `... mono` 全 PASS，0 JS 错误。
4. 验收闸新增断言全部为真（筛选、披露、兼容徽章两分支、启用 IPC、服务按钮两分支）。
5. 仓库内不再出现这些与取证矛盾或无法支撑的表述：
   「五种形态」、「`service` / `shell` / `driver` 在前端里没有字面量」、
   「`restart_plugin_service`」、以及任何「8 种取值已被宿主验证」的说法。

## 9. 本次对话用到的产物

| 类型 | 路径 | 决定了什么 |
|---|---|---|
| 规格文档 | `D:\LIPis\Documents\code\open-revo\docs\OpenRevo_第三方插件开发手册.md` | 8 种形态、清单字段表、`service`/`shortcuts`/`watchers` 语义、Design Tokens |
| 规格文档 | `...\docs\openrevo_skills\openrevo-plugin-dev\SKILL.md` | 同一套规范的 Agent 版，补充「禁止隐藏挂件轮询」等军规 |
| 示例插件 | `...\plugins_sample\eva01-core` | widget 清单写法与窗口几何 |
| 示例插件 | `...\plugins_sample\battery-hardware-limit` | slot 清单写法（`target_slot` / `slot_height`）与 `get_power_settings` 调用 |
| 宿主二进制 | `D:\Program Files\OpenRevo\open-revo.exe`（0.9.5，13385216 字节） | §1.1 全部「已确认 / 不存在 / 无法证实」结论 |
