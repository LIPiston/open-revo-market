# OpenRevo 插件市场 · `open-revo-market`

OpenRevo（`open-revo.exe`）的**第三方插件市场**：宿主里的一个页签，浏览、安装、卸载插件。

项目原名 `openrevo-plugins`，2026-10-17 更名为 **`open-revo-market`**
（GitHub 仓库：`LIPiston/open-revo-market`；旧地址仍会重定向）。
2026-10-18 起仓库**只维护市场一条链** —— 皮肤与背景插件已整体移除（见 §9）。

> **本机克隆目录可能仍叫旧名**（如 `D:\LIPis\Documents\code\openrevo-plugins\`）。
> 目录名与仓库名无关，不影响任何命令；想统一可跑 `_tools\rename-project.ps1`。

| 项 | 当前值 |
|---|---|
| 宿主 | **9,437,696 B** 那版（`ProductVersion` 仍报 0.9.1），有安装/卸载 IPC |
| 主交付物 | **`plugin-market/`**（`tab` 形态，已入库，`git clone` 后可 `--install` 即用） |
| 插件目录 | `%APPDATA%\OpenRevo\plugins\` 里**只有 `plugin-market`** |
| 皮肤 / 背景 | **已移除**（2026-10-18），代码、产物、工具链、文档都不在本仓库 |

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

宿主里的一个 `tab` 页签：浏览第三方插件、看能力披露、安装或卸载。

### 2.1 能做什么

| 能力 | 说明 |
|---|---|
| **浏览目录** | 拉取策展目录 `market/catalog.json`，按类型分组（已审核 / 未审核），支持搜索与筛选；列表可滚动，超过一页自动分页（每页 12 条） |
| **实时发现** | 直接查 GitHub 上带 topic `openrevo-plugin` 的仓库，作者打完 topic 立刻可见，不必等爬虫 |
| **识别已安装** | 通过宿主只读命令 `get_custom_plugins` 给已装插件打标，并可按安装状态筛选 |
| **能力披露** | 列出静态扫描检出的联网 / 文件读写等能力，危险组合单列（如「读凭据 + 有网络」） |
| **安装 / 卸载** | 宿主开放 IPC 时一键完成（`install_plugin_from_url` / `uninstall_plugin`）；否则退回可粘贴的命令 |

### 2.2 安装方式由宿主能力决定

宿主分两代，能力差别很大，所以市场**启动时探测** `get_plugin_host_capabilities`，
按返回的能力位决定 UI，**不按版本号猜**（两代宿主的版本号字符串相同）：

| 能力位 | 为真时 | 为假 / 命令不存在时 |
|---|---|---|
| `can_install` | 点【安装】直接调 `install_plugin_from_url`，宿主负责下载、校验、解压、落盘 | 弹窗给出可粘贴的 PowerShell 命令 |
| `can_uninstall` | 卡片上出现【卸载】，目录移入回收站 | 隐藏【卸载】 |
| `can_reload` | 装完调 `reload_plugins` 自动重扫 | 退回 `get_custom_plugins` 只读枚举 |
| `can_read_manifest` | 读已装版本，标出「可更新」 | 不显示更新提示 |

一键安装时市场**只发一条 IPC**，所有危险动作都在宿主侧：强制 HTTPS、可选 `sha256` 校验、
解压防 Zip Slip、目标必须落在 AppData 边界内。市场自己不下载、不写盘 ——
`tab` 插件的 iframe 既没有 `allow-downloads` 也没有 `allow-popups`，这类动作本来就不在插件手里。

> 目录条目没带 `sha256` 时只能校验传输完整性，**证明不了内容没被篡改**。
> 想升级为可验证安装，给 `catalog.json` 条目补 `sha256`（校验器 E11 会检查形状）。
> 取证细节见 [`docs/reference/host-plugin-ipc.md`](docs/reference/host-plugin-ipc.md)。

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
| `market/validate_catalog.py` | 目录结构校验 E1–E11，CI 与本地共用 |
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
├── _extracted\                 # 从 open-revo.exe 抽出的宿主真值
│   ├── v091\                   #   0.9.1 前端 JS / CSS（当前基线）
│   ├── index-C535NsqC.css      #   0.8.8 时期抽取物（历史基线，仅对照）
│   ├── host-shell.css          #   宿主外壳规则子集
│   └── ...
├── _tools\                     # 验收 / 审计 / 抓图工具（见 §6）
├── docs\                       # 技能包与参考文档（见 §7）
├── _audit\                     # 审计输出（gitignore）
└── _shots\                     # 截图与验收出图
```

