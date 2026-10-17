# 真机取证（real-machine verification）

预览只能证明「样式表算出来是对的」，**版式、窗口几何、宿主实际注入时机**必须在真机上看。
这一节是那次真机取证的全部方法、脚本与实测基线，照做即可复现。

> **基线**：本页的几何 / 直方图 / MAE 数字测于 **0.8.8**，仅用于**回归对比**。
> 当前宿主是 **0.9.1**（exe 9,368,576 B）—— 换版本后这些数字不作断言，必须重测。
> ⚠️ 另一个已确认的硬边界：**无法在真实宿主里驱动 CDP 抓图**（`requireAdministrator` + 计划任务
> `RunLevel=Highest`，且 9222 被用户 Chrome 占用）⇒ 本机验证上限 = 「等价沙盒 + 宿主目录枚举」，
> 见 `market-host-constraints.md` §6。

## 1. 宿主是一个需要提权的 Tauri 应用

* `open-revo.exe` 的 manifest 是 `requireAdministrator`：`taskkill /F /PID` 会**拒绝访问**。
* 唯一可行路径（脚本 `_tools\kill-and-start.ps1`）：

  ```powershell
  Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait `
    -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','<…>\kill-and-start.ps1'
  # 内部：Stop-Process -Id <pid> -Force  →  Start-ScheduledTask -TaskName OpenRevo
  ```
* **`SetWindowPos` 置顶同样需要提权**，否则被 UIPI 拦下（返回 False，静默无效）。所以抓图脚本必须提权运行。
* 所有 `_tools\*.ps1` 若含中文注释，**必须存成 UTF-8 BOM**，否则 PS 5.1 按 GBK 解码，会得到
  `Get-Process : 无法对参数 Name 执行参数验证。参数为 Null 或空` 这类莫名错误。
* P/Invoke 声明 `GetWindowTextW`/`GetClassNameW` 时**必须带 `CharSet = CharSet.Unicode`**，
  否则标题/类名只读到首字符（`_tools\wins.ps1:11-12` 已经带上这两行，新写脚本照抄）。

## 2. 装完皮肤要「让宿主认到新目录」

**插件页【刷新】= 重扫列表 + 热重载当前样式**：它重新调 `get_custom_plugins`，并重放
`onApplySkin` / `onApplyBackground` → 重新 `load_plugin_*_css`（0.9.1 逐字：
`M=async(j=!1)=>{…get_custom_plugins…if(j){…get_active_skin / get_active_background…重放…}}`）
⇒ **改 `theme.css`、装新插件目录都只需点一次【刷新】**，不必拨开关、不必重启。

`active_skin` / `active_background` 指向**已删 ID**（改名 / 换 ID 后的残局）是唯一例外：光刷新不够。
宿主启动时读一次 `config.json`，且运行中持有权威内存态、**会整份回写**它，所以「先改再启」必被冲掉。
顺序只能是 **停 → 改 → 启**，已封成一条命令：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File _tools\set-active-skin.ps1 skin-win11-dark dry   # 空跑看计划
powershell -NoProfile -ExecutionPolicy Bypass -File _tools\set-active-skin.ps1 skin-win11-dark       # 真跑（自提权）
```

脚本自带守卫（宿主没停掉就拒绝改、目标皮肤无 `theme.css` 就拒绝改），只替换 `active_skin` 一个字段，
改完 `ConvertFrom-Json` 回读复验。细节见 pitfalls #37。

> 当前四套皮肤产物已删（见 `SKILL.md` §0.1），所以 `set-active-skin.ps1 <skin>` 现在会因「目标皮肤无
> `theme.css`」被守卫拒绝 —— 先用 `python build_skins.py` 重建。

诊断：比较进程启动时间与插件目录 mtime

```powershell
_tools\when.ps1      # 打印 open-revo 进程的 StartTime
```

修复：提权 `_tools\kill-and-start.ps1` 重启（一般**只需要点一次【刷新】**）。

