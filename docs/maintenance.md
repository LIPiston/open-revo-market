# 市场维护：改市场本身

> **给谁看 / 什么时候读**：你要改市场的源码、改爬虫、跑验收闸、或者排查「目录没刷新」时读这份。只是发布插件的话看 [`submit-plugin.md`](submit-plugin.md)，只是审核别人看 [`review.md`](review.md)。
>
> 宿主行为（IPC、sandbox、subpath 语义）不在这里，在 [`host-contract.md`](host-contract.md) —— 这份只讲本仓库怎么用它们。

## 仓库结构

```
open-revo-market\
├── market\
│   ├── src\                    # ★ 只改这里：index.template.html / market.css / market.js
│   ├── catalog.json            # 派生目录（CI 每小时重写，别手改）
│   ├── overrides.json          # 人工覆写层（审核 / 覆写 / 下架）
│   ├── overrides.py            # 覆写层读写与校验
│   ├── crawl_topic.py          # topic 爬虫（末尾叠加覆写层）
│   ├── validate_catalog.py     # 目录校验 E1–E15
│   └── tests\                  # 覆写层单元测试
├── build_market.py             # 构建器（多文件产物 + 自检）
├── plugin-market\              # ★ 构建产物（入库，可直接装）
├── tools\                      # 安装 / 验收 / 预览 / 出图
└── docs\                       # 文档（见根 README 的导航）
```

**源码只在 `market/src/`。** `plugin-market/` 是生成物，手改下一轮构建就没了。

## 构建

```bash
python build_market.py            # 构建 + 产物自检
python build_market.py --check    # 只做产物自检，不写文件
python build_market.py --install  # 构建并装到 %APPDATA%\OpenRevo\plugins\plugin-market\
```

构建把 `market/src/` 下的三个源文件组装成**多文件**产物：`index.html`（骨架，只外链下面两个）+ `market.css` + `market.js`，另生成 `manifest.json`，并把 `market/PLUGIN_README.md` 复制成 `plugin-market/README.md`（装进用户插件目录给终端用户看）。

**`market/catalog.json` 也会被整份内联进 `market.js`**，作为 `const SEED` —— 在线目录拉不到时的兜底数据。所以「市场里显示的兜底条目」是**上次构建时**的目录快照，不是当前的：改了 `catalog.json` 必须重新 `python build_market.py`，产物里的兜底才会跟着变。

**为什么可以外链**：宿主 0.9.5 实测 `tab` 插件的基准 URL 是插件目录，`<link rel=stylesheet>` / `<script src>` / 相对 `fetch()` 都能取到（`docs/host-contract.md` §实测：外部资源）。所以样式和逻辑不必再内联。构建期反过来断言「**只**引用 `market.css` 与 `market.js`」—— 多引一个文件或在 CSS 里写 `@import` 都会失败。

**`manifest.json` 必须带 `window`，且照抄 ec-config 那套取值**（1180×820 / `decorations: true` / `resizable: true` / `skip_taskbar: false`）。缺 `decorations` ⇒ 宿主默认无边框 ⇒ 独立视窗关不掉，用户只能结束进程。构建期断言这几个字段齐全、且 `width >= 900`、`height >= 640`。完整对照实验见 [`host-contract.md`](host-contract.md) §独立视窗。

> 改完 `window` 后若独立视窗**还是旧尺寸**，通常是宿主复用了一个没被销毁的旧窗口，不是配置没生效 —— 判别与解除办法见同一节「踩过的坑」。

`--check` 做的自检包括：产物五个文件齐全、`index.html` 只引用那两个资源、占位符已替换、`SEED` 已内联、`manifest.window` 可关窗且尺寸够大、`market.js` 里没有硬编码宿主版本号（能力必须运行时探测；判据已排除内联目录，否则会把插件自己的 `version` 误判成宿主版本）、`install_plugin_from_url` 的参数带 `id`+`url`+`archiveSubpath()`、以及实时发现不再有 `data-act="live"` 按钮且存在 `maybeAutoLive()`。

## 目录与覆写层

```
别人给仓库打 topic ──► 爬虫（每小时 / 可手动）──► overrides.json 叠加 ──► catalog.json ──► 市场页签
                          ↑                                                     │
                  实时发现（切到页签自动跑一次）直接查 GitHub ◄──────────────────┘
```