---

## 4. OpenRevo 插件生态（实测）

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
| `tab` | `allow-scripts allow-forms allow-same-origin` | 无 `allow-downloads` / `allow-popups` / `allow-modals` |
| `widget` | 上者 + `allow-modals` | 多模态对话框 |
| `slot` | **无 sandbox** | 与宿主同源、无隔离 |

`tab` 里 **`window.confirm` / `alert` 会被静默拦掉并返回 `false`** —— 任何「点确认才继续」
的流程必须用页面内弹窗，否则表现为「点了没反应、控制台零报错」。市场踩过这个坑。

> `tab` 同时给 `allow-same-origin` + `allow-scripts` ⇒ **沙盒形同虚设**：iframe 与宿主同源，
> 既能读 `window.parent.document`，也能拿 `window.parent.__TAURI_INTERNALS__.invoke`。
> **绝不**把「跑在 iframe 里」当安全边界。

### 4.3 插件命令：分两代宿主

两代 exe 的 `ProductVersion` **都是 0.9.1**，版本号无法区分能力。老宿主只有 13 条插件命令：

```
get_custom_plugins          load_plugin_html            load_plugin_theme_css
load_plugin_background_css  set_custom_plugin_enabled   open_plugins_dir
open_custom_widget          close_custom_widget         widget_ready
set_active_skin             get_active_skin             set_active_background
get_active_background
```

老宿主这 13 条里**没有一条能**：下载 / 写盘 / 删除插件 / 重载目录 / 开外链 / 读任意文件 / 读宿主版本。

新宿主（9,437,696 B）新增了整族市场与生命周期 IPC：`install_plugin_from_url`、`uninstall_plugin`、
`reload_plugins`、`get_plugin_manifest`、`set_plugin_enabled_unified`、`get_plugin_host_capabilities`、
`open_external_url`、`write_clipboard`、`start_plugin_service` / `stop_plugin_service`。
完整签名与安装器的实际防线见 [`docs/reference/host-plugin-ipc.md`](docs/reference/host-plugin-ipc.md)。

**所以插件代码绝不能按版本号分支** —— 只能运行时探测 `get_plugin_host_capabilities`，
命令不存在就说明是老宿主、走降级路径。市场就是这么做的（§2.2）。另外
`restart_plugin_service` **不存在**，重启只能 stop + start。

### 4.4 让宿主认到新插件

插件页【刷新】= **重扫列表 + 热重载当前样式**，所以装新目录、改样式
**都只需点一次【刷新】**，不必拨开关、不必重启。

---

## 5. 本地预览与验收

### 5.1 等价宿主预览

`_tools/market-preview.html` 复刻宿主对 `tab` 插件的处理：iframe 的 sandbox 逐字照抄、
`srcDoc` 注入、父窗口挂 `__TAURI_INTERNALS__` 模拟 Tauri 桥。

```bash
# 起本地服务（预览页要 fetch 产物，file:// 下会被 CORS 拒）
python -m http.server 8791
# 打开 http://127.0.0.1:8791/_tools/market-preview.html?theme=cyber&host=new
```

| 参数 | 作用 |
|---|---|
| `?theme=cyber\|mono\|light` | 模拟宿主主题 |
| `?host=new\|old` | 模拟新宿主（能力齐全）或老宿主（无安装 IPC） |
| `?catalog=local` | 把在线目录 URL 改写成本地 `market/catalog.json` |
| `?modal=1` | 自动打开安装弹窗供出图 |
| `?nodiag=1` | 隐藏诊断浮层，供人眼检查版式 |

