# OpenRevo 插件市场 · `open-revo-market`

OpenRevo（`open-revo.exe`）的**第三方插件市场**：宿主里的一个页签，浏览、安装、卸载插件。

项目原名 `openrevo-plugins`，2026-10-17 更名为 **`open-revo-market`**
（GitHub 仓库：`LIPiston/open-revo-market`；旧地址仍会重定向）。
2026-10-18 起仓库**只维护市场一条链** —— 皮肤与背景插件已整体移除（见 [`docs/removed-skins.md`](docs/removed-skins.md)）。

> **本机克隆目录名可能与仓库名不同**（如 `openrevo-plugins\`）。目录名不影响任何命令；
> 想统一可跑 `_tools\rename-project.ps1`。

| 项 | 当前值 |
|---|---|
| 宿主 | **9,437,696 B** 那版（`ProductVersion` 仍报 0.9.1），有安装 / 卸载 IPC |
| 主交付物 | **`plugin-market/`**（`tab` 形态，已入库，`git clone` 后可 `--install` 即用） |
| 插件目录 | `%APPDATA%\OpenRevo\plugins\` 里**只有 `plugin-market`** |
| 皮肤 / 背景 | **已移除**（2026-10-18），代码、产物、工具链、文档都不在本仓库 |

---

## 快速开始

**一条命令安装**（不 clone 仓库，直接拉 GitHub 上的现成产物）：

```powershell
irm https://raw.githubusercontent.com/LIPiston/open-revo-market/main/_tools/install-market.ps1 | iex
```

装完打开 OpenRevo → 侧边栏【插件】页 → 右上角【刷新】→ 顶栏出现「插件市场」页签。

从源码构建（改过 `market/src/` 时用这条）：

```bash
python build_market.py --install    # 构建并装到 %APPDATA%\OpenRevo\plugins\plugin-market\
python build_market.py --check      # 只做产物自检，不写文件
bash _tools/market-verify.sh cyber  # 验收闸（另跑 mono 主题），非 0 不许交付
```

> `_tools\install-market.ps1` 也支持 `-Local`（用仓库里已入库的 `plugin-market\`）、
> `-From <目录>`（指定来源）、`-DryRun`（只看要做什么）、`-Repo owner/name`（换仓库）。

---

## 仓库结构

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
├── _tools\                     # 安装 / 验收 / 审计 / 抓图工具
├── docs\                       # 详细文档与技能包（见下）
├── _audit\                     # 审计输出（gitignore）
└── _shots\                     # 截图与验收出图
```

**市场的核心口径**（细节见 [`docs/market.md`](docs/market.md)）：

* 安装方式**由宿主能力位决定**（运行时探测 `get_plugin_host_capabilities`），不按版本号猜 ——
  两代宿主的 `ProductVersion` 都是 0.9.1。
* 构建产物**必须单文件**：宿主用 `srcDoc` 注入，任何外部引用都会 404。
* 在线目录拉不到时保留兜底数据并如实写明原因；`stars` / 能力披露缺失写 `null`，不伪装。

---

## 文档地图

| 文档 | 内容 |
|---|---|
| [`docs/market.md`](docs/market.md) | 市场完整说明：能力、宿主降级、构建、预览、验收闸、安装卸载 |
| [`docs/host-and-plugins.md`](docs/host-and-plugins.md) | 插件生态实测：五种形态、sandbox、两代宿主 IPC |
| [`docs/project-status.md`](docs/project-status.md) | 已知边界 + 命名沿革 |
| [`docs/removed-skins.md`](docs/removed-skins.md) | 已移除的皮肤 / 背景链留档 |
| [`docs/SKILL.md`](docs/SKILL.md) | 技能入口：状态、硬约束、工作流、验收清单 |
| [`docs/devlog.md`](docs/devlog.md) | 开发记录（时间线 + 证据 + 未决项） |
| [`docs/reference/host-plugin-ipc.md`](docs/reference/host-plugin-ipc.md) | **新宿主**的插件 IPC：签名、能力位、安装器防线 |
| [`docs/reference/market-host-constraints.md`](docs/reference/market-host-constraints.md) | **老宿主**的 tab 契约（已被新宿主部分推翻） |
| [`docs/reference/host-truth-extraction.md`](docs/reference/host-truth-extraction.md) | 怎么从 exe 抽宿主 CSS / JS |
| [`docs/reference/plugin-dev-0.8.8-skill.md`](docs/reference/plugin-dev-0.8.8-skill.md) | 开发者新版 skill 的逐条实测对照 |
| [`docs/reference/plugin-manual-digest.md`](docs/reference/plugin-manual-digest.md) | 官方手册消化件 +「手册 ≠ 发行版」对照表 |
| [`docs/reference/environment-and-tools.md`](docs/reference/environment-and-tools.md) | 环境硬事实、**工具地图**、证据索引、回退清单 |
| [`docs/reference/pitfalls.md`](docs/reference/pitfalls.md) | 踩坑总表：现象 → 原因 → 对策 |

---

## 注意事项

* **别手改产物**：改 `market/src/`，然后 `python build_market.py --install`。
* 当前基线：cyber / mono 双主题 × 新旧两代宿主，**四个组合全 PASS**，0 JS 错误。
* `widget` / `slot` 两种形态只从前端字面量确认，**未做端到端实测**；
  `service` / `shell` / `driver` 在前端里无字面量，不要依据手册对外承诺。
* 改 `%APPDATA%\OpenRevo\config.json` 前**先备份**：宿主运行中会整份回写。
* **许可**：仓库目前**没有 `LICENSE` 文件**（尽管目录条目声明 MIT）——如需正式授权请补一份。
