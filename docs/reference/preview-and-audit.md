# 预览与无头审计（preview & audit）

预览页是这套流程的**主力验证手段**：它用**真实宿主类名 + 真实宿主 CSS** 在浏览器里复刻两个面板，
所以「在预览里量到的 computedStyle / 像素」可以拿来推断宿主行为，只有版式级别的东西才需要真机复核。

## 1. 两个预览页

| 文件 | 复刻对象 | 说明 |
|---|---|---|
| `preview.html` | 主控台（`.acrylic-container`） | 546 行 / 32,505 B（2026-10-03 核对）；含 8 个 tab 的静态内容 |
| `preview-mini.html` | 迷你面板（`.mini-drawer-root`） | 44,835 B；逐字复刻真实 DOM（含内联 `background:rgba(12,15,22,.96)`） |

共同点：

* `<head>` 里加载 `_extracted/host-shell.css`（**真实宿主 CSS 子集**，14,584 B / 86 行，从 exe 抽出），
  确保「对手规则」是真的。**宿主升级后这张表要重新抽**——见 `host-truth-extraction.md` 与 `devlog.md` §9。
* `<html data-theme="mono">`，模拟宿主默认主题，这样皮肤的镜像令牌方案才会被真正考验。
* 舞台后面放**棋盘格底图**：任何半透明都会透出棋盘格，肉眼和直方图都能抓到。
* `activate(id)`：

  ```js
  // 用同步 XHR 读 <id>/theme.css，然后注入 <style id="openrevo-custom-skin">
  ```
  与宿主的注入路径一致（`<style>.textContent`）。**不要**改成 `<link disabled>` 切换——那样已存在的元素不会重算样式
  （见 `pitfalls.md`）。

## 2. URL 参数

| 参数 | 作用 |
|---|---|
| `#<skin_id>` | 初始激活哪套皮肤，例如 `preview.html#skin-win11-dark` |
| `?notrans=1` | **关掉所有 CSS 过渡/动画**（截图与审计时必须加，否则会拍到过渡中间态） |
| `?audit=1` | 打开审计钩子：把一批 computedStyle 结果以 `AT_AUDIT_BEGIN … AT_AUDIT_END` 注释块写进 DOM，供 `--dump-dom` 抓取 |
| `?allactive=1` | 把所有 `:hover/:active/.active` 状态强制打开，便于一次看完交互态 |
| `?bare=1` | 只留舞台，去掉外层 chrome |
| `?bgprobe=1` | 背景探针：把舞台底色换成纯色/棋盘格，用于**背景交换差分**判不透明 |
| `?nofix=1` | 隐藏所有 `[data-pv-fixture]` 夹具（`SAFE MOCK` 徽标、六色令牌探针卡、隐藏的档位激活态按钮）。**跑色相族普查时必须加**，否则夹具的颜色会被算成皮肤的色族 |

## 3. 无头 Chrome 命令

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"

# 截图
"$CHROME" --headless=new --disable-gpu --no-first-run \
  --user-data-dir="$(mktemp -d)" --hide-scrollbars --virtual-time-budget=3000 \
  --window-size=1240,900 --allow-file-access-from-files \
  --screenshot="D:\\…\\_shots\\out.png" \
  "file:///D:/…/preview.html?notrans=1#skin-win11-dark"

# computedStyle 审计（用 --dump-dom + 标记块提取）
"$CHROME" … --dump-dom "file:///D:/…/preview.html?notrans=1&audit=1#skin-win11-dark" \
  | sed -n '/AT_AUDIT_BEGIN/,/AT_AUDIT_END/p'

# 按真机缩放比渲染（真机 dsf=1.5；1120×800 CSS → 1680×1200 物理）
"$CHROME" … --force-device-scale-factor=1.5 --window-size=1120,800 …
```

* `--user-data-dir` 必须是**全新的临时目录**，否则会复用缓存。
* 需要 `--allow-file-access-from-files`，否则 `file://` 下跨文档访问 `cssRules` 会抛 `SecurityError`。
* `--virtual-time-budget=3000` 给足渲染时间；**仍要加 `?notrans=1`**，双保险。
* 环境：`C:\Program Files\Google\Chrome\Application\chrome.exe`、Python 3.14.6 + Pillow 12.2.0、屏幕 2560×1600。

## 4. 现成脚本（`_tools\`）