实时发现只补「目录里还没有的仓库」，查到的条目带 `data-live` 标记、单独计卡。它**不写回** `catalog.json` —— 别人看到的仍是爬虫那轮的结果。结果缓存 5 分钟（跨 tab 与独立视窗共享，因为是 `localStorage`），并有一把 30 秒软锁防止两个上下文同时打 GitHub。

`catalog.json` 是**纯派生物**：爬虫每轮按 topic 全量重抓、覆盖整份文件；人工判断（审核标记、字段覆写、`sha256`、下架）一律写在 `overrides.json`，抓完之后无条件叠加。

**审核怎么用覆写层**在 [`review.md`](review.md) §六 —— 那里是操作的唯一出处，这份不重复。

`catalog.json` 的字段只有 `generatedAt` / `topic` / `count` / `plugins`，**没有版本号字段**。曾经有个 `"format": 1`，但两端都不读（前端只检查 `plugins` 是数组，校验器完全不看它），改它不会有任何行为变化，所以删掉了。`overrides.json` 里的 `format` 则**是真会读的**（`overrides.py` 校验，不是 1 就报错），用来挡住「把别的 JSON 误当覆写文件放到这个路径」。

### 爬虫

```bash
python market/crawl_topic.py --local-only   # 不联网：重建本仓库条目 + 重放覆写层
python market/crawl_topic.py --out market/catalog.json   # 全量重爬（需要 GITHUB_TOKEN）+ 重放覆写层
```

参数：`--dry-run`（不写文件）、`--local-only`、`--out <路径>`、`--overrides <路径>`。

**爬虫失败时不写文件**，让上次产物继续服务。这比写一份半空的目录好 —— 用户至少还能看到旧数据。

`--local-only` 只收录本仓库自带的插件（读本地 manifest），topic 刚起步时它是空集，光靠爬取目录里会一条都没有。

### 校验

```bash
python market/overrides.py                              # 覆写层：format / 字段名 / 空白语义 / 排除统计
python market/validate_catalog.py market/catalog.json   # 目录 E1–E15
```

E1–E15 各自管什么，见 [`review.md`](review.md) §四的表格。简单说：**机器挡形状，人判风险**。

## 本地预览（等价宿主）

`tools/market-preview.html` 复刻宿主对 `tab` 插件的处理：iframe 的 sandbox 逐字照抄、`srcDoc` 注入、父窗口挂 `__TAURI_INTERNALS__` 模拟 Tauri 桥。

```bash
# 预览页要 fetch 产物，file:// 下会被 CORS 拒，所以起本地服务
python -m http.server 8791
# 打开 http://127.0.0.1:8791/tools/market-preview.html?theme=cyber&host=new
```

| 参数 | 作用 |
|---|---|
| `?theme=cyber\|mono\|light` | 模拟宿主主题 |
| `?host=new\|old` | 能力齐全的宿主，或缺少安装 IPC 的宿主 |
| `?catalog=local` | 把在线目录 URL 改写成本地 `market/catalog.json` |
| `?modal=1` | 自动打开安装弹窗并**停在那里**供出图（不跑演练，演练会把弹窗关掉） |
| `?delay=<ms>` | 配合 `?modal=1`：延迟多久打开弹窗，默认 2600 |
| `?nodiag=1` | 隐藏诊断浮层，供人眼检查版式 |

出图：

```bash
bash tools/market-shots.sh        # 列表 cyber/mono、窄屏 cyber/mono、弹窗 cyber
bash tools/market-shots-modal.sh  # 只出弹窗（cyber/mono），停在弹窗上
powershell -NoProfile -ExecutionPolicy Bypass -File tools/host-shot.ps1 -Full  # 真实宿主窗口（只读）
```

## 验收闸

```bash
python build_market.py --check
python market/overrides.py
python market/validate_catalog.py market/catalog.json
python -m pytest market/tests -q
bash tools/market-verify.sh cyber
bash tools/market-verify.sh mono
```

**PASS 才许交付。** 两种主题各跑一遍。

> Windows 上也能直接跑（Git Bash / MSYS）：脚本把交给 Python 的路径统一过一遍 `cygpath -w`，不依赖 shell 的参数自动转换 —— 设了 `MSYS2_ARG_CONV_EXCL=*` 时 `/d/...` 会被原样透传，原生 Windows 版 Python 认不出，静态服务会全 404。

