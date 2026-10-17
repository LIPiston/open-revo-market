# 皮肤插件编写（skin authoring）

## 1. 插件形态与安装位

一个皮肤插件 = 一个目录，最小构成：

```
%APPDATA%\OpenRevo\plugins\<skin_id>\
├── manifest.json
├── theme.css            # 必须单文件（见 host-truth-extraction.md 第 3 节）
└── assets\preview.png   # 插件页缩略图
```

另有一份 `%APPDATA%\OpenRevo\config.json` 保存宿主状态，皮肤开发会读/改到：

```json
{ "active_skin": null,              // 当前未启用任何皮肤
  "active_background": null,        // 与 active_skin 正交的独立槽位
  "custom_plugin_toggles": { "plugin-market": true },
  "wake_window_mode": "mini",
  "power_mode": 4, "refresh_rate": 300, "gpu_mode": "dgpu", "log_enabled": false }
```

* 皮肤**互斥**（同时只有一套生效），切换是 **0ms 热加载**（重新注入 `<style>`）。
* 宿主在切换皮肤时会调 `resize_window` 并**重新居中**窗口，尺寸取 manifest 的 `window`。
* **`window` 的宽高是 CSS 逻辑像素**（Tauri `LogicalSize`），不是物理像素。真机实测：manifest 写 `1120×800`、
  显示器 150% 缩放 → 窗口物理 `1702×1213`，客户端 CSS ≈ `1135×809`。
* **让宿主认到新目录**：插件页【刷新】= 重扫列表 **+ 热重载当前样式**（重放
  `onApplySkin` / `onApplyBackground` → 重新 `load_plugin_*_css`）⇒ 改 `theme.css`、装新目录**都只需点一次【刷新】**。
  ⚠️ 唯一例外：`active_skin` 指向**已删 ID** 时必须「停 → 改 → 启」（见 `real-machine-verification.md` 第 2 节）。

### manifest 的双键对冲

手册用 `plugin_type`，官方样例用 `type`，发行版二进制里能搜到字面量 `plugin_type`。**两个都写**：

```json
{ "id": "skin-win11-dark",
  "name": "Win11 Fluent Dark",
  "version": "1.0.0",
  "author": "…",
  "description": "…",
  "plugin_type": "skin",        // 手册口径
  "type": "skin",               // 样例口径（对冲）
  "theme_css": "theme.css",
  "window": { "width": 1120, "height": 800, "resizable": true } }
```

（本仓库的 `build_skins.py::manifest(v)` 就是这么发的。**再加一条权威证据**：`open-revo.exe` 的 Rust 侧
明文字符串里同时出现 `plugin_type` @ 6887819 与 `load_plugin_theme_css` @ 6923005（2026-10-03 构建），
说明内核就是按键名 `plugin_type` 取值的；双发 `type` 只是对冲，不影响行为。）

## 2. 生成器结构（`build_skins.py`）

```
VARIANTS            # 四套变体的全部差异：id / 名称 / 强调色 / 圆角 / 窗口尺寸 / 明暗 / 字体
token_block(v)      # 生成 --wf-* 令牌块
hue_block(k, value) # 生成一组强调色令牌 + 镜像（见第 3 节）
manifest(v)         # 生成 manifest.json（含双键对冲）
build_theme_css(v, base_src)
                    # 读 src/base.css，把 __SKIN_ID__ 替换成真实 id，前置 token_block
make_preview(v,path)# 生成 assets/preview.png
main                # python build_skins.py [--install] [--preview]
```

（2026-10-03 实测行号，便于跳转：`VARIANTS` :45、`token_block` :344、嵌套的 `hue_block` :349、
六个色键调用 :408–413、`manifest` :459、`build_theme_css` :490、`make_preview` :521、`main` :623。）

