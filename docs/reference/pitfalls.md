# 踩坑总表

按「现象 → 原因 → 对策」排列。序号用于交叉引用。

| # | 现象 | 原因 | 对策 |
|---|---|---|---|
| 1 | 运行时启用 `<link disabled>` 后，**已存在**的元素保持旧样式 | 样式表启用是异步的，元素不会立刻重算 | 用 `<style>.textContent` 注入（宿主就是这个做法）；若非要 `<link>`，必须等 `load` 之后再采样 |
| 2 | 无头截图拍到过渡中间态，同一份 CSS 两次结果不一样 | 无头渲染帧数不足，transition 停在起始值 | 加 `?notrans=1` 关过渡，并给 `--virtual-time-budget` |
| 3 | 无头结果不可复现 | Chrome 复用了 profile 缓存 | 每次 `--user-data-dir=$(mktemp -d)` |
| 4 | `file://` 下读 `cssRules` 抛 `SecurityError` | 跨文档样式访问被禁 | 加 `--allow-file-access-from-files` |
| 5 | 数「灰色像素」就断定不透明 —— 结论不可靠 | 灰色可能纯属巧合 | 用**背景交换差分**（棋盘格 vs 纯色底两图逐像素相同）或**宿主色计数为 0** |
| 6 | 预览里迷你面板撑满浏览器，而不是 410×610 | 舞台用了内联 `width:100vw;height:100vh` | 预览专用 `.pv-stage .mini-drawer-root{width/height:100%!important}` |
| 7 | 装完皮肤，宿主里「皮肤没生效」 | **宿主在启动时枚举插件目录**，运行中的进程比插件文件老 | 比进程 `StartTime` 与插件目录 mtime（`_tools\when.ps1`），提权重启。（**0.8.8 更新**：皮肤/背景 CSS 已改为按需注入；**`v0.8.8-dbfe615` 起【刷新】本身就热重载当前样式**（重放 `onApplySkin`/`onApplyBackground`），所以**点一次【刷新】即可**，不必拨开关、不必重启。⚠️ 早于该构建的【刷新】只重扫列表，那时需「刷新 + 拨开关」。另：宿主更新后 `VersionInfo` 仍报旧版本号，**判更新要看构建号**。见 `plugin-dev-0.8.8-skill.md` §4/§9） |
| 8 | 真机截图里出现不属于皮肤的纯色块 | 别的窗口盖在上面（本次是 QQ：`pid=13556 class='Chrome_WidgetWin_1' rect=(569,237)-(2230,1273)`） | 抓图前用 `_tools\who.ps1` 确认 z 序/遮挡；别用 `WindowFromPoint` 当 z 序证据（它跳过 Tauri 分层窗口） |
| 9 | `PrintWindow` 抓 Tauri 窗口得到全 alpha=0 黑图 | Tauri 窗口是透明/分层表面 | 放弃 `PrintWindow`，用**提权 TOPMOST + `CopyFromScreen`** |
| 10 | `SetWindowPos(HWND_TOPMOST)` 返回 False / 没效果 | 宿主 `requireAdministrator`，UIPI 拦截非提权调用 | 抓图脚本提权运行 |
| 11 | 用移动/最小化差分算出的「窗口区域」是假的 | `show-app.ps1` 只 show 不置顶 → 拍到的是我自己的浏览器；Tauri 窗口又无法最小化 | 别用差分；先置顶再抓 |
| 12 | 抓主控台得到全黑图 | 宿主把隐藏的大面板**停车在 `(-32000,-32000)` 并缩到 `237×39`** | 先唤醒（启动第二个实例 / `wake-grab-dash.ps1`）再抓 |
| 13 | 对 `tray_icon_app` 窗口 `ShowWindow` 后拍到桌面壁纸 | 那不是面板窗口，无绘制 | 不要用它 |
| 14 | 改了 `wake_window_mode` 没效果 | 该字段**只在启动时读一次** | 改完必须重启；用完必须还原并留备份 |
| 15 | 想「看一眼」截图却报 `does not declare image input` | 本机模型没有图片输入能力 | 一律转数字/ASCII 判据 |
| 16 | PS 报 `Get-Process : 无法对参数 Name 执行参数验证。参数为 Null 或空`；或整段 `表达式或语句中包含意外的标记"}"` / `ExpectedValueExpression`，行号指向**文件末尾一个无关的 `}`** | PS 5.1 按 GBK 解码**无 BOM** 的 `.ps1`（UTF-8 中文注释里的引导字节吞掉后面的引号，语法树从此错位） | 脚本存成 **UTF-8 BOM**；**整文件重写会静默吃掉 BOM**——21 个 `_tools\*.ps1` 里唯一没 BOM 的正是被整体重写过的那个。改完必须复验 `head -c3 x.ps1 \| od -An -tx1` 得到 `ef bb bf`，再跑 `[Parser]::ParseFile` 确认 0 error |
| 17 | P/Invoke 读窗口标题/类名只得到首字符 | 缺 `CharSet = CharSet.Unicode` | 声明里补上 `CharSet = CharSet.Unicode`（`_tools\wins.ps1:11-12` 即正确写法） |
| 18 | `taskkill /F /PID` 拒绝访问 | 进程 manifest 是 `requireAdministrator` | 提权 `Stop-Process -Id … -Force` + `Start-ScheduledTask OpenRevo` |
| 19 | CDP 调试端口连不上 | wry/Tauri 忽略 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` | 放弃该路线；顺手删掉 HKCU 里那个环境变量，免误导 |
| 20 | 按偏移解 brotli「成功」但内容是垃圾 | **brotli 没有魔数**，错位也能解出东西 | 解压后校验产物（开头合法、规则条数、关键类名可 grep），每次宿主升级重新定位偏移 |
| 21 | 皮肤里 `@import` 无效 | 注入点在宿主文档，base URL 是 `tauri://` | `theme.css` 必须单文件 |
| 22 | 版式错位、滚动条莫名出现 | ⚠️ **旧归因已作废**：宿主**有**全局 `*{box-sizing:border-box;margin:0;padding:0;user-select:none}`（0.8.7/0.8.8 逐字节相同，紧跟 `:root`），不需要自己声明 | 别重复声明 `box-sizing`；`.mini-drawer-root` 不加 `border` 的理由是**纵向余量只剩 11px**（见 #26），描边用 `box-shadow: inset 0 0 0 1px …` 画（`--wf-window-stroke`） |
| 23 | 皮肤普通选择器压不过宿主 | 宿主用 React 内联 `style={{…}}` 写死属性 | author `!important`（胜过普通声明，也包括内联） |
| 24 | 迷你面板强调色变成宿主 mono 的白色 | 宿主在 `.mini-drawer-root[data-theme=mono\|cyber]`（0,2,0）**局部重声明** `--theme-*`；元素上的局部声明胜过继承 | 皮肤在 `[data-skin="X"] .mini-drawer-root[data-theme]`（0,3,0）重声明面板令牌，值读 `--wf-hue-*` 镜像 |
| 25 | 预览里按钮渲染成 `buttonface rgb(240,240,240)` / `buttontext rgb(0,0,0)`，且与内联样式无关 | 同第 1 条：`<link>` 启用遗留了未重算的元素（已排除宿主干扰、缺令牌、内联覆盖、选择器被丢、解析错误、禁用表） | 改成 `<style>` 注入后消失；排查时先记住宿主**没有** `button` 规则、也没有 `#f0f0f0` 字面量 |
| 26 | 迷你面板底部多出一条细横向滚动条 | 皮肤把滚动条从 4px 加宽到 12px；而宿主自身内容 **410×621** CSS > 窗口 610，纵滚本来就存在（余量仅 11px） | 加 `overflow-x:hidden !important` 或收细滚动条（本项目用户选择先看观感，暂未改） |
| 28 | 昨天还好好的脚本/偏移，今天全部解不出来 | 宿主**自我更新并重启**：exe 被替换（本次 8,490,496 → 8,496,640 B）、资产偏移整体平移、JS 切片改名 | 动手前先比 exe 的 mtime/大小与进程 `StartTime`；用**文件名里的内容哈希**判断 CSS 是否变化；偏移一律现算 |
| 29 | `brotli.decompress(切片)` 报 `brotli.error: decoder failed` | 切片里多带了流尾之后的数据（或多/少一个字节）；**brotli 流没有终止魔数**，只有精确边界才解得出 | 用 `brotli.Decompressor` 增量喂到 `is_finished()`；先粗后细在 `[err_at, err_at+CH]` 区间里定位精确流尾 |
| 27 | 照手册 §7 写的 `.overview-main-grid` 等类名毫无效果 | 这些示例类名在发行版**不存在**（WebView2 V8 代码缓存 72 个文件逐字检索命中 0） | 以 `_extracted\index-*.css` 真值 + 代码缓存交叉核对为准 |
| 30 | 写了 `box-shadow: 0 0 5px var(--wf-accent-glow)`，审计里 `box-shadow` 显示 `none`，且**控制台无任何报错** | `--wf-accent-glow` **根本不存在**。引用未定义的变量会让整条声明在 computed-value 阶段变 invalid 而静默退化成初值 —— 浏览器不报 warning | accent 的合法令牌只有 `--wf-accent` / `-hover` / `-press` / `-soft` / `-soft-strong` / `-border` / `-strong` / `-shadow` / `-on-accent`；发光用 `--wf-accent-shadow`。定期 grep `var(--wf-[a-z-]+)` 与 `token_block()` 的实际发牌比对 |
| 31 | `print(f'…#%02x…%6.2f%%' % q)` 抛 `ValueError: incomplete format` | f-string 与 `%` 格式化**混用**：结尾那个字面 `%` 被 `%` 运算符当成转换符起点 | 二选一。要用 `%` 就全用 `%`：`print('#%02x%02x%02x %7d %6.2f%%' % (…))` |
| 32 | 色相族普查把带一丝紫的近白 `#f4f0f5` 也数成一个独立色族 | 判「无彩」用了 HSL 的**饱和度** S，近白时分母极小使 S 虚高（`#f4f0f5` 的 S≈0.2） | 改用**绝对彩度** `max(r,g,b) - min(r,g,b) < 24`（`census.py` 的 `DELTA_MIN`；`audit.sh` 里同阈值） |
| 33 | 迷你面板像素普查里一直多出 1~2 个色族，怎么改 CSS 都消不掉 | 多出来的族来自**预览页自己的夹具**（`SAFE MOCK` 徽标、六色令牌探针卡、隐藏的档位激活态按钮），不是宿主 UI | 给夹具打 `data-pv-fixture` 标记 + `?nofix=1` 隐藏后重截（`_shots\<id>-clean.png`），DOM 普查里 `if (n.closest('[data-pv-fixture]')) return` |
| 34 | 审计里的 `content.size` / `scrollHeight` 比真实值大几十 px，且四套变体都一样大 | **诊断代码污染了被测对象**：审计里那段「决定性实验 A~J」会往 `.m-grid-4` append 新按钮、clone 节点、重新挂载，把内容撑高 45px（666 vs 真实的 621） | 诊断实验只准**读**，不准改 DOM；确需改就在 `finally` 里还原。问题查清后**把实验代码删掉**，只有读操作的探针可以留 |
| 35 | 换了别的皮肤产物后，某个变体的审计文件里全是宿主原色（`#38bdf8` / `rgba(99,102,241,.25)` / 纯白），但 `dom.hueFamilies` 仍是 2，看着「通过」 | 原归因「那是上一次运行的陈旧产物」**已被证伪**：同一现象在并发压测里当场复现（见 #39），是样式失效竞态，不是读旧文件。`hueFamilies` 恰好为 2 掩盖了它 —— 这一半仍然成立 | 断言必须带**正向条件**（`mini.--theme-pwr` = 该变体 important、`ready.dot.bg` = accent），只靠「族数 = 2」这种负向条件会放过它；根因与修复见 #39 |
| 36 | 改项目根目录名一律 `Device or resource busy`（连试 10 次全失败），子目录却能改 | Windows 拒绝 rename 任何进程的**当前工作目录**，**包括你自己这条命令的 shell**；DSH 的 bash 工具默认 CWD 就是会话工作区（= 项目根），所以 `cd <项目> && mv …` 是纯粹自我阻塞 | 从项目外面执行并显式指定工作目录（DSH 用 `workdir=<父目录>`），改跑 `_tools\rename-project.ps1`。用 `_tools\who-locks.ps1` 分类：CWD 表非空 = 第一类（关掉那些进程即可）；CWD 表为空仍失败 = 第二类（句柄占用，必须提权用 `handle.exe` 查） |
| 37 | 改了 `%APPDATA%\OpenRevo\config.json` 的 `active_skin`，几分钟后又被改回旧值 —— 而且**没人碰它也会自己变**：2026-10-04 实测两次（10:13:06、11:26:44），宿主自 09:48 起**未重启、期间无任何外部改写** | 宿主（Tauri）运行中持有**权威内存态**，会**周期性整份回写** config，把外部改写冲掉；回写不依赖任何外部动作 | **只在宿主停机时改**，顺序是「停 → 改 → 启」，已封成 `_tools\set-active-skin.ps1`（宿主没停掉就拒绝改、目标皮肤不存在就拒绝改、只替换一个字段、改完回读复验）。改完判断是否被回写：比较 `(Get-Item config.json).LastWriteTime` 与**字节大小**（11:26:44 那次大小 3680 = 备份 `config.json.bak-skinrename` 的 3680，内容原样）。⚠️ 别把 `models.json` 当必要条件 —— 10:13:06 那次它与 config 相差 1.5 s 一起落盘，但 11:26:44 那次**只有 config.json 被写**（models.json 仍停在 10:13:04） |
| 38 | 用 DSH 的 `edit` / `write` 工具改完 `_tools\*.ps1`，脚本突然报 4 条 PS 语法错误（`表达式或语句中包含意外的标记` / 缺少右括号 / 字符串缺少终止符 / 语句块缺少右括号） | **这套写文件的工具会把文件开头的 UTF-8 BOM 静默丢掉**（2026-10-04 实测：同一个文件改前 `head -c3` = `ef bb bf`，改后 = `23 20 72`），于是直接掉回 #16 的 GBK 解码错位 | 改完 `.ps1` **立刻**复验 `head -c3 x.ps1 \| od -An -tx1` 必须仍是 `ef bb bf`，缺了就地补回（`python -c "p='x.ps1'; d=open(p,'rb').read(); open(p,'wb').write(bytes([0xef,0xbb,0xbf])+d)"`），再跑 `[Parser]::ParseFile` 确认 0 error。**不要**用「我只是改了注释」推断 BOM 还在——丢 BOM 与改了什么内容无关 |
| 39 | 迷你面板审计偶发读到宿主原色：`quickActive.bg` = `rgba(255,255,255,.14)`（宿主 mono 的白）、`themeBtn.cyber` = 内联青 `#38bdf8`，而同一份 DOM 里 `ready.dot` / OEM 徽标 / `--wf-*` 令牌都已生效；24 并发 × 6 的压测下复现率 ≈ 17%（这次只有 4/24，看着像「偶发噪声」） | 无头 Chrome 注入 `<style>` 之后，**在解析期就完成过样式解析**的那部分元素偶发不被重新失效、保留旧值 —— 样式失效(invalidation)竞态，与页头注释里那条「事后启用 disabled 样式表不触发重算」的缺陷同类。已逐个排除：不是样式表被截断（`sheet[2] rules=118` 与通过态逐字段一致）、不是读到陈旧产物（`audit.sh` 每次 `>` 重写产物，且压测是当场新起 Chrome）—— 即 #35 的原归因不成立。同压测下主窗 `preview.html` 24 次 0 次异常（它的 `data-skin` 挂在 `<html>` 上，属性变更作用于整棵树） | ① 页面侧确定性收口：`preview-mini.html` 的 `activate()` 末尾调 `settleStyle()` —— `data-skin` 落定后把舞台子树原地 `removeChild` + `insertBefore` 一次，强制整棵子树重解析（视觉零差异；审计产物新增 `settle.remounts` 计数，非 0 即说明当次踩到过）。② 回归压测：`PAGES=preview-mini.html:mini bash _tools/_stress.sh 48 8`（逐次与单跑参考逐行 diff，末尾报「异常 N 次」）。③ 实测：修复前 24 次异常 4 次、修复后 48 次 0 次、把 `settleStyle()` 注释掉的同一份页面 24 次异常 4 次（A/B 对照确认起作用的就是这一步） |
| 40 | 市场（`tab` 插件）里点【安装】想直接下载并装好 —— 做不到 | 0.9.1 宿主**没有任何安装/写盘 IPC**：`install_plugin` / `uninstall_plugin` / `remove_plugin` / `reload_plugin` / `write_file` / `write_text_file` / `read_text_file` / `create_dir` / `fs::write` 在 exe 与前端 JS 里**全 0 命中**；Tauri 侧只挂了 `autostart` 与 `single-instance`，**没有** `fs` / `dialog` / `shell` / `opener`；`tab` 的 iframe 沙箱 `allow-scripts allow-forms allow-same-origin` **不含 `allow-downloads` / `allow-popups`** ⇒ 下载与 `window.open` 都被浏览器层拦死 | 别在 UI 里承诺做不到的事：给**可复制的 PowerShell `git clone` 命令** + 复制按钮 + 打开插件目录 + 回插件页刷新，并在弹窗里**明说「本版宿主没有开放安装接口」**。缺哪些接口与建议签名见 `market-host-constraints.md` §3 与桌面《OpenRevo 插件市场-宿主缺失接口清单》 |
| 41 | 改了 `market/src/*`，装进宿主却**没变化** | `plugin-market/index.html` 是 `build_market.py` 生成的**单文件产物**，手改产物无效；且 `tab` 插件用 `srcDoc` 注入，基准 URL 是宿主文档（`tauri://localhost`）—— 任何 `<link>` / `<script src>` / `<img src="assets/…">` / `@import` 都取不到插件目录里的文件 | 只改 `market/src/`，改完 `python build_market.py --install`，再 `bash _tools/market-verify.sh cyber`（另跑 `mono`）；产物必须**单文件**（构建期会断言零外部引用）。装完回宿主【插件】页点一次【刷新】 |
| 42 | 删了 `skin-*\` 目录后跑 `_tools/verify.sh` / `audit.sh`，审计里 `rules_applied = none`、大片断言失败，看着像「皮肤 CSS 坏了」 | 这两个脚本按 `<skin_id>/theme.css` **逐个变体取样式**（`audit.sh` 默认四套 ID，`preview.html` 用同步 XHR 读 `<id>/theme.css`）。2026-10-17 四套皮肤产物已从仓库删除 ⇒ 取不到文件，皮肤根本没被注入 | 这是**输入缺失**，不是样式问题：先 `python build_skins.py` 重建四套产物，再跑验收。工具链保留正是为此（`build_background.py` / `bg_common.py` 也 `import build_skins`） |
| 43 | 市场卡片把「未扫描能力」显示成「未检出」，读者以为「检查过，很干净」 | 能力披露是**三态**不是布尔：`[...]` = 扫过并检出 / `[]` = 扫过未检出 / `null` = **没扫过**。爬虫不做真实扫描，若图省事写 `[]` 就等于撒谎 | 爬虫一律写 **`null`**，UI 渲染成「未扫描」。同理 `stars` 取不到写 **`null`** 而不是 `0`（排序放最后，别读成「比 0 还不受欢迎」）；在线目录拉不到**保留兜底数据并如实写明失败原因**（`未连上在线目录：HTTP 404`），绝不把「没连上」伪装成「目录是空的」 |

## 一句话教训

* **量到的才算证据**：模型看不了图，就用直方图、列行边缘、分块 MAE、ASCII。
* **先确认在跟谁比较**：任何真机截图先确认窗口在最上层、没有遮挡、确实是目标窗口（标题 + 宽度 + 几何）。
* **宿主是唯一真值**：手册、样例、我的猜测都不是。
* **改完要还**：`config.json` 改了什么，最后就还原什么。
