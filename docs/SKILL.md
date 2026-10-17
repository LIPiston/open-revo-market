---
name: openrevo-skin-plugin
description: 为 OpenRevo（open-revo.exe）开发、修改、验证第三方插件（skin 皮肤 / background 背景 / tab 面板 / widget 挂件 / slot 微插槽）与插件市场。当任务涉及 OpenRevo 的 theme.css、manifest.json、plugin_type 形态、把宿主改成 WinUI/Fluent 观感、宿主主控台与迷你双面板样式、从 exe 抽宿主真值 CSS/JS、无头 Chrome 审计与 verify.sh 验收、真机提权抓图与像素度量、或插件市场的目录/catalog/安装链路时，使用本技能。
---

# OpenRevo 插件开发技能（皮肤工具链 + 插件市场）

本技能沉淀自两轮完整实战：

* **皮肤工具链**：做出四套 WinUI/Fluent 皮肤，把宿主主控台重排成 **WinUI3 左侧导航栏 + 完全不透明**，
  迷你面板同步改造，并在真机完成像素级取证。**四套皮肤产物现已从仓库与宿主移除，工具链保留**（见 §0.1）。
* **插件市场**：`plugin-market`（`tab` 形态）—— 浏览、能力披露、给出最短安装路径。**这是本仓库当前的主交付物。**

## 0. 位置与当前状态

| 项 | 值 |
|---|---|
| 权威树（只维护这一棵） | `D:\LIPis\Documents\code\openrevo-plugins\` |
| 宿主 exe（**唯一真值来源**） | `D:\Program Files\OpenRevo\open-revo.exe` |
| 宿主版本 | **0.9.1**（9,368,576 B，mtime 2026-10-16 20:29） |
| 插件安装位 | `%APPDATA%\OpenRevo\plugins\<plugin_id>\` |
| 宿主配置 | `%APPDATA%\OpenRevo\config.json` |
| 当前已装插件 | **只有 `plugin-market`**（皮肤未装） |
| 已失效镜像 | `…\deepseek-harness\default-workspace\openrevo-win-skin\`（2026-10-04 改名前的快照，**已作废**，不要审计/同步） |

> ⚠️ **基线是 0.9.1，不是 0.8.8。** 宿主会自我更新（0.8.8 → 0.9.1 就发生在两次工作之间）。
> 写任何断言前先比 **exe 体积 + mtime**，并用**资产文件名里的内容哈希**（`index-<hash>.js`）判断前端有没有变：
> **文件名里的哈希就是内容哈希**，文件名没变才能复用 `_extracted/v091/` 里的抽取物。

### 0.1 皮肤产物的现状（重要）

四套皮肤目录 `skin-win11-{light,dark}\` / `skin-win10-{light,dark}\` **已从仓库删除**，
宿主 `config.json` 里的残留开关（含 `eva01-core`）也一并清掉。**但构建工具链完整保留**：

```bash
python build_skins.py            # 重新生成四个 skin-<id>\ 子目录
python build_skins.py --install  # 生成并安装到 %APPDATA%\OpenRevo\plugins\
```

保留工具链的原因是**硬依赖**：背景插件那套代码 `import build_skins`
（`build_background.py` 用 `skins.VARIANTS` / `skins.PLUGINS_DIR` / `skins.make_preview`，
`bg_common.py` 用 `build_skins.manifest` / `build_theme_css`）。删掉工具链会连带弄坏 `bg-custom`。

> **推论：`_tools/audit.sh` 与 `_tools/verify.sh` 现在需要先重建皮肤才能跑。**
> 它们按 `<skin_id>/theme.css` 逐个变体取样式（`audit.sh` 默认四套 ID，`preview.html` 用同步 XHR 读
> `<id>/theme.css`），仓库里没有这些目录时审计会报 `rules_applied = none`（皮肤根本没注入）。
> 想跑 132 条验收：先 `python build_skins.py`，再 `bash _tools/verify.sh`。

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
| `tab` | `allow-scripts allow-forms allow-same-origin` | **无 `allow-downloads` / `allow-popups`** ⇒ 下载与 `window.open` 被浏览器层拦死 |
| `widget` | 上者 + `allow-modals` | 多模态对话框 |
| `slot` | **无 sandbox** | 与宿主同源无隔离 |

> `tab` 同时给 `allow-same-origin` + `allow-scripts` ⇒ **沙盒形同虚设**：iframe 与宿主同源，
> 既能读 `window.parent.document`，也能拿 `window.parent.__TAURI_INTERNALS__.invoke`。
> **绝不**把「跑在 iframe 里」当安全边界，也不要在 UI 上写「安全隔离」。

### 1.2 宿主**有**的插件命令（13 条，全部）

```
get_custom_plugins          load_plugin_html            load_plugin_theme_css
load_plugin_background_css  set_custom_plugin_enabled   open_plugins_dir
open_custom_widget          close_custom_widget         widget_ready
set_active_skin             get_active_skin             set_active_background
get_active_background
```

宿主全部 IPC 共 **132 个唯一命令**（从 0.9.1 前端 `x("…")` 抽取）。**与插件相关的只有上表这 13 条**，
没有一条能：下载 / 写盘 / 删除插件 / 重载目录 / 开外链 / 读任意文件 / 读宿主版本。
缺失接口的完整清单与建议签名见 `market-host-constraints.md` §3 与桌面文档《OpenRevo 插件市场-宿主缺失接口清单》。

---

## 2. 硬约束（踩过学费的）

1. **宿主是唯一真值**：手册示例类名（`.overview-main-grid` / `.sensor-gauge-cluster` / `.cooling-fan-card` /
   `.power-mode-selector`）在发行版里**不存在**；手册的 `--core-*` 令牌也不存在。以 `_extracted/v091/` 的真实选择器为准。
2. **CSS/HTML 必须单文件**（对 skin 与 tab 都成立）：
   * `skin`：宿主把整份 CSS 注入 `<style>`，`@import` 按 `tauri://` base URL 解析 → 取不到插件目录里的相对文件。
   * `tab`：宿主用 **`srcDoc`** 注入 iframe，基准 URL 是**宿主文档**（`tauri://localhost`）→
     任何 `<link rel=stylesheet>` / `<script src>` / `<img src="assets/…">` / `@import` **都 404**。
     所以市场产物是单文件（CSS/JS 全内联），构建期断言零外部引用。
