# 环境硬事实 · 工具地图 · 证据索引 · 回退清单

本页替代原先的两份接手文档（`HANDOVER.md` / `HANDOFF.md`，2026-10-04 已删除；原件在 git 提交 `c1e2e03` 里，
需要时 `git show c1e2e03:HANDOFF.md`）。
这里只留**长期有效**的东西：环境事实、工具定位、证据文件在哪、怎么退回用户原状、
以及「本任务明确没做」的边界。

* 任务过程与失败记录 → `devlog.md`
* 命令怎么跑 → `SKILL.md`
* 踩过的坑 → `pitfalls.md`

---

## 1. 环境硬事实（动手前先核对，别凭记忆）

| 事实 | 值 / 说明 |
|---|---|
| 权威树 | **只维护一棵**：GitHub 仓库 `LIPiston/open-revo-market`（2026-10-17 由 `open-revo-plugins` 更名，旧地址重定向）。本机克隆目录名可能仍是旧的 `…\openrevo-plugins\`。harness 工作区那棵 `…\default-workspace\openrevo-win-skin\` 是 2026-10-04 改名前的快照，**已作废** |
| 宿主 exe | `D:\Program Files\OpenRevo\open-revo.exe`，**唯一真值来源** |
| **宿主当前 9,437,696 B** | sha256 `796b75e0ecc3adaa9a4846aea38de1f63a874224a7e7ebaf8a5577e3ac41c50d`，mtime 2026-10-18 17:03，`ProductVersion` 仍报 `0.9.1`，**有安装/卸载 IPC** |
| **上一代 9,368,576 B** | sha256 `85ce81fb24746395ac35b9449834c4e27c1c54e669fcaf7f1da3179af7f946a1`，**没有任何安装 IPC**。`_extracted/v091/` 的前端抽取物来自这一代 |
| ⚠️ **版本号不能判断能力** | 两代 `ProductVersion` **都是 0.9.1**。唯一可靠判据是运行时调 `get_plugin_host_capabilities`（不存在就抛错） |
| **宿主会自我更新并重启** | 真实发生过多次（8,490,496 → 8,496,640 → 8,826,368(0.8.8) → 9,368,576(0.9.1) → 9,437,696）。⇒ 一切**字节偏移 / 文件大小**断言当场作废。判断前端是否变化要用**资产文件名里的内容哈希**（`index-<hash>.js`）——**文件名里的哈希就是内容哈希** |
| 宿主进程权限 | `requireAdministrator` → `taskkill /F` 被拒（拒绝访问）。重启必须走提权 `_tools\kill-and-start.ps1` |
| **插件枚举时机** | 插件页【刷新】**重扫列表 + 热重载当前样式**，所以装新目录只需**点一次【刷新】** |
| `active_skin` / `active_background` | 当前实测均为 **`null`**。两条独立的 CSS 注入通道：皮肤 → `<style id="openrevo-theme-skin">`，背景 → `<style id="openrevo-custom-background">` |
| **当前已装插件** | 插件目录 `%APPDATA%\OpenRevo\plugins\` 里**只有 `plugin-market`** |
| **宿主会整份回写 config** | 该回写**由用户操作触发**，静置不会自己变（2026-10-17 实测静置 30 s 字节不变）。保险口径：改 `config.json` 前先备份 |
| 配置文件 | `%APPDATA%\OpenRevo\config.json` |
| 显示器 / 缩放 | 2560×1600 @150% → WebView2 dsf = 1.5 |
| ⚠️ **本机模型不能读图** | `read_image` 实测报 `model "cn:deepseek-v4.1-flash" does not declare image input` ⇒ 一切观感判读必须转成数字/ASCII（`census.py` / `cmp.py` / `prof.py` / `ascii.py`） |
| ⚠️ **真机 CDP 抓图做不到** | ① exe 清单 `requireAdministrator` + 计划任务 `RunLevel=Highest`，普通权限 `Stop-Process` 被拒；② 端口 9222 被用户自己的 Chrome 占用。⇒ 本机验证上限 = 「等价沙盒 + 宿主目录枚举」 |
| `.ps1` 编码纪律 | 含中文的 `_tools\*.ps1` **必须存成 UTF-8 BOM**，否则 PS 5.1 按 GBK 解码报错。检查：`head -c3 x.ps1 \| od -An -tx1` 应为 `ef bb bf` |
| ⚠️ 写文件的工具会吃掉 BOM | 改过的 `.ps1` 必须补回 BOM（`pitfalls.md` #38 有一行 Python 修法） |
| MSYS 与 Windows 工具的错位 | `/tmp` 里的文件 Windows Python 看不见；`powershell -File` 走 MSYS 时具名参数会被吃掉（用 `$args`）；`python -c` 的引号地狱改成 `-File` 脚本 |

---

## 2. `_tools\` 工具地图

**权威路径**（只有这几个是可靠工作路径）：

| 用途 | 工具 |
|---|---|
| **市场验收闸** | `bash _tools/market-verify.sh [cyber\|mono] [new\|old]` → `RESULT: PASS/FAIL`，非 0 **不许交付** |
| 一行安装 | `_tools\install-market.ps1`（默认在线拉现成产物；`-Local` / `-From` / `-DryRun` / `-Repo`） |
| 等价宿主预览 | `_tools/market-preview.html`（`?theme=` / `?host=` / `?catalog=local` / `?modal=1`） |
| 市场出图 | `_tools/market-shots.sh` |
| 重启宿主 | `_tools\kill-and-start.ps1`（提权，`Stop-Process -Force`，可靠） |
| 抓真机图 | `_tools\wake-grab-dash.ps1`、`_tools\pin-grab-hwnd.ps1 -Hwnd <n> -Out <png>` |

全量分类：

| 类别 | 工具 | 备注 |
|---|---|---|
| **市场（本仓库主链）** | `build_market.py`（构建 + 自检，`--check` / `--install`）、`_tools/install-market.ps1`（一行安装）、`_tools/market-verify.sh`、`_tools/market-preview.html`、`_tools/market-shots.sh`、`market/crawl_topic.py`、`market/validate_catalog.py` | 源码只在 `market/src/`；`plugin-market/` 是生成物别手改 |
| **度量（模型不能读图，这就是眼睛）** | `census.py`（像素级色相族普查）、`cmp.py`（分块 MAE）、`prof.py`（行/列亮度 ASCII 签名）、`ascii.py`（ASCII 渲染） | 对任何截图都可用，不限于已被移除的皮肤链 |
| 宿主进程 | `kill-and-start.ps1`、`restart.ps1`、`when.ps1` | `restart.ps1` 走 `Stop-ScheduledTask`，进程没真死时会跳过重启，故不作为权威路径 |
| 列窗口 / 遮挡 | `allwins.ps1`、`listwins.ps1`、`wins.ps1`、`who.ps1`、`who-locks.ps1` | 均带 `CharSet=CharSet.Unicode`，中文标题才读得全；`who.ps1` 用 `WindowFromPoint`，**会跳过 Tauri 透明/分层窗口**，不能当 z 序证据 |
| 抓图（其余） | `pin-grab.ps1`、`grab.ps1`、`grab-main.ps1`、`show-app.ps1` | `show-app.ps1` 只 show **不置顶** → 会拍到自己的浏览器 |
| 反例（别用） | `capwin.ps1`（`PrintWindow` 对 Tauri 返回全 alpha=0 黑图）、`min-grab.ps1`（Tauri 不能最小化）、`move-grab.ps1`（移位抓图不可靠） | 全部写进 `pitfalls.md` |
| 工程维护 | `rename-project.ps1`、`probe-win.ps1` / `probe-win-dpi.ps1`（窗口 DPI 探测） | — |
| 已废弃 | `cdp.py`、`relaunch-debug.ps1`、`scan_ebwebview.py` | Tauri/wry 不理 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`；别复活。**真机 CDP 抓图确认为不可能** |

