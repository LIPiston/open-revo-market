# OpenRevo 原生 Windows 组件 UI 皮肤套件

按《OpenRevo 第三方插件开发手册 v1.0》**用例 7（皮肤插件 / skin）** 开发的四套原生 Windows 组件风格皮肤，
让 OpenRevo 主控制台变成 WinUI / Fluent Design 的原生 Windows 观感（Mica 材质、Fluent 控件、Segoe UI Variable 字体）。

> ⚠️ **皮肤目录已移除（2026-10-17）。** 仓库里原来的四个产物目录
> `skin-win11-light\` / `skin-win11-dark\` / `skin-win10-light\` / `skin-win10-dark\` **已删除**，
> 宿主 `config.json` 里对应的残留开关也一并清掉。**构建工具链保留**（`build_skins.py` + `src\base.css`），
> 需要时随时可重建：
>
> ```bash
> python build_skins.py            # 重新生成四个 skin-<id>\ 子目录
> python build_skins.py --install  # 生成并安装到 %APPDATA%\OpenRevo\plugins\
> ```
>
> 下面 §1–§10 仍是这四套皮肤的**完整设计与验收记录**（工具链与文档都在，内容没有作废）。
> 之所以保留工具链：背景插件 `bg-custom` 依赖它（`build_background.py` / `bg_common.py` 都 `import build_skins`），
> 删掉会连带弄坏背景插件。

另有一个**独立于皮肤**的插件 `bg-custom`：只把一张本地图片铺成窗口背景，不改配色与布局（见 **§11**）。
它原先与 Fluent 皮肤**没有依赖关系**；⚠️ **0.8.7 时代它在宿主层面与皮肤互斥**（只有一条 CSS 注入通道、
`active_skin` 单值）；**0.8.8 起宿主新增 `plugin_type:"background"` 的第二条通道，两者可同时启用**
（详见 §11.3）。本仓库当前产物仍是 `plugin_type:"skin"` 形态。

再另有一个**插件市场** `plugin-market`（新增【插件市场】选项卡，自助浏览/获取插件，见 **§12**）：
它按 GitHub topic `openrevo-plugin` 自动收录第三方插件。它与皮肤/背景**无关**，
基线也不同（皮肤/背景针对 **0.8.8**，市场针对 **0.9.1**，因为宿主自我更新过）。

---

## 1. 四套皮肤（设计规格；产物需重建）

> 下表是四套皮肤的**设计规格**。产物目录已于 2026-10-17 删除（见文首说明），
> 跑一次 `python build_skins.py` 即可按规格重新生成。

| 插件 ID | 风格 | 强调色 | 圆角 | 声明视窗 | 字体 |
|---|---|---|---|---|---|
| `skin-win11-light` | Windows 11 Fluent（浅色 / Mica） | `#0067c0` | 8px | 1120 × 800 | Segoe UI Variable Text |
| `skin-win11-dark`  | Windows 11 Fluent（深色 / Mica Dark） | `#60cdff` | 8px | 1120 × 800 | Segoe UI Variable Text |
| `skin-win10-light` | Windows 10 Fluent（浅色 / Acrylic） | `#0078d4` | 2px | 1080 × 780 | Segoe UI |
| `skin-win10-dark`  | Windows 10 Fluent（深色 / Acrylic） | `#1683d8` | 2px | 1080 × 780 | Segoe UI |

Win11 与 Win10 的差异不只是配色，而是整套 Fluent 世代语汇：

* **圆角**：Win11 用 4/8px 连续圆角（`--radius-md:8px`、`--radius-lg:12px`），Win10 用 2px 近乎直角。
* **字体**：Win11 用 `Segoe UI Variable Text`（常规）/ `Segoe UI Variable Display`（大号数值）；Win10 退化为 `Segoe UI`。
* **材质**：Win11 模拟 Mica（桌面着色 + 极低透明度的实心层），Win10 模拟 Acrylic（更强模糊 + 噪点层次）。
* **控件**：Win11 导航选中态是圆角胶囊 + 淡色强调底，Win10 是左对齐强调色指示条 + 同色文字。

### 1.1 主窗版式：WinUI3 左侧栏 + 完全不透明

四套皮肤都把宿主原本的**顶部横向 tab 条**改成 **WinUI3 风格的左侧导航栏**（224px，带 `NAVIGATION` 分组标题、
选中项左侧 3px 强调色指示条、40px 行高、13px 常规字重），并把窗口根容器 `.acrylic-container` 从
`#0b0e14f0 + backdrop-filter: blur(24px) saturate(180%)` 改成**完全不透明**的实色底。

* **版式**用 CSS Grid 重排 `.acrylic-container`：
  `grid-template-columns: 224px minmax(0,1fr)` / `grid-template-areas: "wf-titlebar wf-titlebar" "wf-sidebar wf-content"`，
  三个直接子元素（`.mech-titlebar` / `.sub-nav-wrapper` / **无类名的内容区**）分别落进 `wf-titlebar` / `wf-sidebar` / `wf-content`。
  宿主把 `display:flex; flex-direction:column` 写在**内联 style** 里，所以只有 author `!important` 压得过它
  （无头审计实测 `display === grid`，见 §7）。
* **`:has()` 兼作降级守卫**：整段侧栏规则都以 `.acrylic-container:has(> .sub-nav-wrapper)` 为前缀。
  万一 WebView2 太老不支持 `:has()`，规则整段不匹配，宿主的横向 tab 条原样保留，绝不会出现「容器还是 flex、
  按钮却排成一列」的破版；迷你面板（根节点是 `.acrylic-container` 但没有 `.sub-nav-wrapper`）也因此完全不受影响。
  `:has(> .x)` 的特异性按参数计 (0,1,0)，本层选择器因此升到 (0,6,0)+`!important`，
  稳赢宿主最强的 `[data-theme=mono] .nav-tab.tab-sponsor.active` (0,4,0)+`!important`。
* **不透明化**：`background: var(--wf-bg) !important`（浅 `#f3f3f3` / 深 `#202020`，均为实色）+ `backdrop-filter: none !important`，
  并统一清掉 `.glass-card` 等部件上的模糊；侧栏再叠一层 4% 的薄色差（深色提亮、浅色压暗）做层次，合成后仍完全不透明。

### 1.2 配色纪律：只有两个强调色（硬约束）

宿主原版是「一个部件一个颜色」——mini 面板六个指标卡六种色相、四种性能模式四种颜色、九个导航 tab 九种颜色。
本套皮肤把装饰色**收敛到两个**：

