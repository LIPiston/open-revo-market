# 环境硬事实 · 工具地图 · 证据索引 · 回退清单

本页替代原先的两份接手文档（`HANDOVER.md` / `HANDOFF.md`，2026-10-04 已删除；原件在 git 提交 `c1e2e03` 里，
需要时 `git show c1e2e03:HANDOFF.md`）。
这里只留**长期有效**的东西：环境事实、34 个工具的定位、证据文件在哪、怎么退回用户原状、
以及「本任务明确没做」的边界。

* 任务过程与失败记录 → `devlog.md`
* 命令怎么跑 → `SKILL.md`（30 秒上手 / 标准工作流）
* 测得的数字 → `real-machine-verification.md`（真机）、`preview-and-audit.md`（预览与审计）
* 踩过的坑 → `pitfalls.md`

---

## 1. 环境硬事实（动手前先核对，别凭记忆）

| 事实 | 值 / 说明 |
|---|---|
| 权威树 | **只维护 `D:\LIPis\Documents\code\openrevo-plugins\`**。harness 工作区那棵 `…\default-workspace\openrevo-win-skin\` 是 2026-10-04 改名前的快照，**已作废**，不要再同步、不要拿它的预览页审计（踩过「改了 A 树、审计了 B 树」） |
| 宿主 exe | `D:\Program Files\OpenRevo\open-revo.exe`，**唯一真值来源** |
| **当前宿主版本 = 0.9.1** | exe **9,368,576 B**、mtime 2026-10-16 20:29、`FileVersion`/`ProductVersion` 均 `0.9.1`。资产：`/assets/index-CXze12DN.js`（641,939 B）、`/assets/index-CQ_flESn.css`（59,884 B），抽取物在 `_extracted/v091/`。**本技能包的皮肤侧数字（132 条断言、几何、MAE）测于 0.8.8，仅作回归对比** |
| **宿主会自我更新并重启** | 真实发生过两次（8,490,496 → 8,496,640 B；8,826,368 B(0.8.8) → 9,368,576 B(0.9.1)）⇒ 一切**字节偏移 / 文件大小**断言当场作废。动手前先比 exe 的 mtime/大小与进程 StartTime；判断宿主前端是否变化要用**资产文件名里的内容哈希**（`index-<hash>.js` 变了就是前端变了）——**文件名里的哈希就是内容哈希** |
| 宿主进程权限 | `requireAdministrator` → `taskkill /F` 被拒（拒绝访问）。重启必须走提权 `_tools\kill-and-start.ps1` |
| **插件枚举时机** | 0.9.1 起插件页【刷新】**重扫列表 + 热重载当前样式**（`M=async(j=!1)=>{…get_custom_plugins…if(j){…get_active_skin / get_active_background…重放…}}`），所以改 `theme.css`、装新目录都只需**点一次【刷新】**。⚠️ 唯一例外：`active_skin` / `active_background` 指向**已删的旧 ID**（改名/换 ID 的残局）时仍须「停 → 改 → 启」（`_tools\set-active-skin.ps1`，见 `pitfalls.md` #37）。早于 0.9.1 的构建（含 0.8.7、`v0.8.8-bf72755`）【刷新】只重扫列表 |
| `active_skin` / `active_background` | 当前实测均为 **`null`**（皮肤与背景都没装）。两者是**独立的两条 CSS 注入通道**：皮肤 → `<style id="openrevo-theme-skin">`（`load_plugin_theme_css`），背景 → `<style id="openrevo-custom-background">`（`load_plugin_background_css`），互不覆盖 |
| **当前已装插件** | 插件目录 `%APPDATA%\OpenRevo\plugins\` 里**只有 `plugin-market`**；`custom_plugin_toggles` 只有 `{"plugin-market": true}`。四套皮肤目录已删（见 `SKILL.md` §0.1） |
| `wake_window_mode` | **只在启动时读入**。用户原值是 `mini`（临时改过就必须还原） |
| **宿主会整份回写 config** | 实测 2026-10-04 的 10:13:06 / 11:26:44 / 12:06:33 无人操作也会变；2026-10-17 复核发现该回写**由用户操作触发**（静置 30 s 字节不变，窗口内唯一变化来自一次真实的插件开关点击）。保险口径：改 `active_skin` / `active_background` 的顺序仍是**停 → 改 → 启**（`_tools\set-active-skin.ps1`，见 `pitfalls.md` #37） |
| 配置文件 | `%APPDATA%\OpenRevo\config.json`。相关键：`active_skin`、`active_background`、`wake_window_mode`、`custom_plugin_toggles`、`widget_positions`、`power_mode` / `power_mode_ac`、`refresh_rate`、`gpu_mode`、`full_window_x/y`。**具体值以当场实读为准**，本表不当权威 |
| 显示器 / 缩放 | 2560×1600 @150% → WebView2 dsf = 1.5 |
| 主窗几何 | 物理 1702×1213 = **CSS 1135×809**；被宿主隐藏时停在 `(-32000,-32000)` 并缩成 237×39 |
| mini 几何 | 物理 615×916 = **CSS 410×610**（宽固定 410；高由宿主 `ResizeObserver` + `fit_mini_window_height` 动态定，变化 >250px 才触发）。宿主自身内容 **410×621** ⇒ 纵向滚动条是宿主固有的（余量仅 11px） |
| ⚠️ **本机模型不能读图** | `read_image` 实测报 `model "cn:deepseek-v4.1-flash" does not declare image input` ⇒ 一切观感判读必须转成数字/ASCII（`census.py` / `cmp.py` / `prof.py` / `ascii.py`） |
| ⚠️ 抓真机图的代价 | 必须提权置顶（会打断用户）；`wake-grab-dash.ps1` **只还原 z 序、不还原停车位置**，抓完面板会留在桌面上，收尾要手动收起 |
| ⚠️ **真机 CDP 抓图做不到** | 无法在真实宿主里驱动 CDP：① exe 清单 `requireAdministrator` + 计划任务 `RunLevel=Highest`，普通权限 `Stop-Process` 被拒，`Start-Process -Verb RunAs` 在本机不静默提权；② 端口 9222 被用户自己的 Chrome 占用。⇒ 本机验证上限 = 「等价沙盒 + 宿主目录枚举」，见 `market-host-constraints.md` §6 |
| 版式参照物 | `D:\LIPis\desktop\openrevo ui`（只读原型，不是发行版） |
| `.ps1` 编码纪律 | 含中文的 `_tools\*.ps1` **必须存成 UTF-8 BOM**，否则 PS 5.1 按 GBK 解码报 `Get-Process : 无法对参数 Name 执行参数验证…`。检查：`head -c3 x.ps1 \| od -An -tx1` 应为 `ef bb bf`，再用 `[Parser]::ParseFile` 复核 0 error |
| ⚠️ 写文件的工具会吃掉 BOM | 改过的 `.ps1` 必须补回 BOM（`pitfalls.md` #38 有一行 Python 修法） |
| MSYS 与 Windows 工具的错位 | `/tmp` 里的文件 Windows Python 看不见；`powershell -File` 走 MSYS 时具名参数会被吃掉（用 `$args`）；`python -c` 的引号地狱改成 `-File` 脚本 |

---

## 2. `_tools\` 工具地图（34 个条目）

**权威路径**（只有这几个是可靠工作路径）：

| 用途 | 工具 |
|---|---|
| **市场验收闸** | `bash _tools/market-verify.sh [cyber\|mono]` → `RESULT: PASS/FAIL`，非 0 **不许交付** |
| **皮肤验收总闸** | `bash _tools/verify.sh` → 「合计 132 条断言，失败 M 条」，`exit 1` **不许交付**。⚠️ 需先 `python build_skins.py`（皮肤产物已删，见 `SKILL.md` §0.1） |
| 审计 | `bash _tools/audit.sh`（`PAGE=preview-mini.html` 换页）；`_stress.sh`（并发压测，抓偶发竞态） |
| 重启宿主 | `_tools\kill-and-start.ps1`（提权，`Stop-Process -Force`，可靠） |
| 切皮肤 | `_tools\set-active-skin.ps1 [skin] [dry]`（停→备份→只换 `active_skin`→回读→启） |
| 抓真机图 | `_tools\wake-grab-dash.ps1`（唤醒大面板 + 提权置顶 + 抓图）、`_tools\pin-grab-hwnd.ps1 -Hwnd <n> -Out <png>` |

全量分类：

| 类别 | 工具 | 备注 |
|---|---|---|
| **市场（本仓库主链）** | `build_market.py`（构建 + 自检，`--check` / `--install`）、`_tools/market-verify.sh`（验收闸）、`_tools/market-preview.html`（等价宿主预览）、`_tools/market-shots.sh`（出图）、`market/crawl_topic.py`、`market/validate_catalog.py` | 源码只在 `market/src/`；`plugin-market/` 是生成物别手改 |
| 审计 / 截图 | `verify.sh`、`audit.sh`、`_stress.sh`、`shots.sh`、`shoot1.sh <page> <name> <w> <h> <query> <skin\|off> [dsf]`、`repro-btn.html` | 无头 Chrome，不打扰用户 |
| **度量（模型不能读图，这就是眼睛）** | `census.py`（像素级色相族普查）、`cmp.py`（分块 MAE）、`prof.py`（行/列亮度 ASCII 签名）、`ascii.py`（ASCII 渲染） | 见 `preview-and-audit.md` §5 |
| 宿主进程 | `kill-and-start.ps1`、`restart.ps1`、`when.ps1` | `restart.ps1` 走 `Stop-ScheduledTask`，进程没真死时会跳过重启，故不作为权威路径 |
| 配置 | `set-active-skin.ps1` | 只在 `active_skin` / `active_background` 指向已删旧 ID 时用 |
| 列窗口 / 遮挡 | `allwins.ps1`、`listwins.ps1`、`wins.ps1`、`who.ps1`、`who-locks.ps1` | 均带 `CharSet=CharSet.Unicode`，中文标题才读得全；`who.ps1` 用 `WindowFromPoint`，**会跳过 Tauri 透明/分层窗口**，不能当 z 序证据 |
| 抓图（其余） | `pin-grab.ps1`（hwnd 通用；**已复核：`Say()` 已定义**，早前文档说它未定义是陈旧结论）、`grab.ps1`、`grab-main.ps1`、`show-app.ps1` | `show-app.ps1` 只 show **不置顶** → 会拍到自己的浏览器 |
| 反例（别用） | `capwin.ps1`（`PrintWindow` 对 Tauri 返回全 alpha=0 黑图）、`min-grab.ps1`（Tauri 不能最小化）、`move-grab.ps1`（移位抓图不可靠） | 全部写进 `pitfalls.md` |
| 工程维护 | `rename-project.ps1`（重命名工程根；CWD 被占用必报 `Device or resource busy`，见 `pitfalls.md` #36）、`probe-win.ps1` / `probe-win-dpi.ps1`（窗口 DPI 探测） | — |
| 已废弃 | `cdp.py`、`relaunch-debug.ps1`、`scan_ebwebview.py` | Tauri/wry 不理 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`；别复活，注册表项已清理。**真机 CDP 抓图确认为不可能**（见 §1 末行） |
| 不在 `_tools\` 但必需 | `build_skins.py --install` / `--preview`（皮肤构建与安装的唯一正确路径）、`build_background.py`（背景链）、`build_market.py`（市场链） | — |

---

## 3. 证据文件索引（出问题先看这些）

| 文件 | 是什么 |
|---|---|
| `_extracted/v091/index-CXze12DN.js` | **宿主 0.9.1 前端 JS（真值）**，641,939 B，sha256 `b56cc0a4952ce6c822251825…`。宿主全部 132 个 IPC 命令、`plugin_type` 字面量、sandbox 字面量都从这里抽 |
| `_extracted/v091/index-CQ_flESn.css` | **宿主 0.9.1 前端 CSS（真值）**，59,884 B，sha256 `42e8e3a4715d4e6027c537b4…` |
| `_extracted/index-C535NsqC.css` / `index-CGlrizf7.js` | 0.8.8 时期的抽取物（**历史基线**，仅作对照） |
| `_extracted/host-shell.css` | 宿主外壳/主题子集（预览页加载它） |
| `_extracted/new-build/` | 早期自我更新后的重新抽取（复核用，见 `devlog.md` §9） |
| `_shots/market-{cyber,mono}.png`、`market-modal-cyber.png` | 市场验收出图（`market-verify.sh` / `market-shots.sh` 产物） |
| `market/catalog.json` | 市场目录（构建时内联为离线兜底）；在线副本在 `raw.githubusercontent.com/LIPiston/open-revo-plugins/main/market/catalog.json`，**尚未 push 时 `fetch` 得 HTTP 404**，UI 会如实回落到内置目录 |
| `_shots\real-dash-1500.png`（同批 `real-dash-1200.png`） | 真机主窗成品：侧栏生效 + 不透明的像素证据（1702×1213，**0.8.8 基线**） |
| `_shots\real-mini-clean.png` | 真机迷你面板（无遮挡，0.8.8 基线） |
| `_shots\mini-<id>.png` | 四套迷你变体截图（`census.py` 的输入，0.8.8 基线） |
| `_audit\<id>.audit.txt` / `_audit\mini-<id>.audit.txt` | 四套变体 computedStyle 审计产物（`root.bg` / `root.blur` / `--theme-pwr` / `quickActive.bg` / `settle.remounts` …）。⚠️ 皮肤产物删除后重跑会得到 `rules_applied = none` |
| `_audit\_stress_<tag>\` | 并发压测产物与参考样本 |
| `_shots\wake-grab-dash.log` | 真机抓图日志（含 hwnd / rect / 落地文件名，可当时间线证据） |

---

## 4. 回退 / 还原（用户现场）

* **停用皮肤**：宿主【插件】页取消勾选 —— 宿主会 `remove()` 掉注入的 `<style>`，立即恢复原观感。
* **彻底移除**：删 `%APPDATA%\OpenRevo\plugins\<id>\`，并在 `%APPDATA%\OpenRevo\config.json` 里清掉
  `custom_plugin_toggles` 与 `widget_positions` 中残留的该 ID，再重启宿主。
* **配置还原**：任何改动 `config.json` 的动作都要**先备份再改**（备份命名 `config.json.bak-*`）。
  `set-active-skin.ps1` 自己会生成 `config.json.bak-setskin-<时间戳>`。
* **已执行的清理（2026-10-17）**：四套皮肤目录（仓库 + 插件目录）已删；`config.json` 里
  `custom_plugin_toggles` 收敛为 `{"plugin-market": true}`、`widget_positions` 清空（含 `eva01-core` 残留）。
  备份：`config.json.bak-skincleanup-20261017-075507`。**当前 `active_skin` / `active_background` 均为 `null`。**
* **已知未还原项（2026-10-04 12:16 记录，需用户拍板）**：`power_mode` / `power_mode_ac` 为 `4`
  （改名备份 `config.json.bak-skinrename` 里是 `1`，与本轮任何动作无关）；`full_window_x/y` 为 `478/256`
  （更早备份 `config.json.bak-skinverify` 里是 `640/337`，**无法判定是哪一次宿主自写造成的**，故未替用户改回）。
* **抓完真机图**：`wake-grab-dash.ps1` 不会把大面板收回屏幕外 —— 需要手动收起（或让用户自己关）。

---

## 5. 本任务明确**没有**做的事（不要以为已经做了）

* 没有改宿主 exe、没有注入任何 hook：一切产物都是**插件文件 + 宿主自身机制**。
* 没有复刻 OEM 助手弹窗与「极客调校」浮层的真实外观（只做了近似手臂）。
* 没有修 mini 底部那条细横向滚动条（用户表态「先不动」；成因链见 `devlog.md` §6.1）。
* 没有拿到用户对四套皮肤的观感确认（`read_image` 不可用，观感只能由用户看真机）。
* 没有在**真实宿主**里驱动 CDP 出图（`requireAdministrator` + 9222 被占，见 §1）——
  市场验收走的是**等价沙盒**（`_tools/market-preview.html`），这一点在 `market-host-constraints.md` §6 已写明。
* **没有对 `widget` / `slot` 形态做过实测**：只从 0.9.1 前端 JS 抽出了它们的 sandbox 与 `target_slot` 取用逻辑
  （`get_custom_plugins` → 匹配 `plugin_type==="slot" && target_slot===e && enabled` → `load_plugin_html`）。
  `service` / `shell` / `driver` 在 0.9.1 前端里**仍无字面量**，三种形态均未证实
  （见 `plugin-dev-0.8.8-skill.md` §6）。
* **没有实现真实的一键安装/卸载**：宿主没有这些 IPC，市场只给可复制的命令（`market-host-constraints.md` §3）。