---

## 3. 证据文件索引（出问题先看这些）

| 文件 | 是什么 |
|---|---|
| `_extracted/v091/index-CXze12DN.js` | **0.9.1 前端 JS（真值）**，641,939 B，sha256 `b56cc0a4952ce6c822251825…`。插件 IPC 命令、`plugin_type` 字面量、sandbox 字面量都从这里抽 |
| `_extracted/v091/index-CQ_flESn.css` | **0.9.1 前端 CSS（真值）**，59,884 B，sha256 `42e8e3a4715d4e6027c537b4…` |
| `_extracted/index-C535NsqC.css` / `index-CGlrizf7.js` | 0.8.8 时期的抽取物（**历史基线**，仅作对照） |
| `_extracted/new-build/` | 早期自我更新后的重新抽取（复核用，见 `devlog.md` §9） |
| `_shots/market-*.png` | 市场验收出图（`market-verify.sh` / `market-shots.sh` 产物）；`*-new` / `*-old` 对应两代宿主 mock |
| `market/catalog.json` | 市场目录（构建时内联为离线兜底）；在线副本在 `raw.githubusercontent.com/LIPiston/open-revo-market/main/market/catalog.json`，**尚未 push 时 `fetch` 得 HTTP 404**，UI 会如实回落到内置目录 |
| `_shots/*.log` | 真机抓图日志（含 hwnd / rect / 落地文件名，可当时间线证据） |

