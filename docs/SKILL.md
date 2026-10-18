---
name: openrevo-plugin-market
description: 为 OpenRevo（open-revo.exe）开发、修改、验证第三方插件与插件市场。当任务涉及 OpenRevo 的 tab/面板插件、manifest.json、plugin_type 形态、宿主 IPC（安装/卸载/能力位）、从 exe 抽宿主真值、等价宿主预览与验收闸、插件市场目录/catalog/爬虫/一手安装链路时，使用本技能。
---

# OpenRevo 插件开发技能（插件市场）

本技能沉淀自多轮实战。**当前仓库只维护插件市场一条链**：`plugin-market`（`tab` 形态）——
浏览、能力披露、一键安装/卸载。皮肤与背景插件已于 2026-10-18 整体移除（见 §4）。

## 0. 位置与当前状态

| 项 | 值 |
|---|---|
| 权威树（只维护这一棵） | 仓库 `LIPiston/open-revo-market`（2026-10-17 由 `openrevo-plugins` 更名）；本机克隆目录名可能仍是旧的 `…\openrevo-plugins\` |
| 宿主 exe（**唯一真值来源**） | `D:\Program Files\OpenRevo\open-revo.exe` |
| 宿主 | **9,437,696 B** 那版（`ProductVersion` 仍报 0.9.1），有安装/卸载 IPC |
| 插件安装位 | `%APPDATA%\OpenRevo\plugins\<plugin_id>\` |
| 宿主配置 | `%APPDATA%\OpenRevo\config.json` |
| 当前已装插件 | **只有 `plugin-market`** |
| 已失效镜像 | `…\deepseek-harness\default-workspace\openrevo-win-skin\`（2026-10-04 改名前的快照，**已作废**，不要审计/同步） |

> ⚠️ **版本号不能用来判断能力。** 两代宿主的 `ProductVersion` **都报 0.9.1**，
> 但有安装 IPC 的那版体积是 9,437,696 B、没有的那版是 9,368,576 B。
> 写任何断言前先比 **exe 体积 + mtime**，并用**资产文件名里的内容哈希**（`index-<hash>.js`）
> 判断前端有没有变：**文件名里的哈希就是内容哈希**，文件名没变才能复用 `_extracted/v091/` 里的抽取物。

## 1. 插件生态：五种形态（0.9.1 实测枚举）

前端 JS 里实际出现的 `plugin_type` 字面量（`grep 'plugin_type==="…"'` 计数）：

| 字面量 | 次数 | 说明 | 注入点 |
|---|---|---|---|
| `skin` | 4 | 主窗皮肤 | `<style id="openrevo-theme-skin">`（读旧 id `openrevo-custom-skin` 会就地改名） |
| `background` | 4 | 背景壁纸 | `<style id="openrevo-custom-background">` |
| `tab` | 2 | **面板插槽**（市场就是它），主体是沙盒 iframe | 顶栏胶囊 → 插件页签 |
| `widget` | 2 | 桌面挂件，独立 WebView2 窗口 | 独立窗口 |
| `slot` | 2 | **微插槽**，按 `target_slot` 填进宿主既有页面的占位 | `slot_height` 缺省 `54px` |

* `service` / `shell` / `driver` **在 0.9.1 前端里仍无字面量** —— 只在官方手册矩阵里出现，
  是否真存在**未证实**，不要依据手册对外承诺。
* manifest 字段表（exe @7401431，Rust 侧字段名表）：`… telemetry entry target_slot slot_height theme_css background_css …`。
  `target_slot` / `slot_height` / `dir_name` 是 0.9.1 新增。**`permissions` 字段不存在**（exe / JS 全 0 命中）。
* 一个 `slot` 插件生效需三条件同时成立：类型是 `slot`、`target_slot` 命中宿主某个具名槽、且 `enabled`。
  已知槽名：`power.hardware_limit`。

### 1.1 三种 iframe 的 sandbox 各不相同

| 形态 | sandbox | 后果 |
|---|---|---|
| `tab` | `allow-scripts allow-forms allow-same-origin` | **无 `allow-downloads` / `allow-popups` / `allow-modals`** |
| `widget` | 上者 + `allow-modals` | 多模态对话框 |
| `slot` | **无 sandbox** | 与宿主同源无隔离 |

> `tab` 同时给 `allow-same-origin` + `allow-scripts` ⇒ **沙盒形同虚设**：iframe 与宿主同源，
> 既能读 `window.parent.document`，也能拿 `window.parent.__TAURI_INTERNALS__.invoke`。
> **绝不**把「跑在 iframe 里」当安全边界，也不要在 UI 上写「安全隔离」。

### 1.2 插件命令：**分两代宿主，能力差别很大**

两代 exe 的 `ProductVersion` **都是 0.9.1**，版本号字符串无法区分。只能看体积 + 运行时探测：

| | 老宿主 | 新宿主 |
|---|---|---|
| 体积 / sha256 | 9,368,576 B · `85ce81fb…` | 9,437,696 B · `796b75e0…` |
| 插件命令 | 下面这 13 条 | 13 条 + 整族安装/生命周期 IPC |
| 判定方式 | `get_plugin_host_capabilities` **调用即抛错** | 该命令返回 `host_version` + `can_*` |

老宿主（基线，`market-host-constraints.md` 记录的就是它）**只有**这 13 条：

```
get_custom_plugins          load_plugin_html            load_plugin_theme_css
load_plugin_background_css  set_custom_plugin_enabled   open_plugins_dir
open_custom_widget          close_custom_widget         widget_ready
set_active_skin             get_active_skin             set_active_background
get_active_background
```

新宿主在这之外新增（逐字取自 exe 命令注册表，详见 `reference/host-plugin-ipc.md`）：

```
install_plugin_from_url { id, url, subpath?, sha256? }   uninstall_plugin { pluginId }
reload_plugins { }                                   get_plugin_manifest { pluginId }
set_plugin_enabled_unified { pluginId, enabled }     get_plugin_host_capabilities { }
open_external_url { url }                            write_clipboard { text }
start_plugin_service / stop_plugin_service / get_plugin_service_status { pluginId }
```

**插件代码绝不能按版本号分支** —— 两代报同一个版本号。正确做法是探测
`get_plugin_host_capabilities`，命令不存在就降级（市场就是这么做的）。
`restart_plugin_service` **不存在**（0 命中），重启只能 stop + start。

---

## 2. 硬约束（踩过学费的）

1. **宿主是唯一真值**：手册示例类名（`.overview-main-grid` / `.sensor-gauge-cluster` / `.cooling-fan-card` /
   `.power-mode-selector`）在发行版里**不存在**；手册的 `--core-*` 令牌也不存在。以 `_extracted/v091/` 的真实选择器为准。
2. **产物必须单文件**：宿主用 **`srcDoc`** 把 `tab` 插件 HTML 注入 iframe，基准 URL 是**宿主文档**
   （`tauri://localhost`）→ 任何 `<link rel=stylesheet>` / `<script src>` / `<img src="assets/…">` /
   `@import` **都 404**。市场产物因此是单文件（CSS/JS 全内联），构建期断言零外部引用。
