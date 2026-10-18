# 提取宿主真值（host truth extraction）

> **皮肤/背景链已于 2026-10-18 从本仓库移除**（用户口径）。本页提到的 `skin-authoring.md` / `background-plugin.md` / `preview-and-audit.md` / `real-machine-verification.md`、`build_skins.py`、`src/base.css`、`preview*.html`、`verify.sh` / `audit.sh` 等**都已不在仓库里**，完整存档在桌面 `OpenRevo 皮肤技能存档\`（导出自提交 `7d5b5da`）。
>
> 本页保留的价值是**实测结论本身**（宿主真值、手册与发行版的出入），这些结论对写任何插件形态都有效；只是**照着跑命令会找不到文件**。

**目的**：写插件前必须先知道宿主**真实的类名、令牌、`!important` 对手规则和 DOM 结构**。手册里的示例类名不可信。

> **当前基线 = 0.9.1**（exe **9,368,576 B**）：抽取物在 `_extracted/v091/`
> （JS `index-CXze12DN.js` 641,939 B、CSS `index-CQ_flESn.css` 59,884 B）。
> 本页 §1 的**字节偏移与压缩流大小是 0.8.8 时代的记录**，换版本后**必须重新定位**——
> 方法照本页，数字一律现算。判断前端有没有变，看**资产文件名里的内容哈希**（`index-<hash>.js`）。

## 1. 从 `open-revo.exe` 抽前端产物

宿主是 Tauri 应用，前端产物被**内联进 exe**，格式是拼接的 `[文件路径字符串][brotli 负载]` 序列：

* 格式：`[资产路径字符串][brotli 负载]` 依次拼接；负载**紧跟在路径字符串之后**（`payload = path_offset + len(path)`）。
* **0.8.8 最新构建实测**（exe **8,826,368 B**，构建号 **`v0.8.8-dbfe615`**）：
  `/assets/index-D5aBypuh.css` → 路径 @ **7,382,751**、负载 @ **7,382,777** → 压缩流 8,772 B → 解压 **55,011 B / 375 个 `{`**
  （sha256 `ce754dfbaa19666b17c97c7b2c86f31fc21b81796eafcae54c7dfbce220d5b65`，**与上一构建逐字节相同** ⇒ UI 样式层未变）；
  `/assets/index-D-GAymO3.js` → 路径 @ **7,246,680**、负载 @ **7,246,705** → 压缩流 136,046 B → 解压 **607,244 B / 7,461 个 `{`**
  （sha256 `cc714e5d8b02d7b9961cd878004447873a4bba9bb6c2255338cc2331ffdb8ff2`）。
  同表后续条目：`/assets/logo-BmAeRQ1x.png` @ **7,391,549**、`/assets/alipay-CR2EmPpy.jpg` @ **7,425,983**、
  `/assets/wechat-CQ1ljkRz.jpg` @ **7,522,135**。
  ⇒ **blob 表里的路径带 `/assets/` 前缀**（要搜的是 `/assets/index-…`，不是 `index-…`）。
  产物落在 `_extracted\new-build\`。
* **⚠️ 同一个「版本号」内部可以有多个构建，且行为会变**：本条的上一版是 exe **8,565,760 B**、
  构建号 `v0.8.8-bf72755`（`index-Tu8RPoda.js` 598,008 B）；而两版 `VersionInfo` 的
  `FileVersion` / `ProductVersion` **都报 `0.8.8`**。**判宿主是否更新必须看构建号**
  （前端徽标 `PRO v0.8.8-<hash>`，点标题栏即复制）或 exe 体积 + 资产文件名，不要信版本资源。
* **0.8.8 上一构建历史记录**（当时 exe 8,565,760 B / `v0.8.8-bf72755`）：
  `/assets/index-D5aBypuh.css` → 路径 @ **7,348,018**、负载 @ **7,348,044** → 解压 **55,011 B / 375 个 `{`**；
  `/assets/index-Tu8RPoda.js` → 路径 @ **7,004,288**、负载 @ **7,004,313** → 解压 **598,008 B / 7,360 个 `{`**。
* **0.8.7 历史记录**（当时 exe 8,496,640 B）：`assets/index-C535NsqC.css` → 路径 @ **6941209**、负载 @ **6941234**、压缩流 8,020 B → 解压 **50,997 B**；
  `assets/index-BzQyTcpV.js` → 路径 @ **7124459**、负载 @ **7124483**、压缩流 133,369 B → 解压 **594,906 B**。
  （**这些数字随版本变动，只当定位方法的示例，绝不要写死进代码。**）
* 解压后（0.8.8）：完整宿主 CSS **55,011 B / 375 个 `{`**；外壳/主题子集另存 `_extracted\host-shell.css`
  （14,584 B / 86 行：`acrylic-container|mech-titlebar|sub-nav|nav-tab|glass-card|logo-badge|mini-drawer-root`，取自 0.8.7，未重抽）。
* JS：0.8.8 最新构建抽取物 `_extracted\new-build\index-D-GAymO3.js`（607,244 B / `v0.8.8-dbfe615`）；
  上一构建 `index-Tu8RPoda.js`（598,008 B / `bf72755`）；
  0.8.7 那份 `_extracted\new-build\index-BzQyTcpV.js`
  （594,906 B）保留作回归对照；早期 `_extracted\bundle.partial.js`（584,148 B / 1012 行，**尾部被截断**）是最旧的构建，
  但它**没有背景通道**（`openrevo-custom-background` / `set_active_background` / `plugin_type==="background"` 全 0 命中），
  可用来判「某能力是哪版引入的」。迷你面板的决定性片段另有逐字切片
  `_extracted\_mini_L0.js`、`_mini_G0.js`、`_mini_q0.js`、`_mini_spec.txt`、`_mini_strings.txt`。

### 定位精确流尾（必须做，否则解不出来）

`brotli.decompress(切片)` **要求切片正好是一个流**：多带一个字节的尾部数据就会 `brotli.error: decoder failed`，
少一个字节也失败。所以要么先知道下一个资产路径的偏移（流尾 = 下一个路径起始），要么用增量解码器逐块喂到 `is_finished()`。
本仓库用的稳健写法（先粗后细）：

```python
d = brotli.Decompressor(); out = bytearray(); pos = start; CH = 4096
while pos < start + limit:
    chunk = data[pos:pos+CH]
    try: out += d.process(chunk)
    except Exception: err_at = pos - start; break      # 这一块里越过了流尾
    pos += len(chunk)
    if d.is_finished(): break                          # 正常结束
# 在 [err_at, err_at+CH] 区间里用完整流解码精确定位流尾
for j in range(0, CH + 1):
    try: blob = brotli.decompress(data[start:start+err_at+j]); break
    except Exception: continue
```

**陷阱一：brotli 没有魔数**。偏移错一个字节也会「成功」解出一堆垃圾或直接抛错，不会自我暴露。
解压后**必须**校验产物（开头是否合理、`{` 条数是否稳定、关键类名是否可 grep）。

**陷阱二：宿主会自我更新并重启**。本次开发中途就发生过两次：第一次 exe 于 `23:49:31` 被替换
（8,490,496 → 8,496,640 B，CSS 路径偏移 `7145918 → 6941209`，JS 切片名 `index-CGlrizf7.js → index-BzQyTcpV.js`）；
后来升到 **0.8.8**（8,496,640 → 8,565,760 B，CSS 切片名 `index-C535NsqC.css → index-D5aBypuh.css`，
JS 切片名 `index-BzQyTcpV.js → index-Tu8RPoda.js`，CSS 路径偏移 `6941209 → 6,941,209` 附近 → 本次 7,348,018）。
**判据：文件名里的哈希就是内容哈希**——文件名没变 = 内容没变，可以复用旧抽取物；文件名变了就必须重抽。
0.8.8 这次 CSS 切片名与 JS 切片名**都变了**（CSS 从 50,997 → 55,011 B、`{` 从 333 → 375），
说明前端确实改了。下次更新照这个流程复核一遍即可。

**陷阱三：`open-revo.exe` 里除了压缩资产，还有 Rust 侧明文字符串**。0.8.8 实测明文命中：
`plugin_type`、`theme_css`、`background_css`（manifest 字段表 @6949111 裸拼接为
`…desired_interval_mssensorsalways_on_topplugin_typedir_nametelemetryentrytheme_cssbackground_css…`）；
命令名 `load_plugin_theme_css` / `load_plugin_background_css` / `set_active_skin` / `set_active_background`
密集出现在 @6984239 一段：`…load_plugin_html set_active_background backgroundId load_plugin_background_css
set_active_skin skinId load_plugin_theme_css CallNtPowerInformation src\system\webview_orchestrator.rs`；
`active_background` @6947958。注意 **`get_active_background` 在 exe 明文 0 命中**（它只在 JS 侧出现），
所以「grep exe 找不到某命令」不等于「宿主没有这能力」—— 前端压缩在资产里，只有 Rust 侧才明文。
`plugin_type` 的存在证明 manifest 权威键是 **`plugin_type`**（`"type"` 带引号在 exe **0 命中**，
所以两者是否 alias 等价**未证实**；编写时仍双发 `type` 对冲）。

## 2. 交叉核对「这个类名真的存在吗」

手动拷手册里的选择器去写样式是本项目最大的坑。可靠的核对手段是宿主 WebView2 的 **V8 代码缓存**：

```
%LOCALAPPDATA%\com.openrevo.controlcenter\EBWebView\Default\Code Cache\js\   # 本次 72 个文件
```

对里面的文件逐字 grep 类名字面量（这些是宿主真实执行过的 JS，含编译后的字符串表），
再用 `_extracted\index-*.css` 交叉确认。

**实测结论：手册 §7 用例里的 `.overview-main-grid`、`.sensor-gauge-cluster`、`.cooling-fan-card`、
`.power-mode-selector` 等示例名，在发行版里命中数为 0。** 皮肤只能针对 `_extracted` 里的真实选择器写；
若想兼容手册示例名，只能额外写一组「前向兼容手臂」。

## 3. 宿主如何注入皮肤 CSS（决定预览页必须怎么复刻）

### 0.8.8：两条独立通道（皮肤 + 背景），各自一个 `<style>`

**皮肤通道**（id 已从 `openrevo-custom-skin` 改名为 `openrevo-theme-skin`），逐字：

```js
d = v.useCallback(async P => {
  try {
    await m("set_active_skin", { skinId: P }), R(P);
    let w = document.getElementById("openrevo-theme-skin")
         || document.getElementById("openrevo-custom-skin");   // 兼容旧 id
    if (P) {
      const O = await m("load_plugin_theme_css", { pluginId: P });
      w ? w.id = "openrevo-theme-skin"                          // 读到旧 id 就就地改名
        : (w = document.createElement("style"), w.id = "openrevo-theme-skin", document.head.appendChild(w)),
      w.textContent = O;
    } else w && w.remove();                                     // 取消皮肤时移除 <style>
    e && c && await m("resize_window", { expanded: !0 })
  } catch (E) { console.error("Failed to apply skin:", E) }
})
```

**背景通道**（0.8.8 新增），逐字：

```js
u = v.useCallback(async P => {
  try {
    await m("set_active_background", { backgroundId: P }), h(P);
    let w = document.getElementById("openrevo-custom-background");
    if (P) {
      const O = await m("load_plugin_background_css", { pluginId: P });
      w || (w = document.createElement("style"), w.id = "openrevo-custom-background", document.head.appendChild(w)),
      w.textContent = O;
    } else w && w.remove();
    window.dispatchEvent(new Event("resize"))
  } catch (w) { console.error("Failed to apply background:", w) }
})
```

启动路径（0.8.8）依次 `get_active_skin` → `load_plugin_theme_css` → `get_active_background` → `load_plugin_background_css`
→ `frontend_ready`；两个 try 块各自 `console.warn("Failed to load active skin theme.css on boot:")` /
`"Failed to load active background CSS on boot:"`，互不影响。

注意两处 `else E && E.remove()`：宿主**取消勾选时是把 `<style>` 整个删掉**，而不是注入空样式表——
所以皮肤 / 背景必须**自带完整观感**（包括命名空间内的全部默认值），不能依赖「上一次注入的残留」。
另外 **CSS 是「按需注入」而不是「只启动时注入一次」**：切开关会重新 `load_plugin_*_css`
（0.8.7 时代必须重启宿主，这个结论在 0.8.8 已过时）。

**【刷新】按钮的语义随构建变**（判构建看徽标 `PRO v0.8.8-<hash>`）：

| 构建 | 【刷新】行为 | 实操口径 |
|---|---|---|
| 0.8.7 | 无（只在启动时枚举一次） | 必须重启宿主 |
| `v0.8.8-bf72755` | 只 `get_custom_plugins` 重扫列表 | 刷新列表 + 拨一次开关 |
| **`v0.8.8-dbfe615` 及之后** | 重扫列表 **+ 热重载当前样式**（`onClick:()=>j(!0)` 触发重放 `onApplySkin` / `onApplyBackground`） | **点一次【刷新】即可** |

最新构建的 handler 逐字：`j=async(S=!1)=>{b(!0);try{const D=await m("get_custom_plugins")||[];u(D),S&&(i&&a&&(D.some(W=>W.id===i)?a(i):a(null)),o&&d&&(D.some(W=>W.id===o)?d(o):d(null))),p&&p()}…}`，
title `"刷新已安装插件列表并热重载当前样式"`；旧构建的 `k=async()=>{…d(j||[])}` **没有** `S` 形参与回调重放。
详见 `plugin-dev-0.8.8-skill.md` §4 与 §9.4。

要点：

* 宿主把 CSS 的**整份文本**塞进 `<style>` 的 `textContent`（不是 `<link>`）→ 预览页必须照做。
* 因为 base URL 是宿主文档（`tauri://`），CSS 里的 `@import` **取不到插件目录**，所以**必须单文件**；
  图片要走 `data:` URI（或交给宿主的 Background Engine，见 `plugin-dev-0.8.8-skill.md` §3）。
* **曾经因为这个吃过一个大坑**：预览页最初用 `<link rel=stylesheet disabled>` + 运行时启用，结果**已存在的元素保持旧样式**
  （按钮停在浏览器默认 `buttonface rgb(240,240,240)`）。改成 `<style>.textContent` 注入后一致。详见 `pitfalls.md`。

### 0.8.7（历史，仅作对照）

```js
…openrevo-custom-skin");
if (w) {
  const F = await m("load_plugin_theme_css", { pluginId: w });
  E || (E = document.createElement("style"), E.id = "openrevo-custom-skin", document.head.appendChild(E)),
  E.textContent = F;
} else E && E.remove();                       // 取消皮肤时移除 <style>
e && c && await m("resize_window", { expanded: !0 })
} catch (E) { console.error("Failed to apply skin:", E) }
```

## 4. `data-skin` 挂在哪、两个面板的根是谁

### 0.8.7

bundle 里两个面板共用同一层包装：

```js
n.jsx("div", { "data-theme": f, "data-skin": N || void 0, style: { width: "100%", height: "100%" }, children: … })
```

* `data-skin` 与 `data-theme` **写在同一个元素上**，两个面板都是；`data-skin` **从不写在 `<html>` 上**。
* 主控台根 = `.acrylic-container`；迷你面板根 = `.mini-drawer-root`。

### 0.8.8（**关键变化**）

宿主把 `data-skin` / `data-background` **同时挂到 `document.documentElement`**，逐字：

```js
v.useEffect(() => {
  const P = document.documentElement;
  C ? P.setAttribute("data-skin", C) : P.removeAttribute("data-skin"),
  S ? P.setAttribute("data-background", S) : P.removeAttribute("data-background"),
  P.setAttribute("data-theme", x),
  P.setAttribute("data-window-mode", e ? "full" : "mini") …
```

根容器也照旧带一份：

```js
className: "openrevo-app-root", "data-theme": x, "data-skin": C || void 0,
"data-background": S || void 0, "data-window-mode": e ? "full" : "mini"
```

⇒ 0.8.7 的「`data-skin` 从不写在 `<html>` 上」在 0.8.8 **已不成立**；本仓库皮肤本来就有
`html[data-skin="…"]` / `body[data-skin="…"]` 手臂，正好命中，**无需改动**（这是「宽兜底」写法的红利）。
新增的 `data-background` 属性可供背景插件做命名空间（它承载的是 `active_background` 的插件 id）。

**0.8.8 真实类结构（逐字从 JSX 抽）**：

```
div.acrylic-container.openrevo-shell[data-slot=shell][data-theme]
├── div.mech-titlebar.shell-titlebar[data-slot=titlebar][data-tauri-drag-region]
├── div.sub-nav-wrapper.shell-navbar[data-slot=navbar] > div.sub-nav-bar > button.nav-tab
└── div.shell-viewport[data-slot=viewport]
```

注意 `.shell-navbar` 与 `.sub-nav-bar` 是**外层 / 内层两个元素**（前者是 wrapper，后者是滚动条那层），
不要当成改名。四套皮肤依赖的 `.acrylic-container` / `.mech-titlebar` / `.sub-nav-bar` / `.mini-drawer-root`
**全部照旧渲染**（0.8.8 的 `.acrylic-container` 与 `.openrevo-shell` 是同一个元素上的两个类）。

迷你根（0.8.8 逐字）：`mini-drawer-root openrevo-mini-shell ${k?"is-overflowing":""}`，
`data-slot="mini-shell"`（**不是**开发者 skill §4 写的 `mini-root`），内含 `.mini-drawer-content`
与 8 个 `.mini-slot-*`（header/power/gpu/display/lighting/battery/switches/footer）。

### 主控台 DOM

```
div.acrylic-container
├── div.mech-titlebar[data-tauri-drag-region]        # .logo-badge(22×22) + "OPENREVO" + .badge-tag("社区定制版本号: v0.8.8-2075447") + 窗控按钮 + mono/cyber 切换
├── div.sub-nav-wrapper > div.sub-nav-bar > button.nav-tab   # 8 个 tab
└── div（无 class，flex:1; padding:16px; overflowY:auto）     # 内容区，没有页面标题层
```

tab 依次为：`overview, gpu, tuning, lighting, water, system, plugins, sponsor`。

### 迷你面板 DOM

```
div.mini-drawer-root[data-theme]
    内联: width:100vw; height:100vh; background:rgba(12,15,22,.96);
          backdrop-filter:blur(28px); color:#f8fafc
└── div.mini-drawer-content  (display:flex; flex-direction:column; gap:5.5px; padding:9px 11px; width:100%)
    ├── header（拖拽区，border-bottom rgba(255,255,255,.06)，.logo-badge img 19×19，4 个内联彩色图标按钮）
    ├── 性能模式（.m-card + .m-grid-4 × 4 个 .m-btn-action）
    ├── 显卡模式
    ├── 刷新率 + 亮度（slider）
    ├── 键盘背光 / 电池健康
    ├── .m-quick-grid × 6 个 .m-quick-btn + 状态行
    └── 底行（checkbox + .m-foot-btn.expand + 可选的 OEM 弹窗 div[style*="position: fixed"]）
```

**OEM 助手弹窗与「极客调校」浮层是条件渲染的**，本项目只做了近似（用 `[style*="position: fixed"]` 手臂兜），
未真正复刻——遇到相关需求需要重新取真值。

## 5. 宿主 `:root` 令牌（主控台）

0.8.8 的 `:root{` 在 `_extracted\new-build\index-D5aBypuh.css` @ **9660**（0.8.7 在 @ 8867），块长 **1,595 B**，逐字：

```css
--surface-base: rgba(11,14,20,.94);
--surface-card: rgba(22,27,34,.75); --surface-card-hover; --surface-card-active;
--surface-pill: rgba(255,255,255,.05); --surface-pill-hover; --surface-sunken; --surface-overlay; --surface-badge
--border-subtle: rgba(255,255,255,.08); --border-medium: rgba(255,255,255,.15);
--border-highlight: rgba(255,255,255,.3); --border-glow: rgba(99,102,241,.35);
--text-primary:#f8fafc; --text-secondary:#cbd5e1; --text-muted:#94a3b8; --text-dim:#64748b;
--radius-xs:4px; --radius-sm:6px; --radius-md:8px; --radius-lg:12px; --radius-xl:16px; --radius-full:9999px;
--transition-fast:.15s cubic-bezier(.4,0,.2,1); --transition-normal:.25s …
--status-ok:#10b981; --status-ok-dim; --status-warn; --status-warn-dim; --status-error; --status-error-dim; --status-info; --status-info-dim
--bg-acrylic: var(--surface-base); --bg-card: var(--surface-card); --bg-card-hover; --bg-glass-pill: var(--surface-pill);
--text-main: var(--text-primary);
--color-brand:#6366f1; --color-office:#10b981; --color-balance:#3b82f6;
--color-beast:#f43f5e; --color-fan:#06b6d4; --color-gold:#f59e0b;
--font-sans: "Inter", …; --font-mono: "JetBrains Mono", monospace; --font-mech: "Chakra Petch", sans-serif}
```

**⚠️ `--theme-*` 与 `--accent-*` 不在 `:root` 里**（`:root` 块内两项计数均为 **0**）—— 它们由**主题选择器**声明，
两版（0.8.7 / 0.8.8）**完全一致**：

| 声明选择器 | `--theme-*` | `--accent-*` |
|---|---|---|
| `:root,[data-theme=cyber]` | 24 | 24 |
| `[data-theme=mono]` | 24 | 24 |
| `.mini-drawer-root[data-theme=mono]` | 24 | 0 |
| `.mini-drawer-root[data-theme=cyber]` | 24 | 0 |

* `--theme-*` 共 **24** 个名字：`--theme-{bat,gpu,hz,kbd,lux,pwr}{,-border,-dim,-glow}`（6×4）。
* `--accent-*` 主表 **24** 个名字：`--accent-{beast,cool,gpu,lux,pwr,rgb}{,-border,-dim,-glow}`（6×4）——
  另有零散 1 个 `--accent-color`，所以全文去重是 **25** 个名字 / **114** 处出现。
* ⇒ 想覆盖主题色，命中的是 `[data-theme=cyber|mono]` 这一层，而**不是** `:root` 顶层。

**计数核对**（`--surface-card` **7**/8、`--border-medium` **15**/16、`--status-ok` **2**/2、`--status-info` **6**/6、
`--color-beast` **1**/1、`--radius-md` **11**/12、`--radius-lg` **6**/7、`--text-primary` **20**/22 —— 0.8.7 / 0.8.8）。
⇒ 官方手册 §7/§8 列的那几个令牌**就是宿主真值**，两版都在（曾误记「发行版没有这一套、真值是 `--wf-*` 一套」，已反转）。

**真正不存在的**：`--core-*`（0/0）、`--mica-*`（0/0）、以及 **`--wf-*`**（old-css / new-css / new-js / exe 全 0 命中）。
`--wf-*` 是**本工具链的私有前缀**（`build_skins.py` 的 `token_block()` 把配色写进宿主
`--theme-<key>{,-border,-dim,-glow}` 槽位后镜像成 `--wf-hue-<key>*`），别写成宿主令牌。
完整令牌面与逐条核对见 `plugin-dev-0.8.8-skill.md` §5.2。

宿主 exe 明文里 `--accent` / `--theme-` / `--surface-` / `--status-` / `--wf-` **全 0 命中** ——
令牌只存在于压缩前端资产里，grep exe 是找不到的。

## 6. 宿主关键规则（皮肤要压过的「对手」）

### 主控台

```css
.acrylic-container{ background: radial-gradient(...) + #0b0e14f0;
                    backdrop-filter: blur(24px) saturate(180%); border-radius:14px;
                    box-shadow: 0 16px 40px #0009, inset 0 1px #ffffff1a }
.mech-titlebar{ padding:10px 16px; background:#00000040 }
.sub-nav-bar{ display:flex; gap:6px; padding:8px 16px; background:#00000026 }
.nav-tab{ padding:6.5px 13px; border-radius:8px; background:#ffffff09; font-size:11.5px; font-weight:600 }
.glass-card{ background: var(--bg-card); border-radius:10px; padding:12px; backdrop-filter: blur(12px) }
[data-theme=mono] .nav-tab.tab-sponsor.active{ …!important }   /* (0,4,0) + !important —— 最难压的一条 */
```

### 迷你面板

```css
.mini-drawer-root{ width:100vw; height:100vh;                    /* 0.8.8：从内联样式搬进了 CSS */
                   background:var(--surface-base, rgba(12,15,22,.96));
                   backdrop-filter:blur(28px); color:var(--text-primary,#f8fafc);
                   box-sizing:border-box; overflow-x:hidden;
                   --text-muted:#94a3b8; --text-dim:#64748b;
                   --border-subtle:rgba(255,255,255,.08); --border-hover:rgba(255,255,255,.16);
                   --bg-card:rgba(18,22,32,.75) }                 /* (0,1,0) 局部令牌声明 */
.mini-drawer-root[data-theme=mono], .mini-drawer-root[data-theme=cyber]{ …重新声明整套 --theme-*… }  /* (0,2,0) */
[data-theme=mono] .m-quick-btn.active{ background:#ffffff24; border-color:#ffffff73; color:#fff;
                                      box-shadow: 0 0 10px #ffffff1f }   /* (0,3,0) */
.m-card{ background: var(--bg-card); border:1px solid var(--border-subtle); border-radius:8px;
         padding:6px 10px; display:flex; flex-direction:column; gap:5px }
.m-btn-action,.m-btn-hz,.m-btn-bat{ background:#ffffff08; border:1px solid rgba(255,255,255,.07);
                                    color: var(--text-muted) }     /* hover:#ffffff12 / #ffffff26 */
.m-quick-btn{ height:48px; border-radius:7px; background:#ffffff09 }
.m-quick-btn.active{ background:#38bdf826; border-color:#38bdf873; color:#38bdf8 }
.mini-drawer-root::-webkit-scrollbar{ width:4px }
.mini-drawer-root::-webkit-scrollbar-track{ background:transparent }
.mini-drawer-root::-webkit-scrollbar-thumb{ background:#ffffff29; border-radius:4px }
.mini-drawer-root::-webkit-scrollbar-thumb:hover{ background:#ffffff52 }
.sub-nav-bar::-webkit-scrollbar{ height:3px }
```

这两段（主控台 / 迷你）在 **0.8.7 与 0.8.8 逐字节相同**（除下一条注明的搬移）。

### 0.8.8 新增的 shell 层（`.openrevo-*`）

```css
.openrevo-app-root{ width:100vw; height:100vh; overflow:hidden; position:relative }
.openrevo-shell{ display:flex; flex-direction:column; width:100vw; height:100vh;
                 min-height:100vh; box-sizing:border-box; position:relative }
.shell-titlebar{ grid-area:titlebar; flex-shrink:0 }
.shell-navbar{ grid-area:navbar; flex-shrink:0 }
.shell-viewport{ grid-area:viewport; flex:1 1 0%; min-height:0; padding:16px;
                 overflow-y:auto; overflow-x:hidden; box-sizing:border-box }
.mini-drawer-content{ display:flex; flex-direction:column; gap:5.5px; padding:9px 11px;
                     box-sizing:border-box; width:100% }
.openrevo-mini-shell{ position:relative }
```

### 两条容易忽略的「宿主事实」

* **宿主有全局重置**（0.8.7 / 0.8.8 逐字节相同，紧跟在 `:root` 之后 @ 0.8.8 **11256**，顶层、不在任何 `@media`/`@layer` 里）：
  ```css
  *{box-sizing:border-box;margin:0;padding:0;user-select:none;-webkit-user-select:none}
  body{font-family:var(--font-sans);background:transparent;color:var(--text-main);
       overflow:hidden;height:100vh;width:100vw}
  ```
  ⇒ **⚠️ 旧结论「宿主没有全局 `*{box-sizing:border-box}`」是错的**（已按两版实测反转）。
  真正要小心的是反面：宿主**已经**把 `box-sizing/margin/padding/user-select` 全清了，
  所以你**不需要**再写一遍；而 `.mini-drawer-root` 别加 `border` 的理由**不是** box-sizing，
  而是宿主迷你内容本来就**纵向余量只有 11px**（410×621 内容 > 610 高，见 `pitfalls.md` #26）——
  描边改观感时用 `inset 0 0 0 1px` 这种 `box-shadow` 画（本项目 `--wf-window-stroke` 就是这么做的）。
* 宿主**没有**任何规则去写 `buttonface` / `#f0f0f0`（两版计数都是 0），`button` 只有一条通用重置
  `button{font-family:inherit;background:transparent;border:none;color:inherit;user-select:none;cursor:pointer}`
  —— 所以看到 browser 默认 `buttonface` 一定是你自己的问题（见 `pitfalls.md` 第 1/23/25 条）。

## 7. 由 JSX 内联样式决定的 `!important` 清单

宿主用 React 内联 `style={{…}}` 写死了下面这些属性，**普通选择器压不过**，必须 author `!important`。

> **⚠️ 0.8.8 已大幅瘦身**：内联样式只保留**布局/交互**那几项，**视觉属性（背景、圆角、阴影、颜色）全部搬进了 CSS 规则**。
> 也就是说 0.8.8 下压背景**不再需要** `!important`（但仍需要抬高特异性）—— 而 0.8.7 下必须 `!important`。
> 本插件的 `.mini-drawer-root.mini-drawer-root` =(0,2,0) **同时**满足两版（(0,2,0) 压 0.8.8 的 (0,1,0)，`!important` 压 0.8.7 的内联）。

**0.8.8 仍保留的内联样式**（逐字核对）：

* `.mech-titlebar.shell-titlebar`：`style:{flexShrink:0,userSelect:"none",cursor:"default"}`
* `.logo-badge`：`style:{display:"flex",alignItems:"center",gap:"6px"}`，其 `<img>` 有内联
  `width:19px;height:19px;borderRadius:3px;objectFit:contain;filter:drop-shadow(…)`
* 迷你底行 `.m-foot-btn.expand` 等按钮
* 各处浮层：`style:{position:"fixed",inset:0,backgroundColor:"rgba(0,0,0,.72)",backdropFilter:"blur(8px)",zIndex:9999,…}`
  —— 这是 `[style*="position: fixed"]` 手臂继续有效的依据（React 会把 `position:"fixed"` 序列化成 `position: fixed`）。

**0.8.7 独有的内联样式**（0.8.8 已删——搬进了 CSS）：

* `.acrylic-container`：`style:{width:"100vw",height:"100vh",display:"flex",flexDirection:"column"}`（0.8.8 → `.openrevo-shell`）
* `.mini-drawer-root`：`style:{width:"100vw",height:"100vh",background:"rgba(12,15,22,.96)",
  backdropFilter:"blur(28px)",WebkitBackdropFilter:"blur(28px)",color:"#f8fafc",fontFamily:…}`
  （0.8.8 → `.mini-drawer-root` / `.openrevo-shell` 规则；JS 里 `rgba(12,15,22,.96)` / `blur(28px)` 命中 **0**）

（`!important` 的合法性依据：作者源里的 `!important` 胜过普通声明，而内联样式**不是** `!important`，因此作者 `!important` 能压过内联。）