### 2.1 宿主会自我更新并重启（每次动手前先复核）

开发中途实测发生过一次：exe 在 `23:49:31` 被换掉（8,490,496 → 8,496,640 B），进程在 `23:54:17` **自动重启**。
后果：文档/脚本里所有**字节偏移**失效（CSS 路径 `7145918 → 6941209`），JS 切片名也从 `index-CGlrizf7.js` 变成
`index-BzQyTcpV.js`。三分钟复核流程：

1. 看 exe：`powershell -c "Get-Item 'D:\Program Files\OpenRevo\open-revo.exe' | Select Length,LastWriteTime"`。
2. 比进程启动时间（`_tools\when.ps1`）与 exe mtime：进程更老 ⇒ 它跑的还是旧构建（要重启才一致）。
3. 看**文件名里的内容哈希**：`assets/index-C535NsqC.css` 的 `C535NsqC` 没变 ⇒ 宿主 CSS 没变 ⇒ 皮肤不受影响；
   变了就重新抽 CSS 与旧抽取物 `cmp`。
4. JS 切片名变了 ⇒ 重新抽 JS 并 grep 皮肤依赖的关键标识（本次 28 个标识全在：
   `load_plugin_theme_css` 2、`openrevo-custom-skin` 4、`data-skin` 1、`mini-drawer-root` 1、`m-quick-btn` 12、
   `m-card` 14、`sub-nav-wrapper` 1、`tab-sponsor` 1、`glass-card` 32、`plugin_type` 9、`theme_css` 2 …）。

## 3. 把主控台「唤醒/展开」出来

* 宿主平时把主控台窗口**停车在屏幕外**：`(-32000,-32000)` 且缩到 `237×39`（抓它只会得到全黑）。
* `wake_window_mode` 决定唤醒时弹 mini 还是完整大面板，**只在启动时读一次**：
  * 要取证大面板：临时把它改成 `"full"`（先备份 `config.json.bak-skinverify`），重启；
  * **取完必须改回原值（用户这里是 `"mini"`）并重启**，把现场还给用户。
* 唤醒方式：
  * `_tools\show-app.ps1`：再启一个实例，触发单实例唤醒 → **会把窗口 show 出来，但不会把它置顶**；
  * 更可靠的是直接抓：`_tools\wake-grab-dash.ps1`（提权）自己 `Start-Process open-revo.exe` 触发唤醒，
    等 1200/1500ms，然后按「标题 = `OpenRevo` 且窗口宽度 ≥ 800」挑出大面板（615px 宽的 mini 被这个条件排掉），
    置顶、`CopyFromScreen`、还原。日志 `_shots\wake-grab-dash.log`。
* `tray_icon_app` 那个窗口**不是面板**（无绘制）；对它 `ShowWindow(SW_SHOW)` 只会露出桌面壁纸和图标，别再试。

## 4. 抓图：必须置顶，且要用对 API

| 脚本 | 机制 | 结论 |
|---|---|---|
| `pin-grab-hwnd.ps1 -Hwnd <n> -Out <png>` | 提权 `SetWindowPos(HWND_TOPMOST)` → `CopyFromScreen`（DPI 感知）→ 还原 `HWND_NOTOPMOST` | **推荐**。日志 `_shots\pin-grab-hwnd.log` |
| `pin-grab.ps1` | 同上，但内部调用了**未定义**的 `Say()` | 有坑，用上面那个 |
| `grab.ps1` | DPI 感知全屏 `CopyFromScreen` → `_shots/screen.png`（2560×1600） | 需要自己裁 |
| `capwin.ps1` | `PrintWindow` + `PW_RENDERFULLCONTENT` | **Tauri 窗口返回全 alpha=0 黑图**；Chromium 上正常；另外它按**精确标题**匹配，用子串会匹配到自己的浏览器 |
| `min-grab.ps1` | 最小化前后差分 | **无效**：Tauri 窗口不能被最小化，两帧 100% 相同 |
| `move-grab.ps1` | 移动前后差分 | **无效**：`show-app.ps1` 不置顶，所谓「窗口区域」其实是我的 DSH 浏览器（A 与背景 100% 相同） |

