# 市场前端四项整改：自适应布局、资源拆分、独立视窗、实时发现自动化

> **状态：待批准** —— 批准后按本文件实施。

日期：2026-11-02
基线：`e739bff`（market 收录 ec-config）
宿主实测版本：`PRO v0.9.5-52cee23`，`get_plugin_host_capabilities.host_version = 0.9.5`

## 1. 意图与为什么

用户提了四条痛点，我逐条在真实宿主里复现、取证，其中两条的根因与仓库文档里写的**不一样**：

| # | 用户说的 | 实测到的根因 |
|---|---|---|
| 1 | 常规窗口只能显示两个插件 | 宿主 150% DPI ⇒ 主窗内容区约 **791 CSS px**。`minmax(296px, 1fr)` 需要 908px 才放三列，所以恒为 2 列；且 `@media (max-width: 860px)` 会在面板被拖窄时直接压成 1 列 |
| 2 | 加载后所有代码挤在一个 html 里 | 前提来自 `docs/host-contract.md`「产物必须单文件」。**该前提经实测为假**：宿主能加载外链 CSS / JS / 相对图片 |
| 3 | 独立视窗有相当大的 bug | 市场 manifest **没有 `window` 声明**，宿主按默认 240×320 打开（实测 360×480 physical @1.5），且无标题栏 ⇒ 搜索框被裁、筛选条溢出、卡片半截、**无法关闭** |
| 4 | 「实时发现」改成切到 tab 自动触发并移除按钮 | 每次切回该 tab 宿主会**重建 iframe**（`loaded@` 时间戳变化），所以「页面加载」本身就是「切到这个 tab」的信号，不需要 visibility API |

### 1.1 第 2 条的关键取证

在 `%APPDATA%\OpenRevo\plugins\zz-probe\` 放了一个探针插件（`tab`），`index.html` 只用相对路径引用外部资源：

```
<link rel="stylesheet" href="style.css">     → 生效（标题浅蓝、深色底）
<script src="app.js"></script>               → 执行（写入时间戳）
<img src="assets/dot.png">                   → 渲染（红色方块）
fetch('style.css') / fetch('./manifest.json') / fetch('assets/dot.png') → 均 HTTP 200
```

tab 内嵌面板与「独立视窗运行」两条路径**都**成立。因此第 2 条可以真拆，而不是继续内联。

> 这同时意味着 `docs/host-contract.md` 里那条「`srcDoc` ⇒ 必须单文件」的结论**是错的**，必须改。`srcDoc` 的基准 URL 在宿主里被处理成了插件目录（或宿主注入了等效机制），实测行为为准。

### 1.2 第 3 条的关键取证

同一个探针插件声明了 `window: {width:1000, height:720, resizable:true, decorations:true}`：

- 弹出窗 = **1504×1127 physical**（≈1003×751 CSS，含标题栏与阴影）⇒ `manifest.window` 生效；
- 有**原生标题栏**（最小化/最大化/关闭）⇒ `decorations: true` 生效。

市场没声明 `window` ⇒ 默认 240×320、无标题栏。用户报的「关不掉」就是没有标题栏；「重复弹出」是关不掉之后反复点的连带表现（我连点三次，宿主只保留一个实例，本身是幂等的）。

### 1.3 独立视窗的运行上下文（第 4 问的答案，实测）

用第二个探针 `zz-probe2` 在弹出窗里读运行环境：

| 项 | tab 内嵌 | 独立视窗 | 对实现的影响 |
|---|---|---|---|
| `ctx` | `iframe`，`about:srcdoc` | **也是 `iframe`**，`about:srcdoc#/widget/<id>` | 弹窗不是顶层文档，`window.parent` 仍指宿主外壳 |
| 宿主桥 | `PARENT_TAURI` ✅ | **`PARENT_TAURI` ✅**，caps 返回 v0.9.5 / `can_install=true` | `hostInvoke()` 的 `window.parent` 路径**两条上下文都成立**，不用改 |
| `localStorage` | 可写 | **读到 tab 写入的值** ⇒ 同源共享 | 实时发现的 TTL 缓存**跨上下文共享**，弹窗再开不会重复打 GitHub |
| `data-theme` | `mono` | **`none`** | `syncTheme()` 在弹窗里取不到主题 ⇒ **必须降级**，见 §4.6 |