| 令牌 | 角色 | 用在哪 |
|---|---|---|
| `--wf-accent` | **系统主题色**（该变体的 Win 强调色） | 一切**可交互 / 已选中 / 已启用**：导航选中态、tab 胶囊、按钮选中、开关、焦点环、滑块、指标卡（性能模式除外） |
| `--wf-important` | **重要强调色**（暖橙） | 只用于**性能 / 功率**与**需要注意**：mini 性能模式卡、狂暴档、功率徽标、休眠守卫、OEM 服务运行中 |
| `--wf-ok` / `--wf-warn` / `--wf-error` | 状态语义色 | 只表达真实状态（设备开/关、温度告警），**不得当装饰** |

* `--theme-pwr` → `--wf-important`，`--theme-{gpu,hz,lux,kbd,bat}` → `--wf-accent`（宿主 mini 的六个槽位名保留，取值收敛）；
  宿主私有的 `--accent-pwr/-beast` → `--wf-important`，`--accent-gpu/-cool/-rgb/-lux` → `--wf-accent`。
* mini 面板的验证结论：**像素级色相族普查 = 2 族**（系统主题色 + 重要强调色），改造前是 6 族。证据见 §7 第 8 条。

## 2. 目录结构与安装位置

> **产物需重建**：下面这份目录树是 `python build_skins.py` 的**输出**（仓库根下的四个子目录），
> 以及 `--install` 后插件目录里的副本。**当前仓库与插件目录里都没有这四套皮肤**（2026-10-17 已删）。

```
<仓库根>\                                   # 构建产物落在这里
├── skin-win11-light\
│   ├── manifest.json      # ↑ 每套皮肤只含这三样，符合手册 §7 的皮肤目录规范
│   ├── theme.css          #   55,967 B，全部样式集中在一个文件
│   └── assets\
│       └── preview.png    #   插件管理面板展示用缩略图（640×360）
├── skin-win11-dark\      …（同上）55,867 B
├── skin-win10-light\     …（同上）55,776 B
└── skin-win10-dark\      …（同上）55,701 B

C:\Users\LIPis\AppData\Roaming\OpenRevo\plugins\   # --install 后的副本位置
└── plugin-market\        # 当前插件目录里只有市场（皮肤未装）
```

为什么只有一个 `theme.css`？因为宿主是把它整份注入 `<style id="openrevo-custom-skin">`（手册 §7），
`@import` 会按宿主文档的 base URL（`tauri://` 协议）解析而取不到插件目录里的相对路径文件，
所以**必须**把令牌与组件样式合并进单一文件——不要拆成 `css/themes/xxx.css` 那种多文件结构。

### 2.1 命名沿革（2026-10-04 重命名）

项目根 `openrevo-win-skin\` → **`openrevo-plugins\`**，四套皮肤从「一个 `dist\` 里的构建产物」
升格为「根目录下的四个子文件夹项目」，插件 ID 同时去掉 `fluent` 前缀：

| 旧插件 ID（`dist\<id>\`） | 新插件 ID（根级子目录） |
|---|---|
| `win11-fluent-light` | **`skin-win11-light`** |
| `win11-fluent-dark`  | **`skin-win11-dark`**  |
| `win10-fluent-light` | **`skin-win10-light`** |
| `win10-fluent-dark`  | **`skin-win10-dark`**  |

* 改名是**纯命名**：四套 `theme.css` / `manifest.json` 除 ID 字符串外逐字节未变
  （与改名前的 `dist\<旧id>\` 产物 `cmp` 一致），宿主行为不受影响。
* 尺寸因此每套少了 440 B —— 新 ID 比旧 ID 短 1 个字符，而它在一个文件里出现约 440 次。
* 已装副本当时已同步换名：`%APPDATA%\OpenRevo\plugins\` 下的旧目录删除、四套新目录就位。
  （**2026-10-17 起这四套已全部从仓库与插件目录移除**，见文首说明；本节保留为历史记录。）
* ⚠️ 改 `active_skin` 必须在**宿主停机时**做 —— 宿主运行中持有权威内存态、会把 `config.json` 整份覆盖回去。
  正确流程：提权停宿主 → 改 `active_skin` → 启宿主（`_tools\set-active-skin.ps1` 已封装守卫）。
  当前插件页【刷新】= 重扫列表 **+ 热重载当前样式**，装新目录/改 `theme.css` 点一次【刷新】即可；
  但 `active_skin` 指向已删 ID 这种残局仍必须停机改配置 + 重启（见 §11.2、`pitfalls.md` #37）。
## 3. 本地预览（不装、不改宿主也能看效果）

直接双击打开：

```
D:\LIPis\Documents\code\openrevo-plugins\preview.html
```

> 预览页读的是**同目录** `<id>/theme.css`（XHR 取文本再灌进 `<style id="openrevo-custom-skin">`，与宿主同一条路径），
> 所以改完 `src\base.css` 跑一次 `python build_skins.py` 就能在页面上看到新效果。
> **别去开另一棵镜像树里的预览页**——`_tools\*.sh` 原先硬编码了镜像树的绝对路径，导致「改了 A 树、审计了 B 树」。现已改成本脚本所在目录。

页面用**真实宿主类名**复刻了主窗骨架（标题栏 / 导航 / 卡片 / 电源模式 / 指标 / 开关 / 迷你面板 / OSD / 拖放区），
顶部四个按钮可即时切换四套皮肤，等同于在宿主里拨开关的效果。

更重要的是：页面会先加载 `_extracted/host-shell.css`——它是**从 `open-revo.exe` 里原样抽取的宿主真实 CSS**
（`.acrylic-container` / `.mech-titlebar` / `.sub-nav-wrapper` / `.sub-nav-bar` / `.nav-tab*` / `.glass-card`，40 条规则），
并且按宿主的运行时顺序（先宿主、后皮肤）排列。`<html>` 上写死 `data-theme="mono"`（宿主默认主题，最不利场景），
DOM 也是逐字复刻宿主 JSX 的结构（三个直接子元素、内容区**无类名**、导航按钮带 `<svg>`）。
因此在预览页里看到的级联结果与真机一致，包括皮肤能否压过宿主那些 `!important` 的选中态。

URL 参数：

| 参数 | 作用 |
|---|---|
| `#skin-win11-dark` | 用 hash 直接指定打开时激活哪套皮肤 |
| `?notrans=1` | 关闭全部过渡动画（截图 / 逐像素比对用） |
| `?audit=1` | 同上，并在 `window.load + 500ms` 后把关键元素 computedStyle 写进 `<pre id="pv-audit">`，供无头浏览器抓取 |
| `?allactive=1` | 给「非当前」的 tab 也加 `.active`，用来验证皮肤能否压过宿主逐 tab 的 `!important` 选中态 |
| `?bare=1` | 去掉页面留白，让窗口填满视口（整张截图就是窗口本体，用于像素判据） |
| `?bgprobe=1` | 把页面底色换成纯品红，与棋盘格底各截一张做**逐像素差分**，专门证明窗口已经不透明 |
| `?nofix=1` | 隐藏预览页自带的夹具（`SAFE MOCK` 徽标、六色令牌探针卡、隐藏的档位激活态），供 `_tools\census.py` 做像素级色彩普查 |
| `[data-pv-fixture]` | 夹具标记：**不是宿主 UI** 的预览元素都打这个属性，审计的 DOM 普查与 `?nofix=1` 会一并跳过它们 |