**遮挡**：`WindowFromPoint` 会跳过 Tauri 的透明/分层窗口，所以它回报的窗口**不是** z 序证据。
本次实测踩过：迷你面板左半被一条纯色 `(34,34,34)` 带盖住，真凶是 **QQ**
（`pid=13556 class='Chrome_WidgetWin_1' title='QQ' rect=(569,237)-(2230,1273)`，右边缘 2230 正好是色带终点）。
所以：**任何真机截图，先用 `_tools\who.ps1` 确认面板在最上层、无遮挡，再读像素。**

## 5. 实测几何基线（150% 缩放显示器）

| 窗口 | 物理 | CSS | 备注 |
|---|---|---|---|
| 主控台（大面板） | `(641,338)-(2343,1551)` = 1702×1213 | **≈1135×809** | manifest `window:{1120,800}` 是 **CSS 逻辑 px**（Tauri `LogicalSize`）；`>760` ⇒ 侧栏生效 |
| 迷你面板 | 615×916 | **410×610** | 宽固定 410；高由宿主 `fit_mini_window_height` + `ResizeObserver` 动态调，**变化 >250px 才重新适配** |
| OSD | 520×96 | — | `OpenRevo OSD` |
| 隐藏助手 | 1280×745 | — | `tray_icon_app`，无绘制 |

## 6. 度量管线（PIL）

```python
# 1) 调色板直方图：看主色占比、检查宿主色是否为 0
# 2) 列/行亮度边缘：对每列(行)求均值，找相邻差尖峰，物理坐标 ÷1.5 转 CSS
# 3) 与预览对齐：dx 0..26 / dy 0..34 物理像素搜索，取 MAE 最小；再按条带分别报 MAE
# 4) ASCII 渲染：看结构（顶部横贯纹理 vs 左侧亮块）
```

**实测基线（可作为回归参照）**

* 主控台 `_shots/real-dash-1500.png`：
  `(32,32,32) 30.25%`、`(44,44,44) 19.04%`、`(41,41,41) 16.96%`、`(56,56,56) 6.08%`、`(40,40,40) 4.80%`、
  `(39,39,39) 1.89%`、`(74,74,74) 1.81%`、`(59,59,59) 1.66%`、`(63,63,63) 0.92%`；
  **宿主色全部 0**；列边缘 CSS `224.7/225.3`（= `--wf-sidebar-w:224px`）、`245.3/246.0`、668.7、676.7、1083.3、1100.0；
  与预览（`1120×800` @dsf1.5）对齐 dx=9 dy=0，**MAE 22.16**（左栏 16.48 / 内容 23.58 / 顶部100px 46.45 / 底部100px 9.90）。
* 迷你面板 `_shots/real-mini-clean.png`：
  `(44,44,44) 24.45%`、`(32,32,32) 18.61%`、`(56,56,56) 14.06%`，宿主色 ≈0，与 `preview-mini.html` **MAE 19.98**；
  右缘滚动条槽 CSS `402.7~406.7`、滑块高约 302 CSS ⇒ 反推 `scrollHeight ≈ 1180~1230`。

## 7. 收尾清单（每次真机取证后必做）

1. `config.json` 里临时改过的字段**还原**（本次是 `wake_window_mode` → `"mini"`，备份 `config.json.bak-skinverify`）。
2. 提权重启宿主一次（`kill-and-start.ps1`），确认 mini 窗口回到隐藏待唤醒状态
   （本次：`hwnd=10684400`、`615×916`、`vis=False`）。
3. 确认 `active_skin` / `active_background` 仍是**用户自己选的那套**，不要替用户改选择
   （当前实测两者均为 `null` —— 皮肤与背景都没装）。
