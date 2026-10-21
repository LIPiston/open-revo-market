# 插件市场 `plugin-market`

宿主里的一个 `tab` 页签：浏览第三方插件、看能力披露、安装或卸载。

> 宿主 IPC 的逐字签名见 [`reference/host-plugin-ipc.md`](reference/host-plugin-ipc.md)。

## 1. 能做什么

| 能力 | 说明 |
|---|---|
| **浏览目录** | 拉取策展目录 `market/catalog.json`，按类型分组（已审核 / 未审核），支持搜索与筛选；列表可滚动，超过一页自动分页（每页 12 条） |
| **实时发现** | 直接查 GitHub 上带 topic `openrevo-plugin` 的仓库，作者打完 topic 立刻可见，不必等爬虫 |
| **识别已安装** | 通过宿主只读命令 `get_custom_plugins` 给已装插件打标，并可按安装状态筛选 |
| **能力披露** | 列出静态扫描检出的联网 / 文件读写等能力，危险组合单列（如「读凭据 + 有网络」） |
| **安装 / 卸载** | 宿主开放 IPC 时一键完成（`install_plugin_from_url` / `uninstall_plugin`）；否则退回可粘贴的命令 |

## 2. 安装方式由宿主能力决定

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

一键安装的参数链 `{ id, url, subpath }` 已在真机上逐层校订：`subpath` 是**归档内**路径
（GitHub codeload 的 zip 解压后固定多一层 `<repo>-<branch>/`，宿主不会剥）。
构造逻辑在 `archiveSubpath()`，取证见 [`reference/host-plugin-ipc.md`](reference/host-plugin-ipc.md) §3.1。

## 3. 目录与发现机制

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

## 4. 三条不能让步的口径

* **身份 = `owner/repo[/subpath]`**，绝不用展示名当键（展示名会撞车）。
* **能力披露是三态**：`[...]` = 扫过并检出；`[]` = 扫过未检出；**`null` = 没扫过**。
  爬虫不做真实扫描，一律写 `null`（UI 渲染「未扫描」）。**绝不写 `[]`** —— 那等于撒谎说「检查过，很干净」。
* **失败不伪装**：在线目录拉不到时保留兜底数据，并如实写明原因（如 `未连上在线目录：HTTP 404`）；
  `stars` 取不到写 `null` 而不是 `0`（排序时放最后）。爬虫失败时**不写文件**，让上次产物继续服务。

## 5. 源码与构建

| 目录 / 文件 | 作用 |
|---|---|
| `market/src/` | 源码：`market.js` + `market.css` + `index.template.html`（**只改这里**） |
| `build_market.py` | 把三者内联成**单文件** `plugin-market/index.html`，并做产物自检；`--check` / `--install` |
| `market/catalog.json` | 策展目录（构建时内联为离线兜底 `SEED`） |
| `market/crawl_topic.py` | 爬 GitHub topic → 生成 / 合并目录（`--dry-run` / `--merge` / `--out`） |
| `market/validate_catalog.py` | 目录结构校验 E1–E11，CI 与本地共用 |
| `.github/workflows/refresh-catalog.yml` | 每小时自动爬一次，**只在内容变化时**提交 |
| `plugin-market/` | 构建产物（已入库） |
| `_tools/install-market.ps1` | 一条命令安装（在线拉取现成产物 / `-Local` / `-From` / `-DryRun`） |
| `_tools/market-{preview.html,verify.sh,shots.sh}` | 等价宿主环境预览 + 验收闸 + 出图 |

**产物必须单文件**：宿主用 `srcDoc` 把插件 HTML 注入 iframe，基准 URL 是宿主文档
（`tauri://localhost`），任何 `<link rel=stylesheet>` / `<script src>` / `<img src="assets/…">` /
`@import` **都会 404**。构建期会断言零外部引用。

**别手改产物**：改 `market/src/`，然后 `python build_market.py --install`。

## 6. 本地预览（等价宿主）

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

## 7. 验收闸

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
* 新宿主：`uninstall_ok` —— `uninstall_plugin` 真被调用、参数是 `id` 且无 `pluginId`、弹窗关闭；
* 老宿主：弹窗打开且给出含 `plugins` 路径的可粘贴命令；
* 「实时发现」能点且不抛异常；
* mono 下类型徽标去饱和（`sat < 0.12`），且**必须真的取到徽标** —— 取不到算失败。

> 走 **HTTP 而非 `file://`**：真实宿主里插件文档 origin 是 `tauri://localhost`（CORS 语义），
> `file://` 下 `fetch` 直接被拒，会让「目录能拉下来」这条路径永远测不到。

当前基线：cyber 与 mono 双主题 × 新旧两代宿主，**四个组合全 PASS**，0 JS 错误。

## 8. 安装 / 停用 / 卸载

* **安装（推荐）**：一条命令，无需 clone 仓库：

  ```powershell
  irm https://raw.githubusercontent.com/LIPiston/open-revo-market/main/_tools/install-market.ps1 | iex
  ```

  脚本从 codeload 拉取 main 分支的 `plugin-market/`，剥掉 `<repo>-<branch>/` 包装层后
  复制到 `%APPDATA%\OpenRevo\plugins\plugin-market\`，并**自校验** `manifest.json` 的 `id`
  与 `index.html` 的完整性（少于 20 KB 直接判失败）。已有旧版会被覆盖。

* **从源码安装**：`python build_market.py --install`（改过 `market/src/` 时用这条）。
* **停用**：插件面板里拨回开关，宿主立刻移除注入内容。
* **卸载**：删 `%APPDATA%\OpenRevo\plugins\plugin-market\`，并在
  `%APPDATA%\OpenRevo\config.json` 里清掉 `custom_plugin_toggles` 中残留的该 ID。

> ⚠️ 改 `config.json` 前先备份。宿主运行中持有权威内存态，**会整份回写 config**，
> 保险做法是「停 → 改 → 启」。

`install-market.ps1` 的参数：

| 参数 | 作用 |
|---|---|
| 无参数 | 从 GitHub main 拉取现成产物（默认） |
| `-Local` | 用本仓库已入库的 `plugin-market\`（离线、可控） |
| `-From <目录>` | 从指定目录安装（本地构建后验证用） |
| `-DryRun` | 只打印将要做什么，不下载、不写盘 |
| `-Repo owner/name` | 换仓库 |