底图是一张 26px 的**棋盘格**：窗口若仍半透明，格子会直接透出来，一眼可辨。

## 4. 二次开发

```
openrevo-plugins\                # ← 项目根（2026-10-04 由 openrevo-win-skin 改名）
├── skin-win11-light\        # ✗ 已删（2026-10-17）。`python build_skins.py` 会按 §1 的规格重建
│   ├── manifest.json        #   子目录项目 = 一套可直接装进 plugins\ 的皮肤插件
│   ├── theme.css            #   ├─ 这三样就是插件的全部
│   └── assets\preview.png   #   └─ 插件管理面板缩略图（640×360）
├── skin-win11-dark\         ✗ 已删（同上）
├── skin-win10-light\        ✗ 已删（同上）
├── skin-win10-dark\         ✗ 已删（同上）
├── bg-custom\               # ★ 独立背景插件（可选）：只铺背景，与四套皮肤无依赖
│   ├── manifest.json        #   plugin_type:"skin"（当前产物形态；0.8.8 起可改 background 通道）
│   ├── theme.css            #   139 KB = 3 条背景规则 + 内联 base64 图片
│   └── assets\              #   background.jpg（成品）+ preview.png（卡片缩略图）
├── bg.config.json           # ★ 背景构建真值：源图路径 + fit/position/overlay/blur/scope/targets
├── bg_common.py             # ★ 背景共享层：配置、颜色、PIL 编码、CSS 渲染（import build_skins）
├── build_background.py      # ★ 背景 CLI：set / off / build / install / status
├── src\background.css       # ★ 背景段模板（__BG_*__ 占位符 + scope 裁剪标记）
├── assets\sample-wallpaper.jpg  # ★ 确定性示例图（任何 clone 都能 build 出同一产物）
├── src\base.css            # 结构层：全部组件规则，用 __SKIN_ID__ 占位符标记皮肤命名空间（13 节 + 第 14 节 WinUI3 侧栏重排）
├── build_skins.py          # 生成器：令牌表 + base.css → 上面那四个 skin-*\ 子目录
├── preview.html            # 本地预览页（加载宿主真实 CSS，见 §3）
├── preview-mini.html       # 迷你面板预览（410×610，逐字复刻真实 mini DOM）
├── _extracted\             # 从 open-revo.exe 里抽出来的宿主原始资源
│   ├── index-C535NsqC.css  #   宿主完整 CSS（50,997 字节 / 332 条规则）
│   ├── bundle.partial.js   #   宿主前端 bundle（584,148 字节，尾部被截断）
│   ├── host-shell.css      #   从上面抽出的外壳相关规则（40 条），预览页直接引用
│   ├── _host_mini.css      #   迷你面板子集（宿主 mini 的令牌与内联色真值）
│   └── css_selectors.txt   #   332 条选择器清单
├── _tools\
│   ├── verify.sh           # 验收总闸：重跑两页审计 + 逐条断言验收表（含 settle.remounts=1）
│   ├── audit.sh            # 无头 Chrome 跑四套变体的 computedStyle 审计 → _audit/<id>.audit.txt
│   │                       #   PAGE=preview-mini.html bash _tools/audit.sh   → 迷你面板四套
│   ├── _stress.sh          # 并发压测：N 次并发跑同一页，逐次与单跑参考 diff（抓偶发竞态，见 pitfalls #39）
│   ├── shots.sh            # 截图：视口=窗口本体的 bare 图 + 整页预览图 + 品红差分探针图 + nofix 清洁图
│   ├── census.py           # PNG 像素级色相族普查（验收「只剩两个色族」的物证）
│   └── set-active-skin.ps1 # 宿主停机时把 config.json 的 active_skin 换成新皮肤 ID（宿主会回写，见 pitfalls #37）
├── _audit\                 # 审计输出（*.dom.html 原始 DOM + *.audit.txt 抽取段，含 mini-<id>.*）
├── _shots\                 # 无头 Chrome 渲染的效果图
└── README.md
```

常用命令（在 `openrevo-plugins\` 目录下执行）：

```bash
python build_skins.py             # 只构建到仓库根的四套 skin-*\
python build_skins.py --install   # 构建并安装到 %APPDATA%\OpenRevo\plugins\
bash _tools/verify.sh             # 验收总闸：重跑两页审计 + 逐条断言，全绿才算过（NO_AUDIT=1 复用已有产物）
bash _tools/audit.sh              # 四套变体 computedStyle 审计（可跟 1~2 个 id 只跑指定变体）
PAGE=preview-mini.html bash _tools/audit.sh   # 迷你面板四套变体的审计
PAGES=preview-mini.html:mini bash _tools/_stress.sh 48 8   # 回归压测：改过预览页/皮肤 CSS 后跑，须「异常 0 次」
bash _tools/shots.sh              # 重出全部截图（含 <id>-clean.png）
python _tools/census.py _shots/mini-skin-win11-dark.png   # 像素级色相族普查

