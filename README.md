# OpenRevo 插件市场 · `open-revo-market`

OpenRevo（`open-revo.exe`）的**第三方插件市场**，同时保留一套可复用的插件工具链。

项目原名 `openrevo-plugins`，2026-10-17 更名为 **`open-revo-market`**
（GitHub 仓库：`LIPiston/open-revo-market`；旧地址仍会重定向）。更名反映重心变化：
本仓库的主交付物是 **`plugin-market`**（宿主内的【插件市场】页签），皮肤与背景插件保留为
工具链与历史交付物。

> **本机克隆目录可能仍叫旧名**（如 `D:\LIPis\Documents\code\openrevo-plugins\`）。
> 目录名与仓库名无关，不影响任何命令；想统一可跑 `_tools\rename-project.ps1`。

| 项 | 当前值 |
|---|---|
| 宿主版本 | **0.9.1**（exe 9,368,576 B，mtime 2026-10-16 20:29） |
| 主交付物 | **`plugin-market/`**（`tab` 形态，已入库，`git clone` 后可 `--install` 即用） |
| 其他插件 | `bg-custom/`（背景图，独立于皮肤；按用户口径暂不安装） |
| 皮肤产物 | 四套 `skin-*` 目录**已删除**（2026-10-17），构建工具链保留 |
| 当前已装 | 插件目录里**只有 `plugin-market`**；`active_skin` / `active_background` 均为 `null` |

---

## 1. 快速开始

```bash
# 构建并安装插件市场（装到 %APPDATA%\OpenRevo\plugins\plugin-market\）
python build_market.py --install
```

装完后打开 OpenRevo → 侧边栏【插件】页 → 右上角【刷新】→ 顶栏出现「插件市场」页签。

```bash
python build_market.py --check      # 只做产物自检，不写文件
bash _tools/market-verify.sh cyber  # 验收闸（另跑 mono 主题）
```

---

## 2. 插件市场 `plugin-market`

宿主里的一个 `tab` 页签：浏览第三方插件、看能力披露、拿到最短安装路径。

### 2.1 能做什么

| 能力 | 说明 |
|---|---|
| **浏览目录** | 拉取策展目录 `market/catalog.json`，按类型分组（已审核 / 未审核），支持搜索与筛选 |
| **实时发现** | 直接查 GitHub 上带 topic `openrevo-plugin` 的仓库，作者打完 topic 立刻可见，不必等爬虫 |
| **识别已安装** | 通过宿主只读命令 `get_custom_plugins` 给已装插件打标，并可按安装状态筛选 |
| **能力披露** | 列出静态扫描检出的联网 / 文件读写等能力，危险组合单列（如「读凭据 + 有网络」） |
| **安装交接** | 生成一条可直接粘贴的 PowerShell `git clone` 命令 + 复制按钮 + 打开插件目录 |

### 2.2 为什么不能「一键安装」

**这是宿主的限制，不是市场偷懒。** 0.9.1 实测结论：

* Rust 命令表里**没有** `install_plugin` / `uninstall_plugin` / `reload_plugin`，也没有写插件目录的 IPC
  （`write_file` / `write_text_file` / `create_dir` / `fs::write` 在 exe 与前端 JS 里**全 0 命中**）。
* Tauri 侧只挂了 `autostart` 与 `single-instance`，**没有** `fs` / `dialog` / `shell` / `opener`。
* `tab` 插件的 iframe 是 `sandbox="allow-scripts allow-forms allow-same-origin"`，
  **不含 `allow-downloads` / `allow-popups`** ⇒ 下载与 `window.open` 都被浏览器层拦死。

所以点【安装】不会替你下载，而是弹出卡片：**复制命令 → 终端粘一次 → 回插件页刷新**，
并在界面顶部**明说本版宿主没有开放安装接口**。缺失接口的完整清单、建议签名与优先级见
[`docs/reference/market-host-constraints.md`](docs/reference/market-host-constraints.md)。

### 2.3 目录与发现机制

```
别人给仓库打 topic ──► 爬虫（每小时 / 可手动）──► market/catalog.json ──► 市场页签
                          ↑                                          │
                    「实时发现」直接查 GitHub，不等爬虫 ◄──────────────┘