> 结论：独立视窗不是「装饰性窗口」，安装/卸载/能力位在里面都能用。真正要补的只有**主题降级**。

## 2. 目标 / 非目标 / 反目标

**目标**

- 常规面板（≈791 CSS px）显示 3 列；窗口拖宽到 4–5 列；极窄（独立视窗被拖到很窄）落 1 列，不再截断。
- 产物拆成 `index.html` + `market.css` + `market.js`（+ `manifest.json`、`README.md`），构建器同步改造，产物仍入库。
- manifest 补 `window`：大尺寸、可缩放、**有原生标题栏**，独立视窗可用可关。
- 「实时发现」移除按钮，改为进入即触发（带 TTL 缓存），结果以横幅呈现。
- 更正 `docs/host-contract.md` / `docs/maintenance.md` 里「必须单文件」的错误结论，并写清实测依据。

**非目标**

- 不改爬虫 `crawl_topic.py`、覆写层、目录校验器 E1–E15。
- 不改安装/卸载/启停/服务管理的 IPC 语义。
- 不做 i18n，不做主题新增。

**在范围内（评审补充）** —— 这三处会被拆分直接打断，不改就等于交付一个坏掉的仓库：

- `_tools/market-preview.html`：本地等价预览器。它 `fetch('../plugin-market/index.html')` 后塞进 `srcdoc`，拆分后相对路径会按 `/_tools/` 解析 ⇒ 样式与脚本全 404。
- `_tools/market-verify.sh`：验收闸断言 `data-act="live"` 存在并点击它。按钮移除后必然 FAIL。
- `_tools/install-market.ps1`：断言 `index.html` ≥ 20000 字节且「产物应为单文件」。拆分后 `index.html` 约 1 KB，安装器当场报错。
- `docs/submit-plugin.md`：给插件作者的页面里也写着「必须单文件」，与 §1.1 的实测结论相反。

**反目标（技术上完成也算失败）**

- 拆了文件但宿主里白屏（比如外链在某个宿主版本失效却没有降级）。
- 为了 3 列把卡片压到放不下徽章与按钮，出现文字叠字或按钮溢出。
- 独立视窗能开了但布局仍按宽屏写死，拖窄就崩。
- 「切到 tab 自动触发」变成每次切过去都打 GitHub，几分钟内撞限流 403。
- 文档继续写着代码里没有的行为。

## 3. 约束

- 宿主：`tab` 插件 iframe 无 `allow-popups` / `allow-downloads`；`window.confirm` 被静默拦（必须用页面内弹窗）。
- 外链资源已验证可用，但**不加 `type="module"`**：`market.js` 目前是普通脚本、依赖全局作用域与 `DOMContentLoaded`，改模块会牵出顶层 await 与加载顺序问题，收益为零。
- 目录内联（`const SEED`）必须保留：它是「在线目录拉不到」时的兜底。改为内联进 `market.js`（构建期替换同一个标记块）。
- `.gitattributes` 是 `* -text`，产物写入必须显式 `newline="\n"`（现有 `write_outputs()` 已如此，保持）。
- 产物入库：`plugin-market/` 仍要提交，`_tools/install-market.ps1 -Local` 依赖它。
- 版本号 `1.2.0` → `1.3.0`（行为与产物结构都变了）。

## 4. 怎么改

### 4.1 布局（`market/src/market.css`）

把「按视口断点写死列数」换成「按内容区宽度自适应」：