python build_background.py set --image D:\wallpaper.jpg   # 设自定义背景（只出独立插件 bg-custom）
python build_background.py status                         # 看当前背景配置与产物状态
python build_background.py off                            # 停用并删除背景产物
bash _tools/verify-bg.sh                                  # 背景验收（第一条就是「既有 132 条无回归」）
bash _tools/verify-bg.sh off                              # 停用后的零泄漏验收
```

**新增一套皮肤**：在 `build_skins.py` 的 `VARIANTS` 列表里加一个 dict（`id / name / desc / window_size / font / on_accent / radius…`
以及色彩键），重跑 `--install` 即可。`base.css` 里所有选择器都写作 `[data-skin="__SKIN_ID__"] .xxx`，
生成时会把 `__SKIN_ID__` 替换成该变体 ID，所以**新皮肤不需要改任何选择器**。

**改组件样式**：只改 `src/base.css`，它是一份纯结构文件；颜色/圆角/阴影一律走 `var(--wf-*)`，由 `token_block()` 按变体注入。

## 5. 关于“手册示例选择器”与真实发行版的差异（重要）

开发手册 §7 的示例 CSS 用了 `.nav-tab`、`.overview-main-grid`、`.sensor-gauge-cluster`、`.cooling-fan-card`、
`.power-mode-selector` 这些类名。**在宿主实际发行的构建里这些名字并不存在**——它们是在 WebView2 的 V8 代码缓存
（`%LOCALAPPDATA%\com.openrevo.controlcenter\EBWebView\Default\Code Cache\js\`，72 个文件）里逐字检索确认的：
`overview-main-grid`、`sensor-gauge`、`nav-tab`、`--surface-card`、`--core-accent` 命中数均为 **0**。

因此本套件以**真实类名**为准，同时保留手册示例类名作为前向兼容层（第 12 节），两边都不会白写：

| 用途 | 手册示例名（**发行版中不存在**） | 本套件实际使用的真实类名 |
|---|---|---|
| 外壳 | `.acrylic-container` ✅ | `.acrylic-container`、`.mech-titlebar`、`.logo-badge` |
| 卡片 | `.glass-card` ✅ | `.glass-card`、`.border-glow`、`.glow-color`、`.surface-badge`、`.badge-tag` |
| 导航 | `.nav-tab.active` ✅ | `.nav-tab` + `.tab-overview / .tab-gpu / .tab-tuning / .tab-lighting / .tab-water / .tab-plugins / .tab-system / .tab-sponsor` |
| 电源模式 | `.power-mode-selector` ❌ | `.mode-btn` + `.active-office / .active-balance / .active-beast / .active-custom` |
| 指标 | `.sensor-gauge-cluster` ❌ | `.metric-value / .metric-label / .metric-unit / .metric-pill` |
| 开关 | `.toggle-btn` ✅ | `.toggle-btn`（`.on` / `.active` / `[aria-checked="true"]`） |
| 迷你面板 | `.cooling-fan-card` ❌ | `.mini-drawer-root`、`.m-card`、`.m-card-header`、`.m-chip`、`.m-quick-btn`、`.m-select-menu` 等 |
| 网格 | `.overview-main-grid` ❌ | 真实布局是 flex，故仅在第 12 节做前向兼容 |

运行期令牌同理：手册的 `--core-accent / --surface-card / --color-beast / --radius-md / --status-ok` 全部照写，
同时也写宿主前端实际使用的那一套（`--accent-color / --surface-badge / --border-subtle / --color-office / --color-balance /
--text-muted / --text-dim / --theme-pwr|bat|gpu|hz` 及其 `-border/-dim/-glow`），两套同时提供，谁生效都不会脱色。

## 6. 样式隔离（手册 §7 L659 的硬性要求）

手册规定：皮肤激活时宿主根容器会自动挂载 `data-skin="<skin_id>"`，**所有选择器必须以 `[data-skin="<skin_id>"]` 作为根命名空间**。
本套件严格遵守：`base.css` 里每一条规则都长这样——

```css
[data-skin="__SKIN_ID__"] .glass-card,
[data-skin="__SKIN_ID__"] [class~="glass-card"] { … }
```

并额外用 `body[data-skin="__SKIN_ID__"] …` 与 `body:has([data-skin="__SKIN_ID__"]) …` 两个手臂覆盖被 Portal 挂到 `body` 上的
浮层（下拉菜单、OSD）。**刻意没有使用 `body:not([data-skin])` 之类的兜底手臂**——那会在别的皮肤激活时误命中，破坏手册要求的互斥隔离。
唯一的全局规则是 `[data-skin="__SKIN_ID__"].acrylic-container` 上的根容器材质与 `::selection / :focus-visible / ::-webkit-scrollbar`，
它们同样只在皮肤命名空间内生效。

## 7. 验证情况

皮肤 CSS 不是“写完就算”，以下都已实测（工具见 §4）：

1. **令牌与部件计算值**（headless Chrome + `preview.html?audit=1&allactive=1#<id>`，四套变体 ×96 条皮肤规则 / 40 条宿主规则）：
   抽查项全部命中——`--wf-accent`（`#0067c0` / `#60cdff` / `#0078d4` / `#1683d8`）、`--accent-color`、`--core-accent`、
   `--surface-card`、`--radius-md`、`--font-mech`、`--status-ok`、`--theme-pwr`、`--text-dim`、`color-scheme`，
   以及 `.glass-card` 的背景/圆角/阴影、`.mode-btn.active-balance` 的边框色、`.metric-value` 的 `tabular-nums`、
   `.toggle-btn.on` 的强调底 + 黑/白字、`.osd-content` 的背景。
2. **WinUI3 侧栏重排**（同一套审计，四套变体结果一致）：
   `container.display = grid`（证明 author `!important` 压过了宿主的内联 `display:flex`）、
   `grid-template-columns = 224px 894px`、`grid-template-rows = 52px 706px`、
   `grid-template-areas = "wf-titlebar wf-titlebar" "wf-sidebar wf-content"`、
   子元素恰为 `mech-titlebar | sub-nav-wrapper | DIV(无类名)`；
   `.sub-nav-bar` 为 `column / stretch / overflow hidden+auto / 透明底`；
   `.nav-tab` 为 `195×40px / row / flex-start / gap 12px / radius 6px / padding 0 12px / 13px`；
   `.nav-tab > svg` 被从内联的 14px 拉成 16px；`.sub-nav-fade` 为 `display:none`；
   选中指示条 `::before = 3px × 16px`、`left:0`；`NAVIGATION` 分组标题 `10px / letter-spacing 1.3px`。
   **关键对抗项**：`?allactive=1` 逼出的 `.tab-sponsor.active` 与 `.tab-plugin-custom.active` 计算值均为皮肤的强调色淡底
   （`rgba(96,205,255,.14)` 等），而不是宿主 `[data-theme=mono]` 的 `#ffffff1f + #fff`——(:has() 加链后 (0,6,0)+`!important`) 稳压 (0,4,0)+`!important`。
3. **“取消半透明”逐像素证明**（`_shots\<id>.png` vs `<id>-probe.png`，同变体同尺寸，只把页面底色从棋盘格换成纯品红后差分）：
   四套变体的差异像素均只有 **130 个（0.0145%）**，且全部落在 `x∈{0,1,2,1117,1118,1119}` 且 `y≤9 或 y≥790` 的
   **圆角抗锯齿边缘**上；窗口内部（行 10~789、列 3~1116）差异为 **0**。即：窗口背后换什么颜色都透不出来，材质已完全不透明。
4. **渲染像素**（`_shots\*.png`）：浅色两套亮度约 222~233（标题栏 228 / 侧栏 222 / 内容 233），深色两套约 42~57
   （标题栏 57 / 侧栏 44 / 内容 48），侧栏与内容区亮度差 3.7~11.5 说明分层可见；与强调色相近的像素占 1.6%~4.5%
   （选中胶囊 / 指示条 / 开关 / 导航选中态），确认皮肤真的生效而非只写了 CSS。
   （这个占比在二色体系改造后由 `_tools\census.py` 直接给出，见下面第 8 条。）
5. **安装产物**：四套目录下 `manifest.json`（`plugin_type` 与 `type` 双写，见 §8）、`theme.css`（54.8~55.1 KB）、`assets\preview.png` 均已就位；
   `<id>\theme.css` 与 `%APPDATA%\OpenRevo\plugins\<id>\theme.css` 经 sha256 比对**逐字节一致**
   （`323497d7bf0c0fc3` / `408e887a60048931` / `ece35cc54e549680` / `a21b1a0dd33dc985`）。