4. 删掉中间废图与临时 Chrome profile（`_shots/mg-*.png`、`mv-*.png`、`real-dash2.png`、`_shots/prof-*`）。
5. 若曾设置过 `HKCU\…\WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`（CDP 调试题），**删掉**——
   该环境变量在 Tauri/wry 下是被忽略的死路，留着只会误导下一次排查。
6. 校验安装产物：`<id>\theme.css` 与已装副本逐字节一致（前提是皮肤产物还在；当前已删，见 `SKILL.md` §0.1）。
7. **把抓图时唤醒的大面板收起**（`wake-grab-dash.ps1` 不还原停车位置，见 §9 末条）——
   否则它会一直留在桌面上。

## 8. 已知无法做的事

* **本机模型不能读图**——已于 2026-10-04 实测复现，原文：
  `cannot read "<path>" as an image: model "cn:deepseek-v4.1-flash" does not declare image input; switch to an image-capable model to read images`
  → 一切观感问题必须转成数字/ASCII 后判断，不要试图「看一眼图」。
* Tauri 窗口不能最小化（差分无效）。
* CDP 调试端口路线不通（`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 在 wry 下无效）。

## 9. 真机截图**不能**用来判别「换肤是否生效」（2026-10-04 实测结论）

* **同源性事实**：镜像树旧 ID 皮肤 `dist/win11-fluent-dark/theme.css` 与本仓库新 ID 皮肤 `skin-win11-dark/theme.css`
  都是 1292 行、都含 374 个 `--wf-*` 令牌、色字面量计数完全相同
  （23×`#60cdff`、8×`#ffffff`、4×`#ff9d5c`、4×`#ff99a4`、4×`#cbd5e1`、4×`#6ccb5f`）；
  裸 diff 440 行**全是 ID/命名空间字符串与生成头**，把 ID 归一成同一串后 **diff = 0 行**。
  ⇒ 那一轮"把 `win11-fluent-*` 改名为 `skin-*`"是**行为中性**的：外观逐像素不会变。
* 因此「运行中的宿主是否已应用新皮肤」在**像素上不可判别**，用截图去证明或推翻它都是伪命题。
  要判断只能看宿主进程内存态/启动时机（宿主 `09:48:00` 启动，而新目录 `mtime 10:06:03` ⇒ 冷启动时枚举到的是旧 ID 那批）。
* **做过的量化 A/B（同一块大面板 `1702×1213`，10-03 19:42 旧图 vs 10-04 12:16 新图）**：
  MAE 全图 **2.59**、左栏 `0~336px` **1.00**、顶部 `0~150px` **1.30**、内容 `337~1702px` 2.99；
  差异 >40 的像素占 2.845%，行尖峰 `y≈750 / 800 / 850`；今日独有色 navy `(16,32,64)±14` 占 1.686%，
  bbox `(379,759)-(1659,872)` ⇒ **差异全在内容区（图表数据带），皮肤外壳不变**。
* **正控选择教训**：招牌色 `#60cdff` / `#ff9d5c` 在两套真机图上**精确命中都是 0 px**
  （±6 容差也只有 9/13 px 与 0/0 px，全是抗锯齿边缘）——大面板外壳**不用** accent/important 做平涂，
  所以「找招牌色」不能当正控。真机正控要挑外壳真的平涂的一档（侧栏/顶栏的 `(32,32,32)`、`(44,44,44)`）。
* `census.py` 的色族数**不是皮肤判据**：今天 10 族/有色 8.52% vs 旧图 9 族/3.01%，多出来的全是内容区动态图表
  （仅 navy 数据带就 1.686%）。只有当"无色占比 / 外壳色档位"变了才说明皮肤层变了。
* **抓图副作用**：`wake-grab-dash.ps1` 只还原 z 序（`HWND_NOTOPMOST`），**不还原停车位置**——
  抓完大面板会留在桌面上（本次 `hwnd=12390158` 停在 `(581,189)-(2283,1402) 1702×1213`，
  抓前它停在屏幕外 `(-32000,-32000) 237×39`）。收尾要么手动收起面板，要么显式记录这条副作用。