3. **压过宿主 React 内联 `style={{…}}` 只能靠 author `!important`**
   （`.acrylic-container` 的 `display:flex`、迷你根的 `background:rgba(12,15,22,.96)` 等）。
4. **宿主认新插件目录的时机**：插件页【刷新】**重扫列表 + 热重载当前样式**，
   所以装新目录只需点一次【刷新】，不必拨开关、不必重启。
5. **本机模型不支持图片输入**（`read_image` 报 `does not declare image input`）：一切观感判读只能靠
   直方图 / 列行亮度签名 / 分块 MAE / ASCII 渲染（`census.py` / `cmp.py` / `prof.py` / `ascii.py`）。
6. **抓真机图必须先置顶**：`WindowFromPoint` 会**跳过** Tauri 的透明/分层窗口，不能当 z 序证据；
   抓图脚本必须提权（`SetWindowPos` 也被 UIPI 拦）。抓完记得还原。
7. **改完要能回到用户原状**：动过 `config.json` 必须备份（`config.json.bak-*`）并还原。
   ⚠️ 宿主运行中持有权威内存态，**会整份回写 config** —— 但该回写**由用户操作触发**，
   静置不会自己变（实测静置 30 s 字节不变）。保险起见：停机改，或改完立即回读复验。
8. **`.ps1` 必须 UTF-8 BOM**（含中文时），且写文件的工具会**静默吃掉 BOM** →
   改完 `head -c3 x.ps1 | od -An -tx1` 应为 `ef bb bf`，再跑 `[Parser]::ParseFile` 复核 0 error。

---

## 3. 插件市场（本仓库唯一主交付物）