6. **真机迷你面板（2026-10-03，`active_skin = skin-win10-dark`）**：宿主 `pid 29828`（重启后）迷你窗口
   `hwnd 2034138`、`class='Tauri Window'`、`title='OpenRevo'`、物理 rect `(1944,613)-(2559,1529) 615×916`
   （= 410×610.7 CSS @150%，dpi 144），抓图 `_shots\real-mini-clean.png`：
   * 调色板 = 皮肤调色板：`(44,44,44)`（`--wf-surface` 卡片）24.45% / `(32,32,32)`（`--wf-bg #202020`）18.61% /
     `(56,56,56)`（控件底）14.06% / `(45,45,45)` 4.08%，**宿主调色板 `(11,13,17)` 只剩 7 px（0.001%），
     `(16,18,25)/(26,28,35)/(12,15,22)/(17,20,30)/(24,27,37)` 全为 0**。
   * 六个强调色族（按色相聚类）全部出现：青 4.86% / 蓝 2.61% / 橙红 1.43% / 绿 0.63% / 粉紫 0.30% / 黄 0.05%
     —— 宿主 `[data-theme=mono]` 下这些位置本该是纯白，说明 §8.1 的 `--wf-hue-*` 镜像令牌与 8.3 的按钮覆盖都已生效。
   * 与 `preview-mini.html` 同参数（410×610 @dsf1.5）渲染的 `_shots\realcmp-mini.png` 分块 MAE = **19.98**
     （同尺寸的大面板预览 `realcmp-dash.png` 为 28 左右）；文本签名差异集中在动态数值（温度/转速/机型名）上。
7. **四套变体的迷你面板令牌**（`PAGE=preview-mini.html bash _tools/audit.sh <id>`，`_audit\mini-<id>.audit.txt`）：
   深色两套 `root.bg = rgb(32,32,32)`、浅色两套 `rgb(243,243,243)`，四套 `root.blur = none`；
   `--theme-pwr` = `#ff8c00` / `#ff9d5c` / `#ca5010` / `#d83b01`（读的是皮肤值，不是宿主 mono 的 `#ffffff`）；
   `--theme-gpu/hz/lux/kbd/bat` 四套全部等于该变体的 `--wf-accent`；
   `.m-quick-btn.active` = 皮肤强调色的 14% 底 + 36% 描边（`rgba(96,205,255,.14)` 等），不再是宿主 mono 的 `#ffffff24`。
8. **二色强调体系（2026-10-04 收敛完成，本轮的验收核心）**：
   * **口径**：整份皮肤只允许两个强调色 —— `--wf-accent`（系统主题色，管一切可交互/已选中/已启用）与
     `--wf-important`（重要强调色，暖橙，只管**性能/功率**与**需要注意**的状态）。`--wf-ok/-warn/-error` 仅表达
     真实状态语义，不得当装饰。
   * **令牌收敛**：`--theme-pwr` → `--wf-important`，`--theme-{gpu,hz,lux,kbd,bat}` → `--wf-accent`（mini 的六个指标槽位名保持不变）；
     宿主私有的 `--accent-pwr/-beast` → `--wf-important`，`--accent-gpu/-cool/-rgb/-lux` → `--wf-accent`（主控台自绘部件读的是这些）。
   * **DOM 层普查**（审计里的 `dom.hueFamilies`）：mini 四套变体全部 **= 2**（30° 重要强调色 + 210° 系统主题色）；
     主窗四套变体全部 **= 2**（210° 系统主题色 + 120° 状态点绿），排除夹具后主窗的 important 只剩隐藏的「狂暴档激活态」。
   * **像素层普查**（`_tools\census.py`，`_shots\mini-<id>.png`）：mini 四套全部 **2 个色族** ——
     `skin-win11-dark` 为例：198.9° 蓝青 86.16% + 23.1° 橙 13.84%（改造前真机是青/蓝/橙红/绿/粉紫/黄 **6 族**）。
     主窗（`_shots\<id>-clean.png`，`?nofix=1` 关掉预览页夹具）：蓝青 96~99% + 状态点绿 0.03%（4 个 8px 圆点）+ 22 px 抗锯齿边缘。
   * **激活态映射断言**（主窗隐藏夹具）：`办公`/`均衡`/`自定义`/`远程办公` = `rgba(96,205,255,.14)` + `rgb(143,223,255)`；
     `狂暴` = `rgba(255,157,92,.14)` + `rgb(255,201,163)`。四个档位不再各自一个颜色。
   * **mini 内联硬编码色的覆盖**（宿主内联无法用令牌改，只能 `!important` 打掉）：READY 圆点 `#34d399` + 文字 `#6ee7b7` → accent；
     主题配色切换按钮 cyber 态 `rgba(56,189,248,.15)`/`#38bdf8` → accent；OEM 徽标 `rgba(245,158,11,.15)`/`#fbbf24`（运行中）→ important，
     `rgba(56,189,248,.1)`/`#38bdf8`（已被屏蔽）→ accent；焦点框 `#38bdf8` → accent；赞助心形 `#f43f5e` → accent。
9. **真机主窗（大面板）**（`_shots\real-dash-1500.png`，1702×1213 物理 = 1135×809 CSS @150%；复现脚本 `_tools\wake-grab-dash.ps1`，日志 `_shots\wake-grab-dash.log`）：
   * manifest 的 `window:{width:1120,height:800}` 是**按 CSS 逻辑像素**生效的（Tauri `LogicalSize`）：真机窗口 1702×1213 ÷1.5 = 1135×809 CSS，
     视口 ≈1135 CSS **> 760**，所以 §14 的窄窗回退（导航退回顶部横条）不会触发。
   * 调色板：`(32,32,32)` 30.25%（= `--wf-bg #202020`）/ `(44,44,44)` 19.04% / `(41,41,41)` 16.96% / `(56,56,56)` 6.08% /
     `(40,40,40)` 4.80% / `(39,39,39)` 1.89%；**宿主调色板 `(11,13,17)/(16,18,25)/(26,28,35)/(12,15,22)/(17,20,30)/(24,27,37)`
     计数全为 0** → 大面板同样完全不透明、无亚克力残留。
   * 与 `preview.html` 同尺寸渲染（`--window-size=1120,800 --force-device-scale-factor=1.5` → 1680×1200）对齐（最优 `dx=9 dy=0`）后
     **MAE 22.16**；分带：**左侧栏（0–224 CSS）16.48** < 内容区 23.58 < 顶部 100 CSS 46.45 ≫ 底部 100 CSS 9.90；
     竖向平移探针（±4/8/12/16）都更差 → 没有系统性位移。
   * **列边缘在 CSS `224.7 / 225.3` 处最强** = `--wf-sidebar-w: 224px` 的侧栏右边界（预览同位置另有 `245.3/246.0`）
     → **§14 的 WinUI3 左侧栏 tab 重排在真机上确实生效**。
   * 剩余差异集中在顶部 ~100 CSS px（真机首段行亮度 60.7 vs 预览 95.8）与内容区：抓图时宿主停在**别的 tab 页**
     （内容区本身是可滚动区，预览固定渲染 overview 页），不影响「侧栏 + 不透明」两条结论。