* `src/base.css` 是**纯结构**文件：每个选择器都带 `__SKIN_ID__` 占位，构建时才落地成 `[data-skin="<id>"]`。
* **新增一套变体只改 `VARIANTS`**，不要手写第二份 CSS。
* `--install` 把 `<id>\{manifest.json,theme.css,assets\preview.png}` 拷进 `%APPDATA%\OpenRevo\plugins\<id>\`。
* 校验安装是否最新：`<id>\theme.css` 与已装副本**逐字节比较**（0.8.8 时代四套为 50,596 / 50,483 / 50,393 / 50,323 B）。
  ⚠️ 当前四套产物已从仓库与插件目录删除（见 `SKILL.md` §0.1），要校验先 `python build_skins.py --install`。

## 3. 令牌架构与 `--wf-hue-*` 镜像（必看）

皮肤自身令牌统一 `--wf-*` 前缀（`--wf-bg`、`--wf-surface`、`--wf-control`、`--wf-control-stroke`、
`--wf-stroke`、`--wf-stroke-strong`、`--wf-text`、`--wf-text-2`、`--wf-text-3`、`--wf-scroll`、
`--wf-window-stroke`、`--wf-radius-sm`、`--wf-sidebar-w`、`--wf-blur`、`--wf-blur-soft`、`--wf-mica-1/-2` …）。

强调色走 `hue_block(key, value)`，一次发**八个**变量：

```
--theme-<k>            = value
--theme-<k>-border     = value @ 40%
--theme-<k>-dim        = value @ 14%
--theme-<k>-glow       = value @ 30%
--wf-hue-<k>           = 同 --theme-<k>          ← 镜像，必须发
--wf-hue-<k>-border    = 同 -border
--wf-hue-<k>-dim       = 同 -dim
--wf-hue-<k>-glow      = 同 -glow
```

**为什么必须镜像**：宿主在 `.mini-drawer-root[data-theme=mono|cyber]`（0,2,0）上**局部重新声明**整套 `--theme-*`
（mono 下是纯白系列）。CSS 自定义属性的规则是「**元素上的局部声明胜过继承值**」，所以皮肤在主控台 `:root`
层写的 `--theme-*` 到迷你面板里会被宿主的局部值压掉。皮肤于是：

1. 在 `[data-skin="<id>"] .mini-drawer-root[data-theme]`（0,3,0）这一层**再声明一次**面板需要的令牌；
2. 值一律读**镜像变量** `--wf-hue-*`（它们来自 `:root`，宿主不认识、也不会重声明）。

这就是「迷你面板的强调色必须是皮肤色而不是宿主 mono 白」的全部机理。走 `hue_block` 的键：
`pwr`（性能/电源）、`bat`（电池）、`gpu`、`hz`（刷新率）、`kbd`（键盘背光）、`lux`（亮度）。

### 3.1 配色纪律：只有两个强调色（硬约束）

上面那六个 `hue_block` 键**保留名字，但只发两个颜色**——这是用户口径（m00001 / m00053）：

| 令牌 | 角色 | 谁在用 |
|---|---|---|
| `--wf-accent` + 派生 | **系统主题色** | 一切可交互 / 已选中 / 已启用 |
| `--wf-important` + 派生 | **重要强调色**（暖橙） | 只用于性能 / 功率 / 需要注意的状态 |
| `--wf-ok` / `-warn` / `-error` | 状态语义色 | 只表达真实状态，**不得当装饰** |

```python
hue_block("pwr", v["important"])                                    # 性能模式 → 暖橙
for _hue_slot in ("gpu", "hz", "lux", "kbd", "bat"):
    hue_block(_hue_slot, v["accent"])                               # 其余五个 → 系统主题色