```

* **快车道（零审核）**：给自己的插件仓库打上 topic `openrevo-plugin`，约一小时后自动收录，
  UI 上显著标注「未审核」。作者也可在本地立刻用【实时发现】看到。
* **正典（已审核）**：往 `market/catalog.json` 提 PR，把 `unreviewed` 改成 `false`；
  爬虫合并时会**保留**这个标记，不会翻回去。

作者约定：

| 项 | 约定 |
|---|---|
| 插件目录 | 仓库根放 `manifest.json`，**或**某个子目录里放（monorepo 自动扫一层） |
| 必填 | `manifest.json` 的 `id` / `name` / `version` / `plugin_type`；`id` 就是安装后的目录名 |
| `plugin_type` | `skin` / `background` / `tab` / `widget` / `slot`（0.9.1 实测枚举） |
| 能力字段 | 由工具侧扫描填写，作者手写无效 |

### 2.4 三条不能让步的口径

* **身份 = `owner/repo[/subpath]`**，绝不用展示名当键（展示名会撞车）。
* **能力披露是三态**：`[...]` = 扫过并检出；`[]` = 扫过未检出；**`null` = 没扫过**。
  爬虫不做真实扫描，一律写 `null`（UI 渲染「未扫描」）。**绝不写 `[]`** —— 那等于撒谎说「检查过，很干净」。
* **失败不伪装**：在线目录拉不到时保留兜底数据，并如实写明原因（如 `未连上在线目录：HTTP 404`）；
  `stars` 取不到写 `null` 而不是 `0`（排序时放最后）。爬虫失败时**不写文件**，让上次产物继续服务。

### 2.5 源码与构建

| 目录 / 文件 | 作用 |
|---|---|
| `market/src/` | 源码：`market.js` + `market.css` + `index.template.html`（**只改这里**） |
| `build_market.py` | 把三者内联成**单文件** `plugin-market/index.html`，并做产物自检；`--check` / `--install` |
| `market/catalog.json` | 策展目录（构建时内联为离线兜底 `SEED`） |
| `market/crawl_topic.py` | 爬 GitHub topic → 生成 / 合并目录（`--dry-run` / `--merge` / `--out`） |
| `market/validate_catalog.py` | 目录结构校验 E1–E10，CI 与本地共用 |
| `.github/workflows/refresh-catalog.yml` | 每小时自动爬一次，**只在内容变化时**提交 |
| `plugin-market/` | 构建产物（已入库） |
| `_tools/market-{preview.html,verify.sh,shots.sh}` | 等价宿主环境预览 + 验收闸 + 出图 |

**产物必须单文件**：宿主用 `srcDoc` 把插件 HTML 注入 iframe，基准 URL 是宿主文档
（`tauri://localhost`），任何 `<link rel=stylesheet>` / `<script src>` / `<img src="assets/…">` /
`@import` **都会 404**。构建期会断言零外部引用。

**别手改产物**：改 `market/src/`，然后 `python build_market.py --install`。

---

## 3. 仓库结构

```
open-revo-market\
├── market\                     # 市场源码与目录链
│   ├── src\                    #   market.js / market.css / index.template.html
│   ├── catalog.json            #   策展目录（CI 每小时刷新）
│   ├── crawl_topic.py          #   topic 爬虫
│   └── validate_catalog.py     #   目录校验
├── build_market.py             # 市场构建器（单文件产物 + 自检）
├── plugin-market\              # ★ 市场构建产物（入库，可直接装）
│
├── bg-custom\                  # ★ 背景图插件产物（独立于皮肤；当前未装）
├── build_background.py         # 背景 CLI：set / off / build / install / status
├── bg_common.py                # 背景共享层（import build_skins）
├── src\background.css          # 背景段模板
├── bg.config.json              # 背景构建真值
├── assets\sample-wallpaper.jpg # 确定性示例图
│
├── build_skins.py              # 皮肤生成器（四套产物的唯一正确路径）
├── src\base.css                # 皮肤结构层（全部选择器带 __SKIN_ID__ 占位）
├── preview.html                # 主控台本地预览
├── preview-mini.html           # 迷你面板本地预览
│
├── _extracted\                 # 从 open-revo.exe 抽出的宿主真值
│   ├── v091\                   #   0.9.1 前端 JS / CSS（当前基线）
│   ├── index-C535NsqC.css      #   0.8.8 时期抽取物（历史基线，仅对照）
│   ├── host-shell.css          #   预览页加载的宿主外壳规则子集
│   └── ...
├── _tools\                     # 验收 / 审计 / 抓图工具（见 §7）
├── docs\                       # 技能包与参考文档（见 §9）
├── _audit\                     # 审计输出（gitignore）
└── _shots\                     # 截图与验收出图
```