10. **背景插件**（独立验收链，见 §11.1；当前**未装进宿主**）：`bash _tools/verify-bg.sh` 三档全绿 ——
    默认只出独立插件时 **18 条**、`--targets skin-win11-dark` 时 **68 条**、`off` 时 **10 条**（均 0 失败、`exit 0`）。
    「背景真的生效」不靠层数，而是 `bg.photo.count = 1` + `bg.grad.count = 1` +
    `bg.image.loaded = true 2560x1440 dataURI 136339B`（预览页真起 `new Image()` 解码后与 PIL 读出的产物比对）；
    产物可复现：`off → set` 后 `bg-custom/theme.css` 等三个 sha1 逐字节一致。

> **踩过的坑（写给以后改这套东西的人）**
> * 被 `disabled` 的 `<link>` 在 `disabled = false` 之后是**异步**取回样式表的，取样必须等到 `window.load` 之后，否则读到的是未上皮肤的样式。
> * headless 渲染不一定产出足够多的帧，**处于过渡中的属性会停留在起始值**（曾把 `.glass-card` 背景误读成 `rgba(0,0,0,0)`）。审计与截图都要带 `?notrans=1` / `?audit=1` 关掉过渡。
> * 无头 Chrome 必须带独立的 `--user-data-dir=`，否则会跟用户已打开的 Chrome 抢用户目录，静默不产出文件（返回码仍是 0）。
> * `file://` 页面里跨文档样式表的 `cssRules` 会抛 SecurityError（规则数误报 `none`），要加 `--allow-file-access-from-files`。
> * 别用“数某个灰色的像素个数”判断透明度：文字抗锯齿会撞上背景色，必须用**换底色差分**。
> * `?bare=1` 里 `.pv-stage` 的内联 `width/height` 必须用 `!important` 覆盖，否则窗口填不满视口，截图底部会留一条页面底色带（曾把这条带误判成“窗口漏色”）。
> * **让宿主认到新目录**：插件页【刷新】= 重扫列表 **+ 热重载当前样式**，所以装完皮肤点一次【刷新】即可生效；
>   `active_skin` 指向**已删 ID** 时才是例外，须「停 → 改 → 启」。
>   判断真机状态前先比 `_tools\when.ps1`（进程启动时间）与插件目录 mtime —— 进程比插件文件老时，
>   截图像素会误导成「皮肤没生效」。重启要用提权路径 `_tools\kill-and-start.ps1`
>   （`taskkill` 对这个 requireAdministrator 进程是「拒绝访问」）。
> * **判读真机截图前必须先确认窗口 z 序与遮挡**：第一次抓到的 615×916 图里左侧 45% 是一条纯 `(34,34,34)` 竖带，
>   一度被当成宿主底色；`_tools\who.ps1`（`WindowFromPoint` + `GetAncestor`）证明那是 **QQ** 的窗口
>   （`rect=(569,237)-(2230,1273)`，右边界 2230 与竖带终点完全吻合）。注意 `WindowFromPoint` 会跳过 Tauri 的透明/分层窗口，
>   对面板区域回报的是它**下面**的窗口，不能当 z 序证据。要一张无遮挡图用 `_tools\pin-grab.ps1`。
> * **对 Tauri 窗口 `PrintWindow(..., PW_RENDERFULLCONTENT)` 返回 True 但内容是全透明**（alpha 全 0），窗口级抓图这条路不通；
>   而且面板进程是提升过的，普通 shell 里 `SetWindowPos(HWND_TOPMOST)` 会因 UIPI 失败（返回 False）——
>   `_tools\pin-grab.ps1` 必须以 `Start-Process -Verb RunAs` 提权跑，抓完立刻 `HWND_NOTOPMOST` 还原。
> * **`_tools\show-app.ps1` 只是把窗口“显示”出来，不会把它置顶**：它靠第二实例触发单实例唤醒，窗口用的是
>   `SW_SHOWNOACTIVATE`，很可能仍压在我自己浏览器的下面。用背景差分验证过：同一位置前后两张截图 `mean=42.4`（浏览器在重绘），
>   把宿主窗口移开后再抓原位与移动前 **100% 完全相同** —— 也就是说那几次「大面板截图」拍到的其实是**我自己浏览器的界面**。
>   抓面板一律用置顶脚本（`_tools\pin-grab.ps1` / `_tools\wake-grab-dash.ps1`）。
> * **Tauri 窗口不能最小化做背景差分**：`ShowWindow(hwnd, SW_MINIMIZE)` 前后截图 100% 相同。
>   宿主隐藏大面板的手法是把它移到 `(-32000,-32000)` 并缩成 `237x39`（看 rect 就能认出来，别再去 show 那个
>   `class='tray_icon_app'` 的隐藏窗口，它 show 出来只有桌面壁纸、没有任何 WebView 内容）。
> * **`wake_window_mode` 只在进程启动时读入**：把它从 `mini` 改成 `full` 之后必须**重启宿主**才会弹大面板，
>   只改文件再唤醒，弹出的仍是迷你面板。验完记得还原（备份 `config.json.bak-skinverify`）并再重启一次。
> * 本机模型**不支持图片输入**（`read_image` 直接报 `does not declare image input`），所有观感判读只能靠直方图、
>   列/行亮度签名与 ASCII 渲染。

## 8. manifest 为什么同时写了 `plugin_type` 和 `type`

开发手册 §4/§7 规定字段名是 `plugin_type`，但随宿主一起发行的官方插件
（`plugins\eva01-core\manifest.json`）用的是 `"type": "widget"`，`window` 下也是 `alwaysOnTop` 这种 camelCase。
两者都写可以保证微内核读任一键都能识别成皮肤插件（serde 默认忽略未知字段，多一个别名没有副作用）。
`window.width/height` 会触发手册 §7 L653 描述的 `resize_window` 平滑调整 + 自动居中，`resizable:true` 解锁自由缩放。

## 9. 停用 / 卸载