| 目录 / 文件 | 作用 |
|---|---|
| `market/src/{market.js,market.css,index.template.html}` | 源码（**只改这里**） |
| `build_market.py` | 把三者内联成**单文件** `plugin-market/index.html` + 静态体检；`--check` / `--install` |
| `market/catalog.json` | 策展目录（构建时内联为离线兜底 SEED） |
| `market/crawl_topic.py` | 爬 GitHub `topic:openrevo-plugin` → catalog（`CURATED` 集合标「已审核」） |
| `market/validate_catalog.py` | 目录结构校验 E1–E11 |
| `.github/workflows/refresh-catalog.yml` | 每小时自动爬，有变更才提交 |
| `plugin-market/` | 构建产物（已入库，clone 后可 `--install` 即用） |
| `_tools/market-{preview.html,verify.sh,shots.sh}` | 等价宿主环境预览 + 验收闸 + 出图 |

```bash
python build_market.py             # 构建 + 产物自检
python build_market.py --install   # 构建并安装到 %APPDATA%\OpenRevo\plugins\plugin-market
bash _tools/market-verify.sh cyber # 验收闸（必跑；另跑 mono 主题）
python market/validate_catalog.py market/catalog.json
```

**市场的核心设计取舍（都由宿主约束推导而来）**：

* **身份 = `owner/repo[/subpath]`**，绝不用展示名当键（展示名会撞车）。`id` 只作为插件目录名。
* **能力披露是三态**：`[...]` = 扫过并检出；`[]` = 扫过未检出；`null` = **没扫过**。
  爬虫一律写 `null`，UI 渲染成「未扫描」。**绝不能写 `[]`** —— 那等于撒谎说「检查过，很干净」。
* **`stars: null` = 取不到**，排序放最后，绝不当作 `0`（「比 0 还不受欢迎」）。
* **失败不伪装**：在线目录拉不到时保留兜底数据，meta 行**如实**写
  `内置目录 · N 条（未连上在线目录：HTTP 404）`。爬虫失败时**不写文件**，让上次产物继续服务。
* **安装按能力探测降级，不按版本号猜**：市场启动时调 `get_plugin_host_capabilities`，
  按 `can_install` / `can_uninstall` / `can_reload` / `can_read_manifest` 决定 UI。
  两代宿主的版本号字符串相同，但一代有安装 IPC、一代没有 —— 只能靠探测。
  能力为假时退回**可复制的 PowerShell `git clone` 命令**，并在弹窗里明说是降级路径。
  市场本身**不下载、不写盘**（无 `allow-downloads`），所有危险动作都在宿主的安装器里。
* **沙盒里没有 `allow-modals`**：`window.confirm` / `alert` 会被静默拦掉并返回 `false`。
  任何「点了确认才继续」的流程都必须用页面内弹窗，**不能用原生确认框** —— 否则就是点了没反应。
* **主题靠镜像**：iframe 是独立文档，宿主 `:root` 令牌**不继承** → 内联一份同名同值令牌，
  并用 `MutationObserver` 监听父文档 `data-theme`（cyber / mono / light）实时镜像。
* **剪贴板三层降级**：宿主 `write_clipboard`（若可用）→ `navigator.clipboard` → `document.execCommand('copy')`。
  每层都可能单独失效，三层都不是冗余。

### 3.1 验收闸 `market-verify.sh` 的判据

`_tools/market-verify.sh [theme] [host]` 在**等价宿主环境**（`_tools/market-preview.html` 复刻
`srcDoc` + sandbox + 父窗口桥）里跑预览页，默认**两代宿主都跑**，退出码 0 = PASS。它断言：

* `ready` 为真，**卡片数精确等于本地 `market/catalog.json` 的条数**（不是「> 0」——
  否则「目录整个拉丢了」和「目录真的只有 1 条」看起来一样）；
* **JS 错误为 0**；
* `host=new`：点【安装】→ 弹窗 → 点【立即安装】→ 真发 `install_plugin_from_url` 并重扫，
  且 `usedNativeConfirm === false`；
* `host=old`：弹窗打开且给出含 `plugins` 路径的可粘贴命令；
* 「实时发现」能点且不抛异常；
* mono 下类型徽标去饱和（`sat < 0.12`），且**必须真的取到徽标** —— 取不到算失败。