> `skin-win10-dark\` / `skin-win10-light\` / `skin-win11-dark\` / `skin-win11-light\`
> 四个产物目录已于 2026-10-17 删除，`python build_skins.py` 可按 §5 的规格重建。

---

## 4. OpenRevo 插件生态（0.9.1 实测）

### 4.1 五种形态

前端 JS 里实际出现的 `plugin_type` 字面量：

| 形态 | 说明 | 注入点 / 载体 |
|---|---|---|
| `skin` | 主窗皮肤 | `<style id="openrevo-theme-skin">` |
| `background` | 背景壁纸 | `<style id="openrevo-custom-background">` |
| `tab` | **面板插槽**（市场就是它） | 顶栏胶囊 → 沙盒 iframe |
| `widget` | 桌面挂件 | 独立 WebView2 窗口 |
| `slot` | 微插槽（0.9.1 新增） | 按 `target_slot` 填进宿主既有页面 |

`service` / `shell` / `driver` 在 0.9.1 前端里**没有字面量**，只在官方手册矩阵中出现，
是否真实存在**未证实** —— 不要依据手册对外承诺。

### 4.2 三种 iframe 的 sandbox 各不相同

| 形态 | sandbox | 后果 |
|---|---|---|
| `tab` | `allow-scripts allow-forms allow-same-origin` | 无 `allow-downloads` / `allow-popups` ⇒ 下载与 `window.open` 被拦 |
| `widget` | 上者 + `allow-modals` | 多模态对话框 |
| `slot` | **无 sandbox** | 与宿主同源、无隔离 |

> `tab` 同时给 `allow-same-origin` + `allow-scripts` ⇒ **沙盒形同虚设**：iframe 与宿主同源，
> 既能读 `window.parent.document`，也能拿 `window.parent.__TAURI_INTERNALS__.invoke`。
> **绝不**把「跑在 iframe 里」当安全边界。

### 4.3 宿主**有**的插件命令（13 条，全部）

```
get_custom_plugins          load_plugin_html            load_plugin_theme_css
load_plugin_background_css  set_custom_plugin_enabled   open_plugins_dir
open_custom_widget          close_custom_widget         widget_ready
set_active_skin             get_active_skin             set_active_background
get_active_background
```

宿主全部 IPC 共 **132 个唯一命令**，与插件相关的只有上表这 13 条。**没有一条能**：
下载 / 写盘 / 删除插件 / 重载目录 / 开外链 / 读任意文件 / 读宿主版本。

市场实际只用到其中 **2 个**：`get_custom_plugins`（只读）与 `open_plugins_dir`。

### 4.4 让宿主认到新插件

0.9.1 的插件页【刷新】= **重扫列表 + 热重载当前样式**，所以装新目录、改 `theme.css`
**都只需点一次【刷新】**，不必拨开关、不必重启。

⚠️ 唯一例外：`active_skin` / `active_background` 指向**已删的旧 ID** 时，光刷新不够，
必须「停 → 改 → 启」（`_tools\set-active-skin.ps1`）。宿主进程是 `requireAdministrator`，
`taskkill` 会被拒，须用 `_tools\kill-and-start.ps1`。

---

## 5. 皮肤工具链（产物已移除，链路仍可用）

四套皮肤的**设计规格**仍完整保留，跑一次即可重建：

```bash
python build_skins.py            # 生成四个 skin-<id>\ 子目录
python build_skins.py --install  # 生成并安装到 %APPDATA%\OpenRevo\plugins\
```

| 插件 ID | 风格 | 强调色 | 圆角 | 声明视窗 | 字体 |
|---|---|---|---|---|---|
| `skin-win11-light` | Windows 11 Fluent（浅色 / Mica） | `#0067c0` | 8px | 1120 × 800 | Segoe UI Variable Text |
| `skin-win11-dark` | Windows 11 Fluent（深色 / Mica Dark） | `#60cdff` | 8px | 1120 × 800 | Segoe UI Variable Text |
| `skin-win10-light` | Windows 10 Fluent（浅色 / Acrylic） | `#0078d4` | 2px | 1080 × 780 | Segoe UI |
| `skin-win10-dark` | Windows 10 Fluent（深色 / Acrylic） | `#1683d8` | 2px | 1080 × 780 | Segoe UI |