3. **皮肤命名空间只能用 `[data-skin="<id>"]`**（皮肤互斥）。**绝不**写 `body:not([data-skin])` 之类兜底。
   `data-skin` 从来不写在 `<html>` 上（宿主写的是 `data-skin` / `data-background` / `data-theme` / `data-window-mode`）。
4. **压过宿主 React 内联 `style={{…}}` 只能靠 author `!important`**
   （`.acrylic-container` 的 `display:flex`、迷你根的 `background:rgba(12,15,22,.96)` / `backdrop-filter` 等）。
5. **CSS 自定义属性的层叠陷阱**：元素上的局部声明**胜过**继承值。宿主在 `.mini-drawer-root` 与
   `[data-theme=mono|cyber] .mini-drawer-root` 上**重新声明**整套 `--theme-*`，所以皮肤必须在
   `[data-skin="<id>"] .mini-drawer-root[data-theme]`（0,3,0）这一层再声明，并读**镜像变量** `--wf-hue-*`。
   六个槽位名 `pwr/gpu/hz/lux/kbd/bat` **一个都不能删**（宿主 mini 内联样式按名字取值），只能改取值。
6. **配色是硬约束**（用户口径）：整份 UI 只有 `--wf-accent`（系统主题色：可交互/已选中/已启用）
   + `--wf-important`（重要强调色：性能/功率/需注意）两个装饰色；`--wf-ok/-warn/-error` 只表达真实状态。
   验收要求 `dom.hueFamilies = 2` 且 `census.py` 色族数 = 2。⚠️ `--wf-*` 是**本工具链私有前缀**，不是宿主令牌。
7. **宿主有全局重置** `*{box-sizing:border-box;margin:0;padding:0;user-select:none}`（紧跟 `:root`）→ 不用自己声明；
   **永远不要**给 `.mini-drawer-root` 加 `border`（纵向余量只剩 11px，描边用 `box-shadow: inset`）。