```css
.mkt-body { container-type: inline-size; }   /* 列数跟着内容区，不跟视口 */

.mkt-grid {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--mkt-card-min)), 1fr));
}

:root { --mkt-card-min: 232px; }
@container (min-width: 1180px) { .mkt-grid { --mkt-card-min: 252px; } }
@container (max-width: 560px)  { .mkt-grid { --mkt-card-min: 100%; } }  /* 极窄 → 单列 */
```

推算（内容区宽度 → 列数，gap 10px）：`791 → 3`、`1000 → 4`、`1180 → 4`、`1280 → 5`、`≤560 → 1`。

配套调整：

- **删掉** `@media (max-width: 860px) { .mkt-grid { grid-template-columns: 1fr } }` —— 它是窄面板塌成单列的主因。
- 卡片内部在 `--mkt-card-min` 收窄后要能自理：`.mkt-badges` 允许换行（应有 `flex-wrap`，核对后补）、`.mkt-card-foot` 的星标/作者/按钮允许折行、`.mkt-card-id` 已是省略号。
- `PAGE_SIZE` 保持 12：3 列 = 4 行，一屏可见，翻页不啰嗦。

### 4.2 产物拆分（`build_market.py` + `market/src/index.template.html`）

`index.template.html` 从「占位符内联」改为**普通外链模板**：

```html
<link rel="stylesheet" href="market.css">
...
<script src="market.js" defer></script>
```

`build_market.py`：

- `build_outputs()` 返回 `{"index.html": …, "market.css": …, "market.js": …}`；
- `market.js` 仍做 `embed_catalog()`（内联 `catalog.json` 为 `SEED`）；
- `write_outputs()` 写这四个文件 + `manifest.json` + `README.md`，全部 `newline="\n"`；
- `--check` 只做自检不写文件（行为不变）。

自检改造 —— 原来断言「零外部引用」，现在反过来断言「只引用这两个、且文件存在」：

| 检查 | 新口径 |
|---|---|
| 外部引用 | `index.html` 里允许且仅允许 `market.css` / `market.js` 两个相对引用；出现其它 `<link>` / `<script src>` / `<img src>` / `@import` ⇒ 失败 |
| 占位符 | 模板里不再有 `/*__MARKET_CSS__*/` / `/*__MARKET_JS__*/` |
| `SEED` | `market.js` 里 `const SEED = {` 必须已被目录字面量替换 |
| 既有 IPC 断言 | 全部保留（`id` 字段名、`archiveSubpath()`、能力位探测、禁硬编码版本号） |
| 新增 | `manifest.json` 的 `window` 必须存在且 `decorations === true`、`resizable === true` |

### 4.3 独立视窗（manifest）

```json
"window": {
  "width": 1120, "height": 780,
  "resizable": true, "decorations": true,
  "transparent": false, "always_on_top": false, "skip_taskbar": false
}
```

- `decorations: true` 是「关不掉」的正解（原生关闭按钮）。
- `resizable: true` 让用户自己拉；布局在 4.1 之后本就自适应。
- `skip_taskbar: false` 让独立视窗能在任务栏/Alt+Tab 里找到 —— 否则关不掉时更难找回。

### 4.4 实时发现自动化（`market/src/market.js`）

- **删** 工具栏里的 `data-act="live"` 按钮与它的 `bind()` 分支。
- 新增 `maybeAutoLive()`：`init()` 末尾调用（`fetchCatalog()` 之后，避免抢目录请求）。
  - TTL 5 分钟（`CONFIG.liveTtlMs = 5 * 60 * 1000`），结果与时间戳存 `localStorage`（键 `openrevo-market-live-v1`）；
  - TTL 内直接用缓存，不发请求；
  - 打 GitHub 失败时**不缓存失败**，只在横幅里如实写原因，并在下次进入时重试。