| 脚本 | 作用 |
|---|---|
| `verify.sh` | **验收总闸**：先重跑两页审计，再把「审计要看的字段」（§6）逐条断言，末尾报「合计 N 条断言，失败 M 条」。默认全跑；`NO_AUDIT=1` 复用已有产物快速复检。**交付前只认这个的 exit code** |
| `audit.sh` | `PAGE=preview-mini.html` → 对四套变体跑 `?audit=1` → `_audit/mini-<id>.audit.txt`（改 `PAGE` 可审计主控台） |
| `_stress.sh` | `PAGES=<page>:<tag> bash _tools/_stress.sh [N] [并发]`（如 `PAGES=preview-mini.html:mini bash _tools/_stress.sh 48 8`）：先单跑一份参考，再并发 N 次逐次 `diff`，末尾报「异常 M 次」。**偶发竞态只能靠它抓**（顺序连跑抓不到，见 pitfalls #39） |
| `shots.sh` | 批量出四套变体的截图（含 `<id>-clean.png` = 加了 `?nofix=1` 的清洁图，供 `census.py`） |
| `shoot1.sh <page> <name> <w> <h> <query> <skin\|off> [dsf]` | 单张截图，参数化页/尺寸/皮肤/缩放 |
| `cmp.py` / `prof.py` / `ascii.py` | 分块 MAE 对比 / 调色板直方图 / ASCII 渲染 |
| `census.py <png…>` | **像素级色相族普查**：环形贪心聚类（容差 30°）把图里所有有色像素归成色族，报族数、每族色相/占比/代表色。验收「只剩两个强调色」的物证 |
| `repro-btn.html` | 最小复现页（曾用于定位 `buttonface` 悖论），已确认行为正确 |
| `allwins.ps1` | 列出所有可见顶层窗口：`hwnd / pid / 进程名 / class / title / 物理 rect`（DPI 感知；P/Invoke 带 `CharSet=CharSet.Unicode`） |
| `restart.ps1` | 打印 `OpenRevo` 计划任务状态与前后 pid，并 `Stop-ScheduledTask` / `Start-ScheduledTask` 一轮 |

抓**真机窗口**的脚本（`who.ps1` / `when.ps1` / `listwins.ps1` / `wake-grab-dash.ps1` / `pin-grab-hwnd.ps1` /
`grab.ps1` / `capwin.ps1` / `min-grab.ps1` / `move-grab.ps1` / `kill-and-start.ps1` …）与取舍见
`real-machine-verification.md` 第 3 节——**那里才是抓图脚本的主表**。
`restart.ps1` 用的是 `Stop-ScheduledTask`：进程若没被真正结束，脚本会因为 `after stop pids` 非空而**跳过重启**，
所以本项目真正可靠的路径仍是提权 `kill-and-start.ps1`（`Stop-Process -Force`）。

## 5. 判据（怎么用数字代替肉眼）

因为**本机模型没有图片输入**（`read_image` 直接报 `does not declare image input`），
所有「看起来对不对」都必须转成数字或 ASCII。四条经过实战的判据：

1. **不透明**：不要数灰色像素（灰色可能只是巧合）。用**背景交换差分**或**宿主色缺席**：
   * 背景交换：同一皮肤分别以棋盘格/纯色底渲染，两图**逐像素相同** ⇒ 该区域不透明。
   * 宿主色缺席：宿主自己的调色板（主控台 `(11,13,17)/(16,18,25)/(26,28,35)`；迷你 `(18,22,32)` 系列）
     在同一张图里**计数为 0** ⇒ 没有露出宿主底色。
2. **版式（侧栏是否生效）**：算**列亮度边缘**（对每列求均值，找相邻列差的尖峰），再把物理 x 换算成 CSS x
   （÷1.5）。真机主控台在 CSS `224.7 / 225.3` 的强边缘 = 224px 侧栏存在。
3. **与真机的一致性**：把预览按真机 dsf 渲染，裁出真机 client 区，做**对齐搜索**（dx 0..26 / dy 0..34 物理像素）
   取 MAE 最小者，再按条带（左栏/内容/顶部/底部）分别报 MAE。**只有分带 MAE 才有诊断力**，全局 MAE 会被大片背景稀释。