```

派生别名（也在 `token_block()` 里发）：

```css
--wf-important: var(--wf-hue-pwr);
--wf-important-soft: var(--wf-hue-pwr-dim);
--wf-important-border: var(--wf-hue-pwr-border);
--wf-important-glow: var(--wf-hue-pwr-glow);
--wf-important-strong: <每个变体单独调的深/浅号>;
```

**为什么保留六个槽位名而不是删掉五个**：宿主 mini 的**内联样式**读的就是 `var(--theme-pwr/gpu/hz/lux/kbd/bat)`
这六个名字（主控台大面板一处都不用）。删掉槽位名 = 整块失效；正确做法是保留名字、收敛取值。

**宿主主控台自绘部件另有私有令牌** `--accent-pwr / -beast / -gpu / -cool / -rgb / -lux`
（电源徽标、休眠守卫、电池模式单选等读它们），皮肤此前完全没碰过 → cyber 主题下彩虹、mono 主题下纯白。
一并归一：`pwr`、`beast` → `important`；`gpu`、`cool`、`rgb`、`lux` → `accent`（各带 `-dim`/`-border`/`-glow`）。

> ⚠️ **`--wf-accent-glow` 不存在**。accent 的完整令牌表是
> `--wf-accent` / `-hover` / `-press` / `-soft` / `-soft-strong` / `-border` / `-strong` / `-shadow` / `-on-accent`。
> 误用不存在的令牌**不会报错**：`box-shadow` 在 computed-value 阶段变 invalid 而静默退化成 `none`，
> 只有审计读数能发现。需要发光的强调环时用 `--wf-accent-shadow`（`rgba(accent,.22)`）。

## 4. 特异性阶梯（本项目实测有效的层数）

| 层 | 选择器形态 | 权重 | 作用 |
|---|---|---|---|
| 1 | `[data-skin="X"] :root` / `[data-skin="X"]` | (0,1,0)+ | 基础 `--wf-*` 令牌、全局观感 |
| 2 | `[data-skin="X"] .mini-drawer-root[data-theme]` | **(0,3,0)** | **迷你面板令牌重声明**（压宿主 (0,2,0) 的局部声明） |
| 3 | `[data-skin="X"] .mini-drawer-root .m-quick-btn.active` | (0,4,0) | 压宿主的 `[data-theme=mono] .m-quick-btn.active` (0,3,0) |
| 4 | `[data-skin="X"] .acrylic-container:has(> .sub-nav-wrapper) …` | **(0,6,0)+`!important`** | 主控台栅格重排，压宿主的 `[data-theme=mono] .nav-tab.tab-sponsor.active{…!important}` (0,4,0)+`!important` |

规律：**宿主用 `!important` 的地方，皮肤只能靠「更高特异性 + `!important`」赢**；宿主用内联样式的地方，
皮肤靠「`!important`」赢（不涉及特异性）。

## 5. 主控台改造配方（§14 WinUI3 侧栏 + 不透明）

```css
[data-skin="X"] .acrylic-container{
  background: var(--wf-bg) !important;      /* 实色，干掉 #0b0e14f0 的径向渐变 */
  backdrop-filter: none !important;         /* 干掉 blur(24px) saturate(180%) */
  box-shadow: inset 0 0 0 1px var(--wf-window-stroke) !important;
  border-radius: 0 !important;
}
/* 栅格重排：只在「确实有侧栏 DOM」时生效，迷你面板没有 .sub-nav-wrapper，天然隔离 */
[data-skin="X"] .acrylic-container:has(> .sub-nav-wrapper){
  display: grid !important;
  grid-template-areas: "wf-titlebar wf-titlebar" "wf-sidebar wf-content" !important;
  grid-template-columns: var(--wf-sidebar-w) minmax(0,1fr) !important;   /* 224px */
  grid-template-rows: auto minmax(0,1fr) !important;
}
[data-skin="X"] .mech-titlebar{ grid-area: wf-titlebar !important; }
[data-skin="X"] .sub-nav-wrapper{ grid-area: wf-sidebar !important;
  border-right: 1px solid var(--wf-stroke) !important; background: var(--wf-surface) !important; }