8. **宿主认新插件目录的时机**：0.9.1 起插件页【刷新】**重扫列表 + 热重载当前样式**（重放
   `onApplySkin` / `onApplyBackground` → 重新 `load_plugin_*_css`），所以改 `theme.css`、装新目录
   **都只需点一次【刷新】**，不必拨开关、不必重启。
   ⚠️ 唯一例外：`active_skin` / `active_background` 指向**已删的旧 ID** 时，光刷新不够，必须
   「停 → 改 → 启」（`_tools\set-active-skin.ps1`）。宿主进程是 `requireAdministrator`，`taskkill` 会被拒。
9. **本机模型不支持图片输入**（`read_image` 报 `does not declare image input`）：一切观感判读只能靠
   直方图 / 列行亮度签名 / 分块 MAE / ASCII 渲染（`census.py` / `cmp.py` / `prof.py` / `ascii.py`）。
10. **抓真机图必须先置顶**：`WindowFromPoint` 会**跳过** Tauri 的透明/分层窗口，不能当 z 序证据；
    抓图脚本必须提权（`SetWindowPos` 也被 UIPI 拦）。抓完记得还原。
11. **改完要能回到用户原状**：动过 `config.json` 必须备份（`config.json.bak-*`）并还原。
    ⚠️ 宿主运行中持有权威内存态，**会整份回写 config**（实测多次）—— 但该回写**由用户操作触发**，
    静置不会自己变（实测静置 30 s 字节不变）。保险起见：停机改，或改完立即回读复验。
12. **`.ps1` 必须 UTF-8 BOM**（含中文时），且写文件的工具会**静默吃掉 BOM** →
    改完 `head -c3 x.ps1 | od -An -tx1` 应为 `ef bb bf`，再跑 `[Parser]::ParseFile` 复核 0 error。

---

## 3. 插件市场（本仓库主交付物）

| 目录 / 文件 | 作用 |
|---|---|
| `market/src/{market.js,market.css,index.template.html}` | 源码（**只改这里**） |
| `build_market.py` | 把三者内联成**单文件** `plugin-market/index.html` + 静态体检；`--check` / `--install` |
| `market/catalog.json` | 策展目录（构建时内联为离线兜底 SEED） |
| `market/crawl_topic.py` | 爬 GitHub `topic:openrevo-plugin` → catalog（`CURATED` 集合标「已审核」） |
| `market/validate_catalog.py` | 目录结构校验 E1–E10 |
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
* **不做假的一键安装**：宿主没有安装 IPC（§1.2），所以市场给**可复制的 PowerShell `git clone` 命令**，
  并在弹窗顶部**明说**「本版宿主没有开放安装接口」。下载动作也不做 —— 无 `allow-downloads`。
* **主题靠镜像**：iframe 是独立文档，宿主 `:root` 令牌**不继承** → 内联一份同名同值令牌，
  并用 `MutationObserver` 监听父文档 `data-theme`（cyber / mono / light）实时镜像。
* **剪贴板三层降级**：`navigator.clipboard` → `document.execCommand('copy')` → 让用户手动选中。
  沙盒下第一层可能被权限拦，**后两层是必需的，不是冗余**。

### 3.1 验收闸 `market-verify.sh` 的判据

`_tools/market-verify.sh [theme]` 在**等价宿主环境**（`_tools/market-preview.html` 复刻
`srcDoc` + sandbox + 父窗口桥）里跑预览页，退出码 0 = PASS。它断言：
`ready` 为真、`cards > 0`、**JS 错误为 0**、安装弹窗能打开且含命令与披露项、
「实时发现」能点且不抛异常、mono 下类型徽标去饱和（`sat < 0.12`）。

> 走 **HTTP 而非 `file://`**：真实宿主里插件文档 origin 是 `tauri://localhost`（CORS 语义），
> `file://` 下 `fetch` 直接被拒，会让「目录能拉下来」这条路径永远测不到。

---

## 4. 皮肤工具链（产物已移除，链路仍可用）

```bash
python build_skins.py            # 生成四套 skin-<id>\（唯一正确路径）
python build_skins.py --install  # 生成并安装
bash _tools/verify.sh            # 验收总闸：132 条断言（先 build_skins.py！见 §0.1）
bash _tools/audit.sh             # 四套变体 computedStyle 审计 → _audit\<id>.audit.txt
bash _tools/verify-bg.sh         # 背景链验收（第一条就是「既有 132 条无回归」）
PAGES=preview-mini.html:mini bash _tools/_stress.sh 48 8   # 改过预览页/皮肤 CSS 必跑，须「异常 0 次」
```