共同设计：

* **WinUI3 左侧导航栏**（224px）替代宿主的顶部横向 tab 条；
* 窗口根容器**完全不透明**（去掉 `backdrop-filter`）；
* 装饰色**收敛到两个**：`--wf-accent`（系统主题色）+ `--wf-important`（性能/功率/需注意）。
  `--wf-ok/-warn/-error` 只表达真实状态，不得当装饰。

**为什么保留工具链**：背景插件 `build_background.py` / `bg_common.py` 都 `import build_skins`
（用 `VARIANTS` / `PLUGINS_DIR` / `manifest` / `make_preview`），删链会连带弄坏 `bg-custom`。

> ⚠️ **`_tools/verify.sh` 与 `_tools/audit.sh` 现在需要先重建皮肤才能跑**：它们按
> `<skin_id>/theme.css` 逐个变体取样式，目录不存在时审计会报 `rules_applied = none`
> （不是 CSS 坏了，是输入缺失）。先 `python build_skins.py`，再 `bash _tools/verify.sh`。

皮肤细节（令牌架构、特异性阶梯、双面板配方）见
[`docs/reference/skin-authoring.md`](docs/reference/skin-authoring.md)。

---

## 6. 自定义背景图 `bg-custom`

把一个本地图片铺成窗口背景，**独立于皮肤**，不改配色与布局。

```bash
python build_background.py set --image D:\pics\wall.jpg   # 指定图片并构建
python build_background.py status                         # 看配置 / 产物 sha1 / 装没装
python build_background.py install --activate             # 同步到 plugins\ 并激活
python build_background.py off                            # 停用并删除产物
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `--fit` | `cover` | `cover` / `contain` / `stretch` / `tile` / `center` |
| `--position` | `center` | 任意 `background-position` |
| `--overlay` | `0.42` | 遮罩不透明度 |
| `--overlay-color` | `auto` | 按底色亮度自动选黑/白 |
| `--blur` | `0` | 高斯模糊半径（**烘进图片**，不是运行期 `backdrop-filter`） |
| `--max-width` | `2560` | 超过则 LANCZOS 降采样（先降采样再模糊） |
| `--scope` | `both` | `both` / `main` / `mini` |
| `--targets` | `none` | 生成派生皮肤 `<id>-bg`（0.8.7 时代的老路） |

**图片为什么是 base64 内联**：宿主把 CSS 整份读进 `<style>`，`@import` 与相对 `url()` 都按
`tauri://` 解析、够不到插件目录，`file://` 又被 WebView2 拒。2560×1440 的 q88 JPEG 约 133 KB，
`bg-custom\theme.css` 因此约 139 KB。配置里**只存源图路径**，每次构建重新编码。

**当前状态**：功能完整、三档验收全绿，但按用户口径 **m00785「既然已知不行那就先不做」
刻意没装进宿主**。0.8.8 起宿主已新增独立的 `background` 通道，皮肤与背景从此可共存；
本仓库产物仍是 `plugin_type:"skin"` 形态。细节见
[`docs/reference/background-plugin.md`](docs/reference/background-plugin.md)。

---

## 7. 本地预览与无头审计

皮肤相关改动不必装进宿主就能验证：