* **停用**：插件面板里把开关拨回即可，宿主会立刻移除注入的 `<style>`，并回退默认主题与 960×740 视窗基准（手册 §7 L624）。
* **卸载**：删除对应的 `plugins\<skin_id>\` 目录，并在 `%APPDATA%\OpenRevo\config.json` 里清掉
  `custom_plugin_toggles` 与 `widget_positions` 中残留的该 ID（若存在）。

> **本节已被执行过一次（2026-10-17）**：四套皮肤的仓库产物目录 + 宿主 `config.json` 里的
> `custom_plugin_toggles` / `widget_positions` 残留（含 `eva01-core`）都按上面这条流程清掉了。
> 备份在 `%APPDATA%\OpenRevo\config.json.bak-skincleanup-20261017-075507`。
> 注意：宿主**运行中**会周期性把 `config.json` 按内存态整份回写，所以改配置前若刚在宿主里
> 动过任何开关，先记下当前值再改，或停机改；本次实测该回写**只在用户操作时发生**（静置 30 s 无变化，
> 期间唯一的字节变化来自一次真实的插件开关点击）。

## 10. 当前未做的事

* **主窗（大面板）已在真机弹开并取证**（§7.8）：为了把宿主从迷你形态展开，曾临时把 `config.json` 的 `wake_window_mode`
  改成 `"full"` 并重启宿主，**验完已还原为 `"mini"` 并再次重启**（备份留在 `config.json.bak-skinverify`）。
  结论是侧栏重排生效、面板完全不透明；没弄清的是顶部 ~100 CSS px 那一段比预览暗（怀疑是抓图时宿主停在别的 tab 页 +
  标题栏区域差异），暂时不影响观感。想让我再拍一张，说一声即可。
* **OEM 助手弹窗与「极客调校」浮层**是条件渲染的，手上没有真机素材，皮肤只用
  `[style*="position: fixed"]` 这条近似规则覆盖了固定定位浮层的背景与描边。
* `%APPDATA%\OpenRevo\config.json` 里的 `active_skin` 保持为你选中的那套（你现在选的是 `skin-win11-dark`；
  §7.6 的迷你真机图是当时选中的 `skin-win10-dark`，§7.8 的大面板图是 `skin-win11-dark`）；换另外三套在【插件】页切换即可，切换会立刻重新注入 `<style>` 并热加载。
* 历史上为拿调试端口试过的 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`
  这条路**已被证伪**（Tauri/wry 会覆盖 WebView2 的启动参数，端口不会打开），该 `HKCU\Environment` 变量**已删除**；
  同理 `_tools\cdp.py`、`_tools\relaunch-debug.ps1`、`_tools\scan_ebwebview.py` 只是留档，不再是工作路径。
* **背景插件：功能已做完并验收；0.8.8 起宿主侧卡点已解除，但仍按 m00785 的口径没有装进宿主。**
  `bg-custom\` 在仓库里已构建好、随时可用。原卡点是**宿主只给了一条 CSS 通道**，启用背景必然顶掉
  你当前的 `skin-win11-dark`（原因见 §11.3）；**OpenRevo 0.8.8 已新增第二条独立通道
  `active_background`**（`<style id="openrevo-custom-background">`），皮肤与背景从此可以共存 ——
  详见 §11.4 与 [`docs/reference/plugin-dev-0.8.8-skill.md`](docs/reference/plugin-dev-0.8.8-skill.md)。
  当前仍**保持现状**：仓库内三档验收全绿，宿主侧零改动（没装、没激活）。
  想先看看真实观感可以自己手动装（**0.8.8 下不再需要顶掉现有皮肤**）：

  ```bash
  python build_background.py install --activate     # 换成你自己的图就加 --image D:\pics\wall.jpg
  powershell -ExecutionPolicy Bypass -File _tools\kill-and-start.ps1
  ```

  退回现在的皮肤：`python build_background.py off --uninstall` 再重启。

## 11. 自定义背景图（可选功能，独立于皮肤）

把一个本地图片文件铺成窗口背景。**它跟上面四套皮肤没有依赖关系**，就是一个单独的插件。

> **当前状态：已实现、已验收；0.8.8 起宿主侧卡点已解除，但仍按 m00785「既然已知不行那就先不做」没有装进宿主** ——
> 原卡点是宿主的单 CSS 通道（§11.3），0.8.8 新增了第二条独立通道 `active_background`，见 §11.4。
> 下面写的命令全部可用，只是默认不执行 §11.2 的安装那步。

```bash
python build_background.py set --image D:\pics\wall.jpg      # 指定图片并构建（默认只出 bg-custom）
python build_background.py set --image wall.jpg --fit cover --position center --overlay 0.42
python build_background.py set --image wall.jpg --blur 12 --scope mini   # 只糊迷你面板
python build_background.py install --activate                # 同步到 plugins\ 并切 active_background（0.8.8 起与皮肤互不干扰，见 §11.4）
python build_background.py status                            # 看配置 / 产物 sha1 / 装没装
python build_background.py off                               # 停用并删除产物
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `--fit` | `cover` | `cover` / `contain` / `stretch` / `tile` / `center` |
| `--position` | `center` | 任意 `background-position`（`top`、`50% 20%`…） |
| `--overlay` | `0.42` | 遮罩不透明度；`0` = 不压暗（那一层仍在，见下） |
| `--overlay-color` | `auto` | `auto` = 按底色亮度自动选黑/白 |
| `--blur` | `0` | 高斯模糊半径（**烘进图片**，不是运行期 `backdrop-filter`） |
| `--max-width` | `2560` | 超过则 LANCZOS 降采样（**先降采样再模糊**，换 `max-width` 观感一致） |
| `--scope` | `both` | `both` / `main` / `mini` |
| `--targets` | `none` | 见 §11.3 |

**为什么图片是 base64 内联的**：宿主把 CSS 整份读进 `<style>` 再设 `textContent`
（0.8.8 是 `<style id="openrevo-custom-background">`），`@import` 和相对 `url()` 都按宿主文档的 base URL
（`tauri://`）解析、够不到插件目录，`file://` 又被 WebView2 拒。所以本插件自己把图片编码成 `data:` URI ——
2560×1440 的 q88 JPEG 约 133 KB，`bg-custom\theme.css` 因此有 139 KB。
配置里**只存源图路径**，每次构建重新编码，换参数不会退化成二次压缩。

> **0.8.8 起不必再手写 base64**：宿主新增 Background Engine —— 插件目录只放 `manifest.json` + 一张图
> （候选文件名：`background.{jpg,jpeg,png,webp}` / `wallpaper.*` / `bg.*`，大小写不敏感），
> 宿主自己读图、base64 化，并生成覆盖 `.openrevo-shell` / `.mini-drawer-root` 的样式，作者零代码。
> 另一条路仍是 `plugin_type: "background"` + `background_css` 指向自己写的 CSS。两条路都没试装。
> ⚠️ 作者手写 CSS 里的相对 `url("assets/x.png")` **是否被宿主自动改写为 Data URI 尚无证据**
> （exe 里没有对应的重写代码痕迹），按「不会被改写」处理。见
> [`docs/reference/plugin-dev-0.8.8-skill.md`](docs/reference/plugin-dev-0.8.8-skill.md) §2/§3。