- 因为宿主每次切回 tab 会重建 iframe（§1.2 实测），「页面加载」= 「切到这个 tab」，无需 visibility API。
- 横幅 `liveBanner()` 增补「上次发现于 X」，并把原来的可点提示改成纯说明。
- `refreshAll()`（刷新按钮）**强制**重查一次实时发现 —— 这是移除按钮后唯一的手动重试入口，写进 meta 行提示。

### 4.5 工具链同步（评审补充，必做）

**`_tools/market-preview.html`** —— 从「拉 HTML 文本塞 srcdoc」改成**同源直接指向产物**：

- `iframe.src = '../plugin-market/index.html?<原有 query>'`，不再 `srcdoc`。同源前提下 mock 桥仍能挂到 `frame.contentWindow.parent`，因为它与宿主一样是 `parent` 链上的同一个对象。
- `?catalog=local` 原来是对 HTML 文本做字符串替换。拆分后目录 URL 在 `market.js` 里 ⇒ 改为在 iframe 文档加载完成后，覆盖 `frame.contentWindow.fetch` 拦截 `catalog.json` 请求并返回本地文件；`market.js` 侧的 `fetchCatalog()` 本就走 `fetch`，无需改动。同源是这条路可行的前提（预览器与产物同跑在 `127.0.0.1:8791`）。
- `?modal=1` / `?nodiag=1` 保持原语义，改为在 `load` 后对 `contentDocument` 操作。
- **回退方案**：若 `src` 模式下 mock 桥或 fetch 拦截无法做到（同源策略或加载时序卡住），允许保留 `srcdoc`，但必须在注入前把 `<link href="market.css">` / `<script src="market.js">` **改写成内联 `<style>` / `<script>`**（预览器里预读这些文件即可）。此时 `?catalog=local` 恢复为对拼接后文本做替换。

**`_tools/market-verify.sh`** —— PASS 口径改写：

| 原断言 | 新断言 |
|---|---|
| `[data-act="live"]` 存在且点击后 `live == 'clicked'` | **不存在**（`live == 'no live button'`），且**未点击**就出现 `.mkt-note` 实时发现横幅（或「没有新仓库」文案） |
| 仅 `--window-size=1180,880` | 增加三档宽度断言列数：宽 ≥1180 ⇒ 4–5 列、≈791 ⇒ 3 列、≤560 ⇒ 1 列（读 `.mkt-grid` 的 `getComputedStyle().gridTemplateColumns` 计算条数） |
| 每次新 `--user-data-dir`（缓存永不命中） | 同一 profile 内两次进入该 tab，断言第二次**没有新请求**（横幅时间戳不变） |

**`_tools/install-market.ps1`** —— 完整性门槛换成按文件名逐项校验：

```powershell
foreach ($f in 'index.html','market.css','market.js','manifest.json') {
    if (-not (Test-Path -LiteralPath (Join-Path $Dest $f))) { throw "缺少产物文件：$f" }
}
$sizes = 'market.css','market.js' | ForEach-Object { (Get-Item -LiteralPath (Join-Path $Dest $_)).Length }
if (($sizes | Measure-Object -Sum).Sum -lt 20000) { throw '产物体积异常，可能不完整。' }
```

即：**四个文件必须齐、`css + js` 合计 ≥ 20000 字节**。`docs/maintenance.md` 里记着 20000 这条规则的位置要同步改写。

**`docs/submit-plugin.md`** —— 「产物必须单文件」改成实测口径，并**限定适用范围**（只说 `tab` / 宿主 `0.9.5` 实测通过，不夸大成八种形态通用）。

### 4.6 复盘定的三处代码细节（评审补充）

**a. `state.live` 不再被筛选清空。** 现在 `[data-filter]` 点击会 `state.live = null`，按钮在时还能重查，按钮没了就变成「点一下筛选，实时发现结果永久消失」。改为**保留** `state.live`，只在 `refreshAll()`（用户主动刷新）时清空并重查。这样横幅是一个稳定的「相对目录新增了什么」指示器，验收 §5.4 也不会随机失败。

