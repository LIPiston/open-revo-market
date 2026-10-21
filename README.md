# OpenRevo 插件市场 · `open-revo-market`

OpenRevo（`open-revo.exe`）的**第三方插件市场**：宿主里的一个页签，浏览、安装、卸载插件。

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
├── _tools\                     # 安装 / 验收 / 预览 / 出图
└── docs\                       # 详细文档（见下）
```

**市场的核心口径**（细节见 [`docs/market.md`](docs/market.md)）：

* 安装方式**由宿主能力位决定**（运行时探测 `get_plugin_host_capabilities`），不按版本号猜。
* 构建产物**必须单文件**：宿主用 `srcDoc` 注入，任何外部引用都会 404。
* 在线目录拉不到时保留兜底数据并如实写明原因；`stars` / 能力披露缺失写 `null`，不伪装。
* GitHub 直连不稳时走 gh-proxy 加速；一键安装的加速是**可选开关**，默认不启用。

---

## 文档地图

| 文档 | 内容 |
|---|---|
| [`docs/market.md`](docs/market.md) | 市场完整说明：能力、宿主降级、构建、预览、验收闸、加速、安装卸载 |
| [`docs/host-and-plugins.md`](docs/host-and-plugins.md) | 插件生态实测：五种形态、sandbox、宿主 IPC、下载链路 |
| [`docs/project-status.md`](docs/project-status.md) | 已知边界 |
| [`docs/reference/host-plugin-ipc.md`](docs/reference/host-plugin-ipc.md) | 插件 IPC 清单：签名、能力位、安装器防线 |

---

## 注意事项

* **别手改产物**：改 `market/src/`，然后 `python build_market.py --install`。
* 当前基线：cyber / mono 双主题 × 两种宿主 mock + 加速专项，**六轮全 PASS**，0 JS 错误。
* `widget` / `slot` 两种形态只从前端字面量确认，**未做端到端实测**；
  `service` / `shell` / `driver` 在前端里无字面量，不要依据手册对外承诺。
* 改 `%APPDATA%\OpenRevo\config.json` 前**先备份**：宿主运行中会整份回写。
* **许可**：仓库目前**没有 `LICENSE` 文件**（尽管目录条目声明 MIT）——如需正式授权请补一份。