```bash
# 直接双击打开（读同目录 <id>/theme.css，与宿主同一条注入路径）
preview.html          # 主控台，顶部按钮切换四套皮肤
preview-mini.html     # 迷你面板（410×610）

# 无头 Chrome 审计（computedStyle）
bash _tools/audit.sh                       # 四套变体
PAGE=preview-mini.html bash _tools/audit.sh  # 迷你面板四套

# 截图 / 色相族普查
bash _tools/shots.sh
python _tools/census.py _shots/mini-skin-win11-dark.png
```

预览页加载 `_extracted/host-shell.css`（**从 exe 原样抽取的宿主 CSS**），并在 `<html>` 上写死
`data-theme="mono"`（宿主默认主题，最不利场景），DOM 逐字复刻宿主 JSX。所以在预览里量到的
computedStyle 与像素可以拿来推断宿主行为。

常用 URL 参数：

| 参数 | 作用 |
|---|---|
| `#<skin_id>` | 初始激活哪套皮肤 |
| `?notrans=1` | 关闭全部过渡（截图 / 审计必加） |
| `?audit=1` | 把关键元素 computedStyle 写进 DOM 供抓取 |
| `?allactive=1` | 强制打开所有 `.active` / `:hover` 态 |
| `?bare=1` | 去掉页面留白（整张截图即窗口本体） |
| `?bgprobe=1` | 换纯品红底，做逐像素差分证明不透明 |
| `?nofix=1` | 隐藏预览夹具（跑色相族普查必加） |

细节见 [`docs/reference/preview-and-audit.md`](docs/reference/preview-and-audit.md)。

---

## 8. 验收

### 8.1 插件市场（主交付物）

```bash
python build_market.py --check                          # 产物自检
python market/validate_catalog.py market/catalog.json   # 目录 E1–E10
bash _tools/market-verify.sh cyber                      # 验收闸
bash _tools/market-verify.sh mono                       # 另一套主题
```

`market-verify.sh` 在**等价宿主环境**（复刻 `srcDoc` + sandbox + 父窗口桥）里跑预览页，
退出码 0 = PASS。它断言：`ready` 为真、`cards > 0`、**JS 错误为 0**、安装弹窗能打开且含命令与披露项、
「实时发现」能点且不抛异常、mono 下类型徽标去饱和（`sat < 0.12`）。

> 走 **HTTP 而非 `file://`**：真实宿主里插件文档 origin 是 `tauri://localhost`（CORS 语义），
> `file://` 下 `fetch` 直接被拒，会让「目录能拉下来」这条路径永远测不到。

当前基线：cyber 与 mono 双 **PASS**（`cards=2`、`badges=8`、`installed=2`、0 JS 错误）。

### 8.2 皮肤与背景（工具链）

```bash
python build_skins.py            # 先重建产物（见 §5 的警告）
bash _tools/verify.sh            # 132 条断言，exit 1 不许交付
bash _tools/verify-bg.sh         # 背景链（第一条是「既有 132 条无回归」）
bash _tools/verify-bg.sh off     # 停用后的零泄漏验收
PAGES=preview-mini.html:mini bash _tools/_stress.sh 48 8   # 改过预览页必跑，须「异常 0 次」
```

验收只认 **exit code**。`dom.hueFamilies = 2` **单独出现不算通过**——坏读数里全是宿主原色时
族数也恰好是 2，必须同时满足正向条件（`skin_active` = 本变体、`rules_applied`、`settle.remounts` 等）。

历史验收记录（0.8.8 基线，产物已删，仅供对照）：

* 四套变体的「不透明」逐像素证明：换底色差分仅 **130 px（0.0145%）**，且全在圆角抗锯齿边缘，
  窗口内部差异为 **0**；
* 真机主窗 1702×1213 物理（≈1135×809 CSS @150%），与预览对齐后 **MAE 22.16**；
* 迷你面板真机与预览 **MAE 19.98**，宿主调色板计数 ≈ 0。

真机取证方法见 [`docs/reference/real-machine-verification.md`](docs/reference/real-machine-verification.md)。

---

## 9. 安装 / 停用 / 卸载

**市场 / 任意插件**：