> 走 **HTTP 而非 `file://`**：真实宿主里插件文档 origin 是 `tauri://localhost`（CORS 语义），
> `file://` 下 `fetch` 直接被拒，会让「目录能拉下来」这条路径永远测不到。
>
> 验收脚本传 `?catalog=local`，把产物里的在线目录 URL 改写成仓库内的 `market/catalog.json`。
> 不改写就会测到 GitHub 上的旧目录 —— 本地改了目录但还没 push 时等于没测。

---

## 4. 已移除：皮肤与背景（不要再按旧文档做）

2026-10-18 按用户口径整体移除：四套 `skin-*` 产物与其生成器 `build_skins.py` / `src/base.css`、
背景链 `build_background.py` / `bg_common.py` / `src/background.css` / `bg.config.json` / `bg-custom\`、
预览页 `preview.html` / `preview-mini.html`、
验收脚本 `verify.sh` / `audit.sh` / `_stress.sh` / `shots.sh` / `shoot1.sh` / `verify-bg.sh` / `set-active-skin.ps1`，
以及四份对应文档（`skin-authoring.md` / `background-plugin.md` / `preview-and-audit.md` / `real-machine-verification.md`）。

历史实现在 git 历史里（`git log --oneline -- build_skins.py`）。
**背景插件后续会重做** —— 重做时直接走宿主的 `plugin_type:"background"` 通道
（`active_background` → `<style id="openrevo-custom-background">`），
**不要再依赖 `build_skins`**（那条 import 依赖正是上一轮工具链被迫保留的原因）。

---

## 5. 参考文件地图

```
docs\
├── SKILL.md                              # 本文件：状态 + 硬约束 + 工作流 + 验收
├── devlog.md                             # 开发记录：时间线 + 每步数字证据 + 未决项
├── README.md                             # 文档与技能包怎么用、维护约定
├── OpenRevo_第三方插件开发手册.md          # 官方手册 v1.0（存档 ≠ 行为准则）
└── reference\
    ├── plugin-dev-0.8.8-skill.md         # 官方新版 Skill（0.8.8）逐条实测对照
    ├── plugin-manual-digest.md           # 手册消化件 + 「手册 ≠ 发行版」对照表
    ├── host-truth-extraction.md          # 从 exe 抽宿主 CSS/JS；宿主 DOM/令牌/!important 对手规则
    ├── environment-and-tools.md          # 环境硬事实 + 工具地图 + 证据索引 + 回退清单
    ├── market-host-constraints.md        # 老宿主的 tab 契约（无安装 IPC）—— 已被新宿主部分推翻，见页首横幅
    ├── host-plugin-ipc.md                # 新宿主新增的插件 IPC：安装/卸载/能力位（9,437,696 B 实测）
    └── pitfalls.md                       # 踩坑总表：现象 → 原因 → 对策
```

## 6. 现状快照（2026-10-18）

* 宿主已更新到 **9,437,696 B** 那一版（`ProductVersion` 仍报 0.9.1），**有安装 IPC**。
  插件目录里只有 `plugin-market`。
* **皮肤与背景整链已移除**（§4）。仓库现在只有市场一条链。
* 插件市场已升级并验收：`market-verify.sh cyber` 与 `mono` 各跑 **两代宿主 mock**，
  四个组合全 PASS（0 JS 错误）。新宿主路径实跑
  `get_plugin_host_capabilities → install_plugin_from_url → reload_plugins → uninstall_plugin`。
* `market/catalog.json` 收录 **2 条**（`plugin-market` + 外部 `xmsjx/dgpu-igpu-saving`），
  `topic:openrevo-plugin` 的 GitHub 搜索实查 `total_count: 2`，topic 发现链路已实测走通。
* 一键安装的参数链已在**真机**上逐层校订过：`{ id, url, subpath }` 三个字段都必需/必须对，
  其中 `subpath` 是**归档内**路径（宿主不会剥 codeload 的 `<repo>-<branch>/` 包装层）。
  弹窗里仍保留手动 `git clone` 备用路径（`reference/host-plugin-ipc.md` §3.1）。
* 长目录浏览：列表有滚动条 + 每页 12 条的翻页；验收闸会额外跑一份 30 条的临时目录，
  断言滚动容器真的可滚、翻页真的能翻（`devlog.md` §22）。
* 真机验证的边界：无法在真实宿主里驱动 CDP 抓图（`requireAdministrator` + 计划任务 `RunLevel=Highest`，
  且 9222 被用户 Chrome 占用）⇒ 上限是「等价沙盒 + 宿主目录枚举」。