**b. 主题在独立视窗里降级。** §1.3 实测弹窗里 `data-theme` 为 `none`。`syncTheme()` 改为：

```js
const theme = (de && de.getAttribute('data-theme')) || null;
document.documentElement.setAttribute('data-theme', theme || 'cyber');
```

并把「读不到父文档」与「父文档没有 data-theme」都当作 `null`，不再把 `'cyber'` 当成读到的值。同时 `watchTheme()` 在 `MutationObserver` 失败时**不重试**（弹窗里没有父主题可观察，反复试只是噪音）。

**c. 实时发现必须在目录之后再跑。** 弹窗与 tab 各自 `init()` 都会调 `maybeAutoLive()`；共享 `localStorage` 保证了 TTL 生效（§1.3），但两个上下文**同时**初始化时仍可能各发一次。用 `localStorage` 里的 `pendingAt` 时间戳做 30 秒软锁：读到 `pendingAt` 在 30 秒内就跳过，写完在请求结束时清掉。

### 4.7 文档更正

| 文件 | 改什么 |
|---|---|
| `docs/host-contract.md` | 「`srcDoc` ⇒ 必须单文件」改成实测结论：外链 css/js/相对图片可用；补一条「弹出视窗几何来自 `manifest.window`，缺省 240×320 且无标题栏」。附取证方法（探针插件三步） |
| `docs/maintenance.md` | 构建产物说明改成四文件；删「产物必须单文件」段落；自检口径改成「只允许两个外链」 |
| `README.md` | 「仓库结构」里 `plugin-market/` 标注为多文件产物 |
| `market/PLUGIN_README.md` | 若有单文件相关表述一并更正 |

## 5. 验收（改完必须亲眼看到）

1. `python build_market.py --check` 通过；`python build_market.py --install` 后 `%APPDATA%\OpenRevo\plugins\plugin-market\` 下是 5 个文件（`index.html` / `market.css` / `market.js` / `manifest.json` / `README.md`）。
2. 宿主「插件」页刷新 → 打开「插件市场」：**3 列**；窗口拖到最大 → 4–5 列；拖窄 → 递减但不截断。
3. 点「独立视窗运行」→ 出现约 1120×780、**带标题栏**的窗，能关闭；关掉后再开仍只有一个实例；**窗内安装/卸载按钮可用**（桥在，§1.3）。
4. 切到「插件市场」tab 时**自动**出现实时发现结果或「没有新仓库」的说明，工具栏**没有**「实时发现」按钮；点任意筛选后横幅与实时条目**仍在**；5 分钟内来回切换不重复请求。
5. 主题：宿主切到 `mono` / `cyber` 时市场跟着变；独立视窗内不崩（降级为 cyber，不显示错乱的浅色）。
6. `_tools/market-verify.sh` 两种主题都 `ALL PASS`；`_tools/install-market.ps1 -Local -DryRun` 通过新的完整性校验。
7. 上述每一条都出截图，存 `_shots/`。

## 6. 我的判断（可推翻）

- **卡片最小宽取 232px 而非更小**：再小徽章会挤成两行、`重装/卸载` 会换行，反而更难扫。3 列时每列约 257px，留有余量。
- **保留 `刷新` 作为强制重查入口**：用户要求移除的是「实时发现」按钮，不是刷新；没有手动重试入口的话，一次限流就让用户干等 5 分钟。
- **不加 `type="module"`**：见 §3 约束。
- **`PAGE_SIZE` 不改**：3 列 × 4 行 = 12，与现状一致。

## 7. 留给实施者的空间

- 卡片内部窄宽下的具体折行策略（是让徽章换行还是省略）由实施时看真实渲染定，以「不叠字、不溢出」为准。
- `@container` 与新 `@media` 的具体边界值可在实测截图微调 ±60px，只要满足 §5 的三档结论。