* **安装**：把插件目录放到 `%APPDATA%\OpenRevo\plugins\<plugin_id>\`，回插件页点【刷新】。
* **停用**：插件面板里拨回开关，宿主立刻移除注入内容。
* **卸载**：删除对应目录，并在 `%APPDATA%\OpenRevo\config.json` 里清掉
  `custom_plugin_toggles` / `widget_positions` 中残留的该 ID（若存在）。

在仓库内可直接：

```bash
python build_market.py --install          # 市场
python build_skins.py --install           # 四套皮肤
python build_background.py install        # 背景
```

> ⚠️ 改 `config.json` 前先备份。宿主运行中持有权威内存态，**会整份回写 config**，
> 保险做法是「停 → 改 → 启」，或改完立即回读复验。

---

## 10. 已知边界

* **市场不能一键安装**：宿主没有安装类 IPC（§2.2），只能给可复制的命令。
* **真机 CDP 不是工作路径**：宿主 `requireAdministrator`，且 WebView2 启动参数被 wry 覆盖，
  `--remote-debugging-port` 不会打开。真机取证只能走提权置顶抓图 + 像素度量。
* **`widget` / `slot` 未实测**：形态枚举来自前端字面量，宿主里的实际行为没做过端到端验证。
* **皮肤产物不在仓库里**：`verify.sh` / `audit.sh` 需先 `python build_skins.py`。
* **本机模型无图片输入**：一切观感判读只能靠直方图、列行亮度、分块 MAE 与 ASCII 渲染。
* **许可**：`market/catalog.json` 的条目声明 `MIT`，但仓库目前**没有 `LICENSE` 文件**——
  如需正式授权，请补一份。

---

## 11. 文档地图

`docs/` 本身就是一套技能包，入口是 [`docs/SKILL.md`](docs/SKILL.md)。

| 文件 | 内容 |
|---|---|
| [`docs/SKILL.md`](docs/SKILL.md) | **入口**：状态、五种形态、硬约束、工作流、验收 |
| [`docs/README.md`](docs/README.md) | 文档怎么用、维护约定 |
| [`docs/reference/market-host-constraints.md`](docs/reference/market-host-constraints.md) | 市场为什么长这样：0.9.1 `tab` 契约、无安装 IPC 取证 |
| [`docs/reference/skin-authoring.md`](docs/reference/skin-authoring.md) | 皮肤编写：令牌架构、特异性阶梯、双面板配方 |
| [`docs/reference/background-plugin.md`](docs/reference/background-plugin.md) | 背景插件：data URI、遮罩同层、独立通道 |
| [`docs/reference/preview-and-audit.md`](docs/reference/preview-and-audit.md) | 预览页能力、无头 Chrome、像素判据 |
| [`docs/reference/real-machine-verification.md`](docs/reference/real-machine-verification.md) | 提权重启 / 唤醒 / 置顶抓图 / 度量基线 |
| [`docs/reference/host-truth-extraction.md`](docs/reference/host-truth-extraction.md) | 从 exe 抽宿主 CSS/JS 的方法 |
| [`docs/reference/environment-and-tools.md`](docs/reference/environment-and-tools.md) | 环境硬事实、工具地图、证据索引、回退清单 |
| [`docs/reference/pitfalls.md`](docs/reference/pitfalls.md) | 踩坑总表：现象 → 原因 → 对策 |
| [`docs/devlog.md`](docs/devlog.md) | 开发记录：时间线、每步数字证据、未决项 |
| [`docs/OpenRevo_第三方插件开发手册.md`](docs/OpenRevo_第三方插件开发手册.md) | 官方手册 v1.0（**存档 ≠ 行为准则**） |

---

## 12. 命名沿革

| 时间 | 名称 | 变化 |
|---|---|---|
| 2026-10-04 | `openrevo-win-skin` → `openrevo-plugins` | 从「一个 `dist\` 里的构建产物」升格为「根目录下的多个子文件夹项目」；插件 ID 去掉 `fluent` 前缀 |
| 2026-10-17 | `openrevo-plugins` → **`open-revo-market`** | 重心转为插件市场；四套皮肤产物删除、工具链保留 |

GitHub 对旧仓库名保留重定向，旧的 clone / raw URL 仍可用，但**请改用新地址**：
`https://github.com/LIPiston/open-revo-market`。