### 5.2 验收闸

```bash
python build_market.py --check                          # 产物自检
python market/validate_catalog.py market/catalog.json   # 目录 E1–E11
bash _tools/market-verify.sh cyber                      # 验收闸
bash _tools/market-verify.sh mono                       # 另一套主题
```

`market-verify.sh` 默认跑 **两代宿主 mock**，断言：

* `ready` 为真，**卡片数精确等于本地 `market/catalog.json` 的条数**（不是「> 0」——
  否则「目录整个拉丢了」和「目录真的只有 1 条」看起来一样）；
* **JS 错误为 0**；
* 新宿主：点【安装】→ 弹窗 → 点【立即安装】→ 真发 `install_plugin_from_url`，
  且 `usedNativeConfirm === false`（防止有人改回 `window.confirm`）；
* 老宿主：弹窗打开且给出含 `plugins` 路径的可粘贴命令；
* 「实时发现」能点且不抛异常；
* mono 下类型徽标去饱和（`sat < 0.12`），且**必须真的取到徽标** —— 取不到算失败。

> 走 **HTTP 而非 `file://`**：真实宿主里插件文档 origin 是 `tauri://localhost`（CORS 语义），
> `file://` 下 `fetch` 直接被拒，会让「目录能拉下来」这条路径永远测不到。

当前基线：cyber 与 mono 双主题 × 新旧两代宿主，**四个组合全 PASS**，0 JS 错误。

---

## 6. 工具地图

| 类别 | 工具 |
|---|---|
| **市场（主链）** | `build_market.py`、`_tools/market-verify.sh`、`_tools/market-preview.html`、`_tools/market-shots.sh`、`market/crawl_topic.py`、`market/validate_catalog.py` |
| 度量（模型不能读图，这就是眼睛） | `census.py`（色相族普查）、`cmp.py`（分块 MAE）、`prof.py`（行/列亮度签名）、`ascii.py`（ASCII 渲染） |
| 宿主进程 | `kill-and-start.ps1`（提权重启）、`restart.ps1`、`show-app.ps1`、`when.ps1` |
| 列窗口 / 抓图 | `allwins.ps1`、`listwins.ps1`、`wins.ps1`、`pin-grab-hwnd.ps1`、`wake-grab-dash.ps1`、`grab.ps1`、`grab-main.ps1` |
| 工程维护 | `rename-project.ps1`、`probe-win.ps1`、`probe-win-dpi.ps1`、`who.ps1`、`who-locks.ps1` |

⚠️ 含中文的 `_tools\*.ps1` **必须存成 UTF-8 BOM**，否则 PS 5.1 按 GBK 解码报莫名其妙的错。

---

## 7. 文档地图

| 文档 | 内容 |
|---|---|
| [`docs/SKILL.md`](docs/SKILL.md) | 技能入口：状态、硬约束、工作流、验收清单 |
| [`docs/reference/host-plugin-ipc.md`](docs/reference/host-plugin-ipc.md) | **新宿主**的插件 IPC：签名、能力位、安装器防线 |
| [`docs/reference/market-host-constraints.md`](docs/reference/market-host-constraints.md) | **老宿主**的 tab 契约（已被新宿主部分推翻，见页首横幅） |
| [`docs/reference/host-truth-extraction.md`](docs/reference/host-truth-extraction.md) | 怎么从 exe 抽宿主 CSS/JS |
| [`docs/reference/plugin-dev-0.8.8-skill.md`](docs/reference/plugin-dev-0.8.8-skill.md) | 开发者新版 skill 的逐条实测对照 |
| [`docs/reference/plugin-manual-digest.md`](docs/reference/plugin-manual-digest.md) | 官方手册消化件 +「手册 ≠ 发行版」对照表 |
| [`docs/reference/environment-and-tools.md`](docs/reference/environment-and-tools.md) | 环境硬事实、工具地图、证据索引、回退清单 |
| [`docs/reference/pitfalls.md`](docs/reference/pitfalls.md) | 踩坑总表：现象 → 原因 → 对策 |
| [`docs/devlog.md`](docs/devlog.md) | 开发记录（时间线 + 证据 + 未决项） |