[data-skin="X"] .sub-nav-bar{ flex-direction: column !important; height:100% !important; background:transparent !important; padding: 10px 8px !important; }
[data-skin="X"] .nav-tab{ text-align:left !important; width:100% !important; }
[data-skin="X"] .nav-tab.tab-sponsor.active{ /* 压宿主 (0,4,0)!important —— 记得再加一层 + !important */ }
@layer? 不需要。
/* 窄窗回退：窗口 CSS 宽度 < 760px 时导航退回顶部横条 */
@media (max-width: 760px){ … }
```

* `:has(> .sub-nav-wrapper)` 本身计 (0,1,0)，所以整条选择器 (0,6,0) 才够压住宿主 (0,4,0)+`!important`。
* 真机上 224px 侧栏的实际视觉分界在 CSS `224.7 / 225.3` 附近（`--wf-sidebar-w: 224px`），可用来验收。
* 参考原型 `D:\LIPis\desktop\openrevo ui` 的版式：`.pro-layout{display:grid;grid-template-columns:224px minmax(0,1fr)}`、
  `.pro-sidebar{padding:20px 14px;border-right:1px solid var(--pro-border);background:var(--pro-surface2)}`、
  `.pro-nav button{padding:12px;border-radius:6px;font-size:13px}`、
  `button.active{background:var(--pro-accent-soft);color:var(--pro-accent);font-weight:700}`、
  `.pro-titlebar{height:62px;padding:0 22px}`。

## 6. 迷你面板改造配方（§8）

1. **8.1 令牌重声明**（0,3,0，见第 3 节）：
   `--bg-card: var(--wf-surface)`、`--border-subtle: var(--wf-stroke)`、`--border-hover: var(--wf-stroke-strong)`、
   `--text-muted: var(--wf-text-2)`、`--text-dim: var(--wf-text-3)`、以及 6 组强调色 × 4 个变量 = `--wf-hue-*`。
2. **8.2 去半透明**（必须 `!important`，因为宿主是内联样式）：
   ```css
   [data-skin="X"] .mini-drawer-root{
     background: var(--wf-bg) !important;        /* 干掉内联 rgba(12,15,22,.96) */
     backdrop-filter: none !important;           /* 干掉内联 blur(28px) */
     border: 0 !important;                       /* 别加 border：迷你面板纵向余量只剩 11px（pitfalls #26），描边走 box-shadow: inset */
     border-radius: 0 !important;
     box-shadow: inset 0 0 0 1px var(--wf-window-stroke) !important;
     scrollbar-width: thin; scrollbar-color: var(--wf-scroll) transparent;
   }
   ```
3. **8.3 组件层**：`.m-quick-btn.active`（(0,4,0)）、`.m-select-item`/`.m-mon-dropdown-item`、
   `.m-mon-badge-hz`、`.m-foot-btn.expand`，以及 mini 内各内联颜色按钮的 `!important` 覆盖。
4. **8.4 内联属性覆盖**：只针对宿主写在内联 `style` 上的属性用 `!important`，其余一律不用，避免污染。
   实测需要覆盖的内联色（令牌管不到，只能用 `[attr*="…"]` 属性选择器命中）：

   | 目标 | 命中方式 | 宿主内联值 → 皮肤值 |
   |---|---|---|
   | READY 圆点 | `.m-quick-grid + div > div:last-child > div` | `#34d399` → `--wf-accent`（+ `--wf-accent-shadow` 做辉光） |
   | READY 文字 | `.m-quick-grid + div > div:last-child > span` | `#6ee7b7` → `--wf-accent` |
   | 主题配色切换按钮 | `button[title*="极简纯单色"]` | cyber 态 `rgba(56,189,248,.15)`/`#38bdf8` → accent 三件套 |
   | OEM 服务**运行中** | `button[title*="正在运行"]` | `rgba(245,158,11,.15)`/`#fbbf24` → `--wf-important-*` |
   | OEM 服务**已被屏蔽** | `button[title*="已被屏蔽"]` | `rgba(56,189,248,.1)`/`#38bdf8` → accent 三件套 |
   | OEM 助手弹窗 / 极客调校浮层 | `[style*="position: fixed"]` | `--wf-warn` → `--wf-important-border` |
   | 头部赞助心形 | `[data-tauri-drag-region] button[title*="支持作者"] svg` | `#f43f5e` → accent |
   | 品牌 logo 光晕 | `img` | 内联 `filter: drop-shadow(… #f43f5e/#10b981/#38bdf8)` → `filter: none !important` |
   | 开机自启复选框 / 文字 | `input[type=checkbox]`、`label > span` | `accentColor:#38bdf8`、`#f1f5f9` → accent / `--wf-text-*` |

   **两态按钮靠 title 文案区分**（宿主用同一套 padding/字号，只换 title）——所以 `*=` 子串匹配就够，不需要 `:has()`。
   注意 `[style*="position: fixed"]` 是**近似**命中，真机上这两个浮层是条件渲染的，未做完整复刻（见 devlog §8.3）。