4. **文字级细节**：`ascii.py` 把图降采样成字符画，能看出「顶部是一条横贯全宽的抖动纹理」还是「左侧一块亮块」这类结构差异。
5. **配色族数（二色纪律的物证）**：两路互相独立——
   * **DOM 路**：`audit.sh` 里的色彩普查。遍历带内联 `color` / `background` 或 `--theme-*` 的元素，
     `Math.round(h/30)*30 % 360` 分桶，输出 `dom.hueFamilies`。判「无彩」用**绝对彩度** `max-min < 24`
     （**别用 HSL 的 S**：近白 `#f4f0f5` 的 S≈0.2，会凭空多出一族）。
   * **像素路**：`python _tools\census.py _shots\mini-<id>.png`。先 `?nofix=1` 出清洁图，再数色族。
   两路都应报 **2**（迷你面板）/ **2**（主控台：accent + 4 个 8px 状态点绿）。
   只看「强调色用了哪个 hex」不够 —— 同色相不同明度会被算成同一族，那正是我们要的结论。

## 6. 审计要看的字段（四套变体都应满足）

* `root.bg` = 该变体实色（深色 `rgb(32,32,32)`），`root.blur` = `none`。
* **二色体系**：`dom.hueFamilies = 2`；六个 `--theme-*` 槽位里只有 `--theme-pwr` 是暖橙
  （`#ca5010 / #ff9d5c / #d83b01 / #ff8c00` 四套各不同），`--theme-gpu/hz/lux/kbd/bat` **全等于** `--wf-accent`，
  **不是**宿主 mono 的 `#ffffff`；`--accent-pwr = --accent-beast = --wf-important`、
  `--accent-gpu/-cool/-rgb/-lux = --wf-accent`。
* 内联色覆盖命中：`ready.dot.bg`=`rgb(accent)`、`themeBtn.cyber`=accent 三件套、
  `oem.running`=important 三件套、`oem.blocked`=accent 三件套、`sponsorHeart.col`=`rgb(accent)`。
* `.m-quick-btn.active` 的 `background` = 皮肤强调色 14% 透明度（`border` 36%）。
* 没有任何元素停在 `buttonface rgb(240,240,240)` / `buttontext rgb(0,0,0)`。
* `--wf-sidebar-w` = `224px`，且 `@media` 回退在窄窗时把导航变回横条。
* **皮肤确实落地的物证（迷你）**：`skin_active` = 本变体 ID、`rules_applied = 118`、
  `sheet[2] rules=118 matchBtn=2`（解析器真留下了规则）、`settle.remounts = 1`、`content.size = 410x621`。
* ⚠️ **正向条件纪律**：**只看 `dom.hueFamilies = 2` 不算通过** —— 坏读数里全是宿主原色时，
  族数也恰好是 2（这是旧文档「陈旧产物冒充通过」的真相，见 `pitfalls.md` #35 / #39）。
  必须同时核对：本变体的 `--wf-important` / `--wf-accent`、`--theme-*` 六槽、
  `ready.dot` / `themeBtn.cyber` / `oem.*` / `sponsorHeart` 五个探针色值。
* 以上全部由 `_tools/verify.sh` 逐条断言（主窗 + 迷你各四套，共 132 条）。

## 7. 预览页维护注意

* `preview-mini.html` 的 `activate()` **不要**改回 `<link>` 方案。
* `activate()` 末尾的 **`settleStyle()` 不要删**：无头 Chrome 对「解析期就已经完成过样式解析」的元素
  偶发不重新失效（复现率约 17%，见 `pitfalls.md` #39），`settleStyle()` 把 `stageRoot` 原地摘挂一次强制重解析。
  它是页头注释里已实测可用的手段，视觉零差异；删掉它需要在 48×8 并发压测下证明「异常 0 次」，否则别动。
* 预览专用的 `.pv-stage .mini-drawer-root{width/height:100%!important}` 只属于预览页。
* **审计代码里只准有只读探针**。早期那段用于定位 `buttonface` 悖论的「决定性实验 A–J」（会 append / clone / 重新挂载节点）
  已于 2026-10-04 删除 —— 它把 `.mini-drawer-content` 撑高了 45px，让审计一直报 `content.size = 410×666`（真实 621）。
  要新加诊断，**只读**；确需改 DOM 必须在 `finally` 里还原，且问题查清后立刻删掉。见 `pitfalls.md` 第 34 条。