改皮肤只改两处：`src/base.css`（纯结构，全部选择器带 `__SKIN_ID__` 占位）+ `build_skins.py` 的 `VARIANTS` 令牌表。

**验收只认 `verify.sh` 的 exit code**：断言 = 主窗 9 条 × 4 套 + 迷你 22 条 × 4 套 + 像素普查 4 条 = **132 条**，
`exit 1` 不许交付。`dom.hueFamilies = 2` **单独出现不算通过**（坏读数里全是宿主原色时族数也恰好是 2）——
必须同时满足**正向条件**（迷你 `skin_active` = 本变体、`rules_applied = 118`、`settle.remounts = 1`、
`content.size = 410x621`、`ready.dot` / `themeBtn.cyber` / `oem.blocked` / `sponsorHeart` = 本变体 accent、
`oem.running` = important）。

**背景插件**（独立链）：真值在 `bg.config.json`，模板在 `src/background.css`，
改完跑 `python build_background.py build` 再跑 `bash _tools/verify-bg.sh`。
产物 `bg-custom\` 默认入库；`<id>-bg\` 派生皮肤只在显式 `--targets` 时才有。
按用户口径 **m00785「既然已知不行那就先不做」，它刻意没装进宿主、没激活**。

---

## 5. 参考文件地图

```
docs\
├── SKILL.md                              # 本文件：状态 + 硬约束 + 工作流 + 验收
├── devlog.md                             # 开发记录：时间线 + 每步数字证据 + 未决项
├── README.md                             # 文档与技能包怎么用、维护约定
├── OpenRevo_第三方插件开发手册.md          # 官方手册 v1.0（存档 ≠ 行为准则）
└── reference\
    ├── plugin-dev-0.8.8-skill.md         # 官方新版 Skill（0.8.8）逐条实测对照 + 背景壁纸通道
    ├── plugin-manual-digest.md           # 手册消化件 + 「手册 ≠ 发行版」对照表
    ├── host-truth-extraction.md          # 从 exe 抽宿主 CSS/JS；宿主 DOM/令牌/!important 对手规则
    ├── skin-authoring.md                 # manifest/目录、令牌与镜像架构、特异性阶梯、双面板配方
    ├── background-plugin.md              # 背景插件：data URI、遮罩同层、background 独立通道
    ├── preview-and-audit.md              # 预览页能力与 URL 参数、无头 Chrome、像素判据
    ├── real-machine-verification.md      # 提权重启/唤醒/置顶抓图/度量与实测基线
    ├── environment-and-tools.md          # 环境硬事实 + 工具地图 + 证据索引 + 回退清单
    ├── market-host-constraints.md        # 市场为什么长这样：0.9.1 tab 契约 / 无安装 IPC 取证
    └── pitfalls.md                       # 踩坑总表：现象 → 原因 → 对策
```

## 6. 现状快照（2026-10-17）

* 宿主 **0.9.1**；插件目录里**只有 `plugin-market`**；`active_skin` / `active_background` 均为 `null`。
* **四套皮肤产物已删除**（仓库 + 宿主 config 残留），工具链保留（§0.1）。
* 插件市场已交付并验收：`market-verify.sh cyber` 与 `mono` 双主题 PASS（cards=2、badges=8、0 JS 错误）。
* `market/catalog.json` 收录 2 条（`bg-custom`、`plugin-market`），爬虫 `CURATED` 同步收敛。
* 宿主缺失接口清单已出（桌面《OpenRevo 插件市场-宿主缺失接口清单.md》）：市场真正用到的宿主 IPC 只有 2 个
  （`get_custom_plugins`、`open_plugins_dir`），安装链路的接口一个都没有。
* 真机验证的边界：无法在真实宿主里驱动 CDP 抓图（`requireAdministrator` + 计划任务 `RunLevel=Highest`，
  且 9222 被用户 Chrome 占用）⇒ 上限是「等价沙盒 + 宿主目录枚举」。