### `market-verify.sh` 断言什么

默认跑**两种宿主 mock**（能力齐全 / 无安装 IPC）：

- `ready` 为真，**目录卡片数精确等于 `min(本地 catalog.json 条数, 12)`** —— 目录不超过一页时整份都要出现，超过一页时等于每页条数。写成「> 0」会让「目录整个拉丢了」和「目录真的只有 1 条」看起来一样。**实时发现条目单独计数**（卡片带 `data-live`）：它现在自动触发，会在目录之外再插若干张卡，混在一起数就再也断言不了目录完整性了；
- **JS 错误为 0**；
- 能力齐全：点【安装】→ 弹窗 → 点【立即安装】→ 真发 `install_plugin_from_url`，且 `usedNativeConfirm === false`（防止有人改回 `window.confirm`）；
- 能力齐全：`uninstall_ok` —— `uninstall_plugin` 真被调用、参数是 `id` 且无 `pluginId`、弹窗关闭；
- 无安装 IPC：弹窗打开且给出含 `plugins` 路径的可粘贴命令；
- **实时发现是自动的**：UI 上**没有** `[data-act="live"]` 按钮，且**未点击任何东西**就出现了 `.mkt-note` 横幅。只判「有横幅」不够 —— 按钮被加回来也能有横幅；
- **自适应列数**：把 iframe 拉到 1240 / 1000 / 840 / 600 / 460 五档，逐个量 `grid-template-columns` 的轨道数 —— 最宽必须 4–5 列、约 1000px 必须 ≥3 列、最窄必须落回 1 列、列数随宽度单调递减、任何一档都不许横向溢出。列数由**容器宽度**决定（`.mkt-body` 上的 `@container`），不是视口，所以量的是 body 实宽而不是窗口尺寸；
- mono 下类型徽标去饱和（`sat < 0.12`），且**必须真的取到徽标** —— 取不到算失败。

另外有**五轮专项**（合成目录只落在 `_shots/`，不进 `market/catalog.json`）：

- **加速开关**（`?proxy=1`）：勾上后 `install_plugin_from_url` 的 `url` 必须带 `https://gh-proxy.com/` 前缀；不勾时必须不带。两条都测，否则「开关画了没接线」和「默认偷偷走代理」都验不出来。
- **分页/滚动**（30 条临时目录）：滚动容器真的可滚、翻页真的能翻且回顶部。
- **形态筛选**（`service` / `shell` / `driver` 各一条）：三个筛选按钮出现且计数为 1，卡片真的用上对应的 `type-*` 徽标类名。
- **披露与兼容徽章**（`slot` + 三条 `min_host_version`）：卡片上真的写出「挂载插槽 / `power.hardware_limit` / 54px」；`0.0.1` 不报过低、`99.0.0` 报过低、非法版本串不渲染徽章。
- **生命周期**（一条带 `service` 的已装条目）：【停用】真发 `set_plugin_enabled_unified { id, enabled:false }`、【启用】发 `enabled:true`；点【启动服务】真发 `start_plugin_service` 且状态文字跟着变；宿主没有 `can_manage_service` 时按钮 disabled，且**一条服务类 IPC 都不发**。

> 走 **HTTP 而非 `file://`**：真实宿主里插件文档 origin 是 `tauri://localhost`（CORS 语义），`file://` 下 `fetch` 直接被拒，会让「目录能拉下来」这条路径永远测不到。

当前基线：cyber 与 mono 双主题各跑 **八轮**（两种宿主 mock + 五轮专项 + 服务能力缺失），全 PASS，0 JS 错误。

## 下载链路与加速

国内直连 GitHub 常常超时，所以下载链路有两种走法。加速服务是 **gh-proxy.com**：把完整 GitHub URL 拼在 `https://gh-proxy.com/` 后面即可。

| 链路 | 默认行为 |
|---|---|
| 拉目录 `market/catalog.json` | 直连 → 加速 → jsDelivr，依次尝试 |
| 「实时发现」（GitHub 搜索 API） | 直连 → 加速 |
| 一键安装（宿主下载归档） | **默认直连**，弹窗里有「走 gh-proxy 加速」勾选框 |
| 手动 `git clone` 备用命令 | 直接给加速地址（不通可去掉前缀） |
| `tools/install-market.ps1` | 走加速，**失败自动回退直连**；`-Direct` 强制直连 |