---

## 8. 安装 / 停用 / 卸载

* **安装**：`python build_market.py --install`，回插件页点【刷新】。
* **停用**：插件面板里拨回开关，宿主立刻移除注入内容。
* **卸载**：删 `%APPDATA%\OpenRevo\plugins\plugin-market\`，并在
  `%APPDATA%\OpenRevo\config.json` 里清掉 `custom_plugin_toggles` 中残留的该 ID。

> ⚠️ 改 `config.json` 前先备份。宿主运行中持有权威内存态，**会整份回写 config**，
> 保险做法是「停 → 改 → 启」。

---

## 9. 已移除：皮肤与背景

2026-10-18 按用户口径整体移除，**不再维护**：

| 移除项 | 说明 |
|---|---|
| 四套皮肤 `skin-win1{0,1}-{light,dark}` | 产物已于 2026-10-17 删除，本轮连同生成器一起移除 |
| `build_skins.py` / `src/base.css` | 皮肤生成器与结构层 |
| `bg-custom` 及其构建链 | `build_background.py` / `bg_common.py` / `src/background.css` / `bg.config.json` |
| `preview.html` / `preview-mini.html` | 皮肤预览页 |
| `_tools/verify.sh` / `audit.sh` / `_stress.sh` / `shots.sh` / `shoot1.sh` / `verify-bg.sh` / `set-active-skin.ps1` | 皮肤与背景的验收/出图/切皮脚本 |
| `docs/reference/{skin-authoring,background-plugin,preview-and-audit,real-machine-verification}.md` | 对应文档 |

历史实现都在 git 历史里：`git log --oneline -- build_skins.py` 可取回。
**背景插件后续会重做** —— 重做时不要再依赖 `build_skins`，直接用宿主的
`plugin_type:"background"` 通道（`active_background` → `<style id="openrevo-custom-background">`）。

---

## 10. 已知边界

* **一键安装依赖宿主能力**：新宿主开放了 `install_plugin_from_url` 等 IPC，老宿主没有；
  市场按 `get_plugin_host_capabilities` 运行时降级（§2.2），不会假装能装。
* **一键安装的参数链已在真机上对齐**：`{ id, url, subpath }` 逐字对上宿主 serde，
  `subpath` 传的是**归档内**路径（`open-revo-market-main/plugin-market`）——
  宿主不会剥 codeload 的 `<repo>-<branch>/` 包装层，这条是踩过一次才查清的
  （`reference/host-plugin-ipc.md` §3.1）。弹窗里仍保留「复制命令」的手动路径。
* **真机 CDP 不是工作路径**：宿主 `requireAdministrator`，且 WebView2 启动参数被 wry 覆盖，
  `--remote-debugging-port` 不会打开。真机取证只能走提权置顶抓图 + 像素度量。
* **`widget` / `slot` 未实测**：形态枚举来自前端字面量，宿主里的实际行为没做过端到端验证。
* **本机模型无图片输入**：一切观感判读只能靠直方图、列行亮度、分块 MAE 与 ASCII 渲染。
* **许可**：`market/catalog.json` 的条目声明 `MIT`，但仓库目前**没有 `LICENSE` 文件**——
  如需正式授权，请补一份。

---

## 11. 命名沿革

| 时间 | 事件 |
|---|---|
| 2026-10-17 | 仓库 `openrevo-plugins` → `open-revo-market`，主交付物收敛为插件市场 |
| 2026-10-17 | 四套皮肤产物目录删除（工具链保留） |
| 2026-10-18 | 市场改为按宿主能力探测，支持一键安装/卸载 |
| 2026-10-18 | 皮肤与背景整链移除；目录收敛为 1 条（`plugin-market`） |
