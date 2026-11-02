# OpenRevo 插件市场

OpenRevo（`open-revo.exe`）的第三方插件市场：宿主里的一个页签，浏览、安装、卸载插件。

目录来自 GitHub 上带 `openrevo-plugin` topic 的仓库，每小时刷新一次，任何人都能上架。

## 安装

```powershell
irm https://raw.githubusercontent.com/LIPiston/open-revo-market/main/_tools/install-market.ps1 | iex
```

装完打开 OpenRevo → 侧边栏【插件】页 → 右上角【刷新】→ 顶栏出现「插件市场」页签。

从源码构建（改过 `market/src/` 时用这条）：

```bash
python build_market.py --install    # 构建并装到 %APPDATA%\OpenRevo\plugins\plugin-market\
```

`_tools/install-market.ps1` 还支持 `-Local`（用仓库里已入库的 `plugin-market\`）、`-From <目录>`、`-DryRun`、`-Repo owner/name`、`-Direct`（强制直连，不走加速）。

## 三扇门

| 你要做的事 | 读这份 |
|---|---|
| **发布自己的插件** —— manifest 怎么写、打 topic 后多久被收录、审查看什么、被拒了怎么办 | [`docs/submit-plugin.md`](docs/submit-plugin.md) |
| **审核别人的插件** —— 三档结论、四条一票否决、四维环境适配、逐项检查单、覆写层操作 | [`docs/review.md`](docs/review.md) |
| **改市场本身** —— 构建、本地预览、验收闸八轮专项、爬虫、CI、下载加速 | [`docs/maintenance.md`](docs/maintenance.md) |

宿主到底支持什么行为（IPC、sandbox、`subpath` 语义、安装器防线）统一在 [`docs/host-contract.md`](docs/host-contract.md)。

## 市场是什么、不是什么

**是**：一个按 GitHub topic 自动收录的目录，带能力披露、兼容性徽章、一键安装（宿主支持时）。

**不是**：不是安全审计，也没有前置审查。作者打上 topic 就会被收录，标注「未审核」；「已审核」需要单独申请，判据写在 [`docs/review.md`](docs/review.md)。

插件是第三方代码，**以你的权限运行**。装之前看清披露，只装你信任的来源。`tab` 插件与宿主同源，不要把「跑在 iframe 里」当成安全边界。

## 几条核心口径

README 只保留最容易被搞错的三条，其余一律链到唯一出处：

* **安装方式由宿主能力位决定**（运行时探测 `get_plugin_host_capabilities`），不按版本号猜，也不假装能装。
* **人工判断写在 `market/overrides.json`**；`market/catalog.json` 是爬虫每小时整份重写的派生物，**改它没用**。
* **清单里自述的字段**（权限、遥测、挂载插槽、伴随服务、窗口几何）单列一块「清单声明」如实转述，**不当成授权依据** —— 真正的边界由宿主沙盒与 IPC 决定。

"清单里写什么就信什么"这条的边界在 [`docs/submit-plugin.md`](docs/submit-plugin.md)；"哪些字段宿主压根不读"在 [`docs/host-contract.md`](docs/host-contract.md)；改代码时不能让步的五条不变式在 [`docs/maintenance.md`](docs/maintenance.md)。

## 已知边界

诚实清单，不要当成待办事项读：

* **一键安装依赖宿主能力**：宿主开放了 `install_plugin_from_url` 等 IPC 才能一键装；否则市场退回「复制命令」的交接路径，不会假装能装。
* **`subpath` 是归档内路径，不是仓库内路径**：传错就会报 `manifest.json not found in resolved content directory`。这条为什么成立、该怎么构造，见 [`docs/host-contract.md`](docs/host-contract.md)。
* **八种 `plugin_type` 的运行行为未做端到端实测**：`skin` / `background` / `tab` / `widget` / `slot` 在前端里有注入分支，`service` / `shell` / `driver` 的取值与语义来自官方手册。市场对 `plugin_type` 只做分组筛选与配色，不据此推断任何运行期行为，也不承诺八种都装得上。
* **加速下载是可选路径**：加速后的归档根目录与直连一致（已实测），但宿主是否接受 GitHub 之外的下载域名**未验证** —— 所以加速默认关闭，由用户在安装弹窗里勾选。
* **没有在真实宿主里完整走完一次「一键安装到生效」**：参数与归档目录解析已对齐，但「装完插件真的出现在侧边栏」这一步没有真机截图佐证。
* **爬虫恒写 `null`**：仓库里没有静态扫描器，所以新收录的条目能力一律是「未扫描」。已审核条目的能力由审核者读源码后写进覆写层（见 [`docs/review.md`](docs/review.md)）。
* **许可**：仓库目前**没有 `LICENSE` 文件**（尽管目录条目声明 MIT）—— 如需正式授权请补一份。

## 仓库结构

```
open-revo-market\
├── market\
│   ├── src\                    # 市场源码（只改这里）
│   ├── catalog.json            # 派生目录（CI 每小时重写，别手改）
│   ├── overrides.json          # 人工覆写层（审核 / 覆写 / 下架）
│   └── *.py                    # 爬虫 / 覆写层 / 目录校验 / 测试
├── build_market.py             # 构建器（多文件产物 + 自检）
├── plugin-market\              # 市场构建产物（入库，可直接装）
├── _tools\                     # 安装 / 验收 / 预览 / 出图
└── docs\                       # 文档（见上面的三扇门）
```

细节在 [`docs/maintenance.md`](docs/maintenance.md)。

## 注意事项

* **别手改产物**：改 `market/src/`，然后 `python build_market.py --install`。
* 改 `%APPDATA%\OpenRevo\config.json` 前**先备份**：宿主运行中会整份回写。
* 改完代码或文档，验收闸的跑法见 [`docs/maintenance.md`](docs/maintenance.md) —— `PASS` 才许交付。