**一键安装为什么默认不加速**：加速后的归档根目录与直连一致（已实测，因此 `subpath` 语义不变，规则见 [`host-contract.md`](host-contract.md)）；但宿主是否接受 GitHub 之外的下载域名**尚未实测**。所以做成显式开关，并在弹窗里写明「若报安全策略错误，关掉这个开关用直连重试」—— 不把未验证的路径设成默认。

## CI

`.github/workflows/refresh-catalog.yml` 每小时第 17 分钟跑一次，顺序是：

1. 校验覆写层（`overrides.py`）—— 文件有错立刻红，不用等爬完才发现；
2. 爬 topic 并叠加覆写层；
3. 校验目录（`validate_catalog.py`）；
4. **只在内容变化时**提交（`git diff --quiet` 门槛，避免空转出一堆无意义历史）。

`contents: write` 权限，`concurrency` 组 `refresh-catalog` 不取消进行中的任务。

## 发布市场自己

```powershell
irm https://raw.githubusercontent.com/LIPiston/open-revo-market/main/tools/install-market.ps1 | iex
```

脚本拉 main 分支的 `plugin-market/`，剥掉归档的包装层后复制到 `%APPDATA%\OpenRevo\plugins\plugin-market\`，并**自校验**：`manifest.json` 的 `id`、`index.html` / `market.css` / `market.js` 三个文件都在、`index.html` 确实引着那两个文件，且 `css + js` 合计不少于 20 KB（少于就判失败）。已有旧版会被覆盖。

直连 raw.githubusercontent 打不开时：

```powershell
irm https://gh-proxy.com/https://raw.githubusercontent.com/LIPiston/open-revo-market/main/tools/install-market.ps1 | iex
```

| 参数 | 作用 |
|---|---|
| 无参数 | 从 GitHub main 拉取现成产物（默认） |
| `-Local` | 用本仓库已入库的 `plugin-market\`（离线、可控） |
| `-From <目录>` | 从指定目录安装 |
| `-DryRun` | 只打印将要做什么，不下载、不写盘 |
| `-Repo owner/name` | 换仓库 |

## 不变式

这五条改代码时不能让步。违反其中任何一条，测试可能还是绿的，但市场会开始撒谎。

- **身份 = `owner/repo[/subpath]`**，绝不用展示名当键（展示名会撞车）。
- **作者 = 仓库归属者**：`author` 必须等于 `repo` 的 owner，`validate_catalog.py` 的 E12 强制。`manifest` 自填的 `author` 可能是「某某社区」之类与仓库控制权无关的名字，不能当真。
- **能力披露是三态**：`[...]` = 扫过并检出；`[]` = 扫过未检出；`null` = 没扫过。爬虫不做真实扫描，一律写 `null`（UI 渲染「未扫描」）—— 它**不许**写 `[]`，那等于撒谎说「检查过，很干净」。人工写 `[]` 则是合法结论，来源不同。
- **人工判断不写在派生物里**：`catalog.json` 每小时整份重写。这条是踩出来的 —— 以前靠 `merge()` 继承人工字段，结果删除不保（爬虫每小时把删掉的条目加回来）、`capabilities: []` 每小时被冲回 `null`。
- **失败不伪装**：在线目录拉不到时保留兜底数据并如实写明原因（如 `未连上在线目录：HTTP 404`）；`stars` 取不到写 `null` 而不是 `0`。

## 维护约定

- **市场是唯一主链**：源码只在 `market/src/`，产物 `plugin-market/` 是生成物。改完跑构建 + 验收闸（cyber 与 mono）。
- 代码改完请同步受影响的文档。文档归并过一次，每件事只应有一个出处 —— **新增内容前先找它属于哪份**，不要开第五个出处。
- 宿主会自我更新：写与 exe 相关的断言前先比 exe 体积与资产文件名（**文件名里的哈希就是内容哈希**），字节偏移不能跨版本沿用。取证方法见 [`host-contract.md`](host-contract.md) §判断一个命令到底存不存在。
- `market/catalog.json` 与 `market/overrides.json` 的关系（派生物 vs 人工层）不要再用「合并时保留」那套旧机制描述 —— `merge()` 已经删了。