---

## 4. 回退 / 还原（用户现场）

* **停用插件**：宿主【插件】页取消勾选 —— 宿主会 `remove()` 掉注入的内容，立即恢复原观感。
* **彻底移除**：删 `%APPDATA%\OpenRevo\plugins\<id>\`，并在 `%APPDATA%\OpenRevo\config.json` 里清掉
  `custom_plugin_toggles` 与 `widget_positions` 中残留的该 ID，再重启宿主。
* **配置还原**：任何改动 `config.json` 的动作都要**先备份再改**（备份命名 `config.json.bak-*`）。
* **已执行的清理（2026-10-17）**：四套皮肤目录（仓库 + 插件目录）已删；`config.json` 里
  `custom_plugin_toggles` 收敛为只剩 `plugin-market`、`widget_positions` 清空。
  备份：`config.json.bak-skincleanup-20261017-075507`。**当前 `active_skin` / `active_background` 均为 `null`。**
* **已执行的清理（2026-10-18）**：皮肤与背景的**整条工具链**已从仓库删除（见 `SKILL.md` §4），
  不只是产物。历史实现在 git 历史里。
* **已知未还原项（2026-10-04 12:16 记录，需用户拍板）**：`power_mode` / `power_mode_ac` 为 `4`
  （改名备份 `config.json.bak-skinrename` 里是 `1`，与本轮任何动作无关）；`full_window_x/y` 为 `478/256`
  （更早备份里是 `640/337`，**无法判定是哪一次宿主自写造成的**，故未替用户改回）。
* **抓完真机图**：`wake-grab-dash.ps1` 不会把大面板收回屏幕外 —— 需要手动收起。

---

## 5. 本任务明确**没有**做的事（不要以为已经做了）

* 没有改宿主 exe、没有注入任何 hook：一切产物都是**插件文件 + 宿主自身机制**。
* 没有在**真实宿主**里驱动 CDP 出图（`requireAdministrator` + 9222 被占，见 §1）——
  市场验收走的是**等价沙盒**（`_tools/market-preview.html`）。
* **一键安装的参数链已按真机报错逐层校订**：`id` 与 `subpath` 两处都曾在真机上失败过，
  现场取证方式与结论见 `devlog.md` §20–21。`subpath` 是**归档内**路径
  （宿主不剥 codeload 的 `<repo>-<branch>/` 包装层），弹窗里仍保留手动路径。
* **没有在真实宿主里完整走完一次一键安装到生效**：参数与归档目录解析已对齐，
  但「装完插件真的出现在侧边栏」这一步没有真机截图佐证。
* **没有对 `widget` / `slot` 形态做过实测**：只从 0.9.1 前端 JS 抽出了它们的 sandbox 与 `target_slot`
  取用逻辑。`service` / `shell` / `driver` 在前端里**仍无字面量**，三种形态均未证实。
* **新 exe 的前端载荷解不开**（不是裸 brotli/zstd/xz），所以 `index-tvUoAylw.js` 里有没有
  `window.OpenRevo`、`restart_plugin_service` 是否只存在于前端，都还不确定。
* **皮肤与背景插件不再维护**（2026-10-18 移除）；背景插件后续重做，不要复用 `build_skins` 依赖。