**画在哪**：面板根（主窗 `.acrylic-container`、迷你 `.mini-drawer-root`），选择器把类名写两遍抬到 (0,3,0)，
才压得过皮肤的 `!important` 与宿主给迷你的内联 `background`。遮罩和照片写在**同一个** `background-image` 里
（第 0 层遮罩、第 1 层照片），所以不需要伪元素或 z-index；图片解码失败时会自动回落到 `background-color`。

> **0.8.8 兼容性**：0.8.8 把 `.acrylic-container` 与新的 `.openrevo-shell` 渲染在**同一个元素**上
> （`className:"acrylic-container openrevo-shell"`），`.mini-drawer-root` 照旧，所以现有选择器无需改动。
> 宿主自带的 Engine 生成版用的是 `.openrevo-shell` / `.mini-drawer-root`，比本插件更宽的锚点。

### 11.1 验收

```bash
bash _tools/verify-bg.sh          # 默认 18 条断言（第一条就是「既有 132 条无回归」）
bash _tools/verify-bg.sh off      # 停用后：产物已删 + 没有背景图泄漏
```

断言不查「层数 = 2」—— 那个数字说明不了问题（4 套原皮肤的 `.acrylic-container` 底色本来就是纯色，
而皮肤里另有一条两层 `radial-gradient` 的规则）。真正判定生效的是 `bg.photo.count = 1` +
`bg.image.loaded = true <W>x<H>`：预览页会**真起一个 `new Image()` 解码**，再把尺寸与 PIL 读出的产物比对。
期望值每轮都从 `bg.config.json` 重新推导，不抄产物。

### 11.2 装完要重启（0.8.8 起可免）

0.8.7 时代宿主**只在启动时枚举插件目录**，`--install` 之后必须重启宿主才认。**0.8.8 已改为按需注入**：
皮肤 / 背景 CSS 都在 `useCallback` 里即时 `load_plugin_*_css`。**`v0.8.8-dbfe615` 起，插件页【刷新】按钮
本身就带热重载**（handler 逐字 `onClick:()=>j(!0)`、title `"刷新已安装插件列表并热重载当前样式"`：重扫列表后
重放 `onApplySkin` / `onApplyBackground`）⇒ **改 `theme.css`、装新插件目录都只需点一次【刷新】**，
不必拨开关、不必重启。⚠️ 早于该构建（含 0.8.7、`v0.8.8-bf72755`）的【刷新】只重扫列表
（`invoke('get_custom_plugins')`），那时才需要「先【刷新】让列表出现，再拨开关」。

重启仍是最稳的兜底路径：`powershell -ExecutionPolicy Bypass -File _tools\kill-and-start.ps1`
（需要提权，`taskkill` 会被拒）。`--activate` 会调 `_tools\set-active-skin.ps1`，它按「停机 → 改 config → 启动」
的顺序做，因为宿主运行中会周期性把 `config.json` 整份回写。

### 11.3 与皮肤的关系（0.8.7 互斥 → 0.8.8 解耦）

**0.8.7**：宿主全树只有**一条** CSS 注入通道 `<style id="openrevo-custom-skin">`，内容来自
`load_plugin_theme_css`。插件页切皮肤时 `plugin_type === "skin"` 走 `set_active_skin` 且**单选**，
非 skin 插件走 `set_custom_plugin_enabled`、**永远不注入 CSS**。所以背景当时只能做成 `skin` 形态，
必然占用唯一的 `active_skin` 槽位 —— **启用背景插件就会顶掉 Fluent 皮肤，反之亦然**。那是宿主侧的设计，
不是本插件的取舍。当时的替代方案是把两层 CSS 合并进同一份 `theme.css`：

```bash
python build_background.py set --image wall.jpg --targets skin-win11-dark   # 产出 skin-win11-dark-bg
```

这会额外生成派生皮肤 `skin-win11-dark-bg\`（= 原皮肤逐行相同 + 末尾 3 条背景规则），原四套皮肤一个字节不动。

**0.8.8**：宿主新增**第二条独立通道**。皮肤与背景各有自己的槽位、各自注入自己的 `<style>`，互不覆盖：

| 槽位 | 状态键 | 注入点 | 拉取命令 |
|---|---|---|---|
| 皮肤 | `active_skin` | `<style id="openrevo-theme-skin">`（读旧 id `openrevo-custom-skin` 会就地改名） | `load_plugin_theme_css` |
| 背景 | `active_background` | `<style id="openrevo-custom-background">` | `load_plugin_background_css` |

`plugin_type === "background"` 是宿主真分支：`if(j.plugin_type==="background"){const T=o===j.id?null:j.id;…}`
插件卡片徽标文案也随之分开（实测四个标签：`skin`→「主窗皮肤」、`background`→「背景壁纸」、
`tab`→「面板插槽」、`widget`→「桌面挂件」）。所以派生皮肤 `--targets` 那条路**不必再走**，
但保留着（对 0.8.7 宿主仍是唯一解）。

### 11.4 卡点已在 0.8.8 解除

原文这一节列了三选一的宿主接口需求。**0.8.8 三项已全部满足**，其中第 1 项是宿主的正解、
第 2/3 项由同一机制一并解决：

| # | 原需求 | 0.8.8 落地情况 |
|---|---|---|
| 1 | 第二条 CSS 注入通道（让 `skin` 之外的形态也能写样式） | ✅ **已实现**：新增 `plugin_type === "background"` + `active_background` + `load_plugin_background_css` + `<style id="openrevo-custom-background">` |
| 2 | `active_skin` 分槽 / 多值 | ✅ **等效达成**：不需要给 `active_skin` 分槽 —— 背景改由独立键 `active_background` 承载，两槽天然共存（`config.json` 里两个键并存） |
| 3 | 原生背景图配置键 | ✅ **等效达成**：宿主新增 Background Engine —— 插件目录里只放 `manifest.json` + 一张图（12 个候选文件名之一）即可，宿主自己 base64 化并生成覆盖 `.openrevo-shell` / `.mini-drawer-root` 的样式，作者**零代码** |

**因此本仓库的 `bg-custom` 还是按 m00785 保持「不装、不激活」，但性质变了**：不再是「宿主不支持、
只能等」，而是「宿主已支持、只是用户口径选择先不装」。要启用，改成 `plugin_type: "background"`
形态即可（见 `docs/reference/plugin-dev-0.8.8-skill.md` §7 第 8 项与 §3）。

细节（含探针字段、已知坑、文件清单、退回原状）见 [`docs/reference/background-plugin.md`](docs/reference/background-plugin.md)。

细节（含探针字段、已知坑、文件清单、退回原状）见 [`docs/reference/background-plugin.md`](docs/reference/background-plugin.md)。