## 7. 滚动条

```css
[data-skin="X"] ::-webkit-scrollbar{ width:12px; height:12px }
[data-skin="X"] ::-webkit-scrollbar-thumb{
  background: var(--wf-scroll);
  background-clip: padding-box;                 /* 关键：让 12px 视觉上只剩 4px */
  border: 4px solid transparent;
  border-radius: 999px;
}
```

* 宿主原本是 `::-webkit-scrollbar{width:4px}` + `#ffffff29` 圆角滑块；皮肤改成 12px 槽 + padding-box 只显示 4px。
* **已知副作用**：迷你面板纵向滚动条从 4px 加宽到 12px 后，会在底部引出一条细横向滚动条
  （宿主自身内容 **410×621** CSS > 窗口 610，纵滚就是宿主固有的）。若要去掉，可加
  `overflow-x: hidden !important`（本仓库暂未采用，用户选择先看观感）。

## 8. 预览专用修正（不要进入 theme.css）

预览页为了在浏览器里模拟固定尺寸窗口，用了内联 `width:100vw;height:100vh` 的舞台，
所以 `preview-mini.html` 里另有一段**仅预览**规则：

```css
.pv-stage .mini-drawer-root{ width:100% !important; height:100% !important }
```

这类规则**只存在于预览页**，不要写进 `src/base.css`。

## 9. 四套变体参数

| id | 系统主题色 `--wf-accent` | 重要强调色 `--wf-important` | 圆角 | 窗口(CSS) | 字体 | `--on-accent` | `--wf-bg` |
|---|---|---|---|---|---|---|---|
| `skin-win11-light` | `#0067c0` | `#ca5010`（strong `#8a3707`） | 8/12px | 1120×800 | Segoe UI Variable Text | `#fff` | `#f3f3f3` |
| `skin-win11-dark`  | `#60cdff` | `#ff9d5c`（strong `#ffc9a3`） | 8/12px | 1120×800 | Segoe UI Variable Text | `#000` | `#202020` |
| `skin-win10-light` | `#0078d4` | `#d83b01`（strong `#9c2a00`） | 2px    | 1080×780 | Segoe UI | `#fff` | `#f3f3f3` |
| `skin-win10-dark`  | `#1683d8` | `#ff8c00`（strong `#ffbe7a`） | 2px    | 1080×780 | Segoe UI | `#000` | `#202020` |

深色通用值：`--wf-control: rgba(255,255,255,.06)`、`--wf-control-stroke: rgba(255,255,255,.09)`、
`--wf-radius-sm: 4px`、`--wf-text: #f4f0f5`、`accent-soft: rgba(96,205,255,.14)`（win11-dark）、
flyout `rgba(44,44,44,.92)`；win11-light 的 `--wf-control: rgba(255,255,255,.70)`、win10-light `rgba(255,255,255,.78)`。
迷你面板深色审计基线（**二色体系**）：六个 `--theme-*` 槽位里只有 `--theme-pwr` 是暖橙（win11-dark `#ff9d5c`），
`gpu/hz/lux/kbd/bat` 全部 = `--wf-accent` `#60cdff`；`--bg-card=rgba(255,255,255,.055)`、`--text-mut=#c9c5ce`；
`--wf-blur/--wf-blur-soft: 0px`、`--wf-mica-1/-2: transparent`。
验收口径见 `preview-and-audit.md`：`dom.hueFamilies = 2` + `census.py` 色族 = 2 —— **但只看这两条会骗人**
（坏读数里全是宿主原色时族数也恰好是 2，见 `pitfalls.md` #35 / #39）。跑 `bash _tools\verify.sh`，
它把正向条件（`skin_active`、`rules_applied = 118`、`settle.remounts = 1`、六槽令牌、五个探针色值）
一并断言，**只有它的 exit code 才算验收结论**。
