# 文档重构：以「上架」和「审核」为主线

> **状态：历史设计稿 · 已实施（2026-11-01）** —— 本文件描述的是重构**前**的状态，是实现这次改动的依据，**不是现行文档**。它提到的 `docs/market.md`、`docs/host-and-plugins.md`、`market/README.md` 等都已删除并入新文件。现行文档见 `README.md` 与 `docs/*.md`。

日期：2026-11-01
基线：`08ffd16`（docs(market): 全面对齐覆写层）
讨论记录：`.ryugi/artifacts/document/docs-restructure/doc.xml`（第 1 轮全部为已同意；本文件把推荐落成定稿，改动处标为「我的判断」）
评审：已过一轮 builder check，提出的 6 个问题见 §5.1，全部有定稿。

## 1. 意图与为什么

现在的文档是照着「维护者自己查口径」长出来的。九份文件、约 850 行里，构建、本地预览、验收闸的八轮专项、从 `open-revo.exe` 里搜命令的取证方法占了近七成；而插件作者真正要看的——manifest 怎么写、怎么被收录、审核看什么——被切碎在根 `README.md`、`docs/market.md` §3、`market/README.md`、`market/PLUGIN_README.md` 四处，同一件事各讲一遍。

最典型的重复是 `subpath` 为什么要多一层 `<repo>-<branch>/`：三个文件各解释一次，措辞还不完全一致。

**「乱」的根因不是内容写错，是同一件事有四个出处、且都不是从读者要做什么出发。** 所以这次重构的核心动作是**归并**——每个事实只留一个权威出处，其余地方链接过去——而不是重写措辞。

第二件要做的事：审核目前**没有成文判据**。机制已经有了（`market/overrides.json` + `validate_catalog.py` 的 E1–E15），缺的是「什么插件能进已审核」。作者最想问的正是这个，而这个问题的答案现在只存在于审核者脑子里。

## 2. 目标 / 非目标 / 反目标

**目标**

- 插件作者打开文档后，能独立完成一次上架，并大致判断自己能不能过审。
- 审核者有一份可以照着逐项过的检查单，拒人时能指出拒在哪。
- 维护者内容（构建、预览、验收、取证）保留完整，但各只留一份、退到后面。
- 每份文件有唯一职责；同一事实不再出现在两份文件里。

**非目标**

- 不改市场前端行为、不改 `market.js` / `market.css`。
- 不改爬虫、校验器、验收闸的逻辑（唯一例外见 §6）。
- 不新增英文文档或英文翻译版。
- 不把文档做成静态站点。

**反目标（就算「技术上完成了」也算失败）**

- 只是把旧内容搬家，作者仍然要先读懂「覆写层」才知道怎么上架。
- 审核门槛写得像已经封版的法规，而市场还在试用期，实际上并不执行。
- 归并时把内容压没了：读者为了查一个字段要跳三个文件。
- 文档写着代码里没有的行为（这是上一轮 commit 刚修过的毛病，不许复发）。

## 3. 约束

- **以 `08ffd16` 及之后的代码为准**，文档描述的行为必须能在代码里找到对应实现；写不出来源的断言就不写。
- 保留现行语言风格：短句、结论先行、把「为什么」写清楚，不写宣传语。
- **有一处代码引用 `docs/host-and-plugins.md`**：`market/src/market.js:5` 的头部注释，且已烤进 `plugin-market/index.html`（第 1155 行附近）。该文件本次会被并入 `docs/host-contract.md`，所以这行注释必须同步改，并重新构建产物。除此之外 `build_market.py`、`_tools/*`、`.github/workflows/*` 均无 `docs/` 引用。
- **`capabilities` 目前恒为 `null`**：`crawl_topic.py` 三处（第 360、418、519 行）都写死 `None`，仓库里**没有任何扫描器**。'能力由工具侧扫描填写' 这句话在代码里没有对应实现 —— 属于反目标里点名的'文档写着代码里没有的行为'，本次必须改写。
- `market/PLUGIN_README.md` **不能删除**：`build_market.py` 的 `write_outputs()` 会把它复制成 `plugin-market/README.md`，随插件装进用户目录。
- `plugin-market/README.md` 是生成物，**永远手改 `market/PLUGIN_README.md`**，然后重新构建。

## 4. 定稿的文件结构

按读者切三份，根 README 只做导航。

| 文件 | 读者 | 唯一职责 |
|---|---|---|
| `README.md` | 所有人 | 这是什么、为什么可信、三扇门（上架 / 审核 / 改市场本身）、一条安装命令、已知边界 |
| `docs/submit-plugin.md` | 插件作者 | manifest 怎么写、放哪、打 topic、多久被收录、审查看什么、常见被拒原因、更新与下架 |
| `docs/review.md` | 审核者（当前就是你） | 三档门槛、逐项检查单、`overrides.json` 全部操作、拒绝理由怎么写 |
| `docs/maintenance.md` | 改市场本身的人 | 构建、本地预览、验收闸、爬虫、目录校验、CI、下载链路与加速、不变式清单 |
| `docs/host-contract.md` | 需要知道宿主边界的人 | 八种形态、`tab` 的 sandbox 与桥、能力位探测、字段名两族、安装器防线、`subpath` 语义、伴随服务、命令存在性取证 |
| `market/PLUGIN_README.md` | 装了插件的终端用户 | 这个插件是什么、怎么用、怎么卸（改短，不讲开发） |

**我的判断（与文档推荐不同的一处）：文件名用英文，标题用中文。** 文档里原本提议 `docs/上架指南.md` 这类中文文件名；我改成 `submit-plugin` / `review` / `maintenance` / `host-contract`，原因是中文文件名在链接里会变成一长串 `%E4%B8%8A...`，在 GitHub、issue、PR 里都不好传播。中文标题仍放在每份文件第一行，根 README 的链接文字也是中文。

## 5. 归并表：每段旧内容去哪

这张表是本次重构的核心依据。**没有任何一段内容可以「两边都留」**。

### `docs/market.md`（279 行，拆散后删除）

| 原节 | 去向 |
|---|---|
| §1 能做什么 | `README.md` 的能力简述（压到 6 行以内）；细节归各文件 |
| §2 安装方式由宿主能力决定（含能力位表） | `docs/host-contract.md` |
| §3 目录与发现机制（含 `overrides.json` 形状与语义、常见操作、自检、作者约定） | 拆三段：机制与语义 → `docs/review.md`；作者约定 → `docs/submit-plugin.md`；`catalog.json` 无版本号字段的由来 → `docs/maintenance.md` |
| §4 形态与清单披露 | 形态枚举 → `docs/host-contract.md`；披露字段表与文案口径 → `docs/submit-plugin.md` |
| §5 生命周期操作 | `docs/host-contract.md` |
| §6 兼容性（`min_host_version` 徽章） | 判断规则 → `docs/host-contract.md`；作者该填什么 → `docs/submit-plugin.md` |
| §7 五条不能让步的口径 | `docs/maintenance.md`「不变式」一节（唯一出处） |
| §8 源码与构建 | `docs/maintenance.md` |
| §9 本地预览 | `docs/maintenance.md` |
| §10 验收闸（八轮专项） | `docs/maintenance.md` |
| §11 下载链路与加速 | `docs/maintenance.md` |
| §12 安装 / 停用 / 卸载 | 用户操作 → `README.md` + `market/PLUGIN_README.md`；`install-market.ps1` 参数 → `README.md` |

### `docs/host-and-plugins.md`（98 行，并入后删除）

全部并入 `docs/host-contract.md`：八种形态表、`tab` 的 `srcDoc` 加载链、三套 sandbox 差异、`__OPENREVO_BRIDGE__` 桥、等价环境实测表、能力位探测、字段名两族、刷新语义、加速默认关闭的理由。

### `docs/reference/host-plugin-ipc.md`（103 行，重命名）

重命名为 `docs/host-contract.md`，并吸收上一份。内容保留：IPC 逐条表、`HostCapabilities` 字段连排、安装器错误串、`subpath` 归档内语义、`service` 子字段与错误码、命令存在性三处交叉确认法。

### `docs/project-status.md`（14 行，删除）

并入 `README.md` 的「已知边界」一节，保留全部六条，不弱化（尤其「没有真机走完一次一键安装到生效」和「没有 LICENSE」）。

### `market/README.md`（168 行，删除）

内容全部是根 README + `docs/market.md` 的重复。其中唯一独有的是「上架快车道 / 正典」的表述方式，改写后进 `docs/submit-plugin.md`。

### `docs/README.md`（16 行，删除）

根 `README.md` 已经是导航，不需要第二份目录。其中「维护约定」两条（改完同步文档；市场是唯一主链）并入 `docs/maintenance.md`。

### `market/PLUGIN_README.md`（60 行，改短）

保留骨架（它做什么 / 安装方式由宿主决定 / 一键安装做了什么 / 安装与卸载），删掉「收录新插件」一节（那是作者的事，不属于已装用户的说明），全文压到 30 行左右。改完重新构建生成 `plugin-market/README.md`。

## 5.1 动笔前必须先定的六件事（评审提出）

### A. `capabilities` 谁来填

现状：`crawl_topic.py` 三处恒写 `null`，仓库里没有扫描器。而 §7 的四条安全红线全靠 `credentials` / `network` / `dynamic-code` 这些取值判断 —— **判据依赖一个没人填的字段**。

**定稿：审核者在第 3 档审核时人工读源码，把结论写进 `overrides.json` 的 `capabilities`。** 理由：`overrides.py` 已经把 `[]` 定义为「扫过、未检出」这个人工结论，机制本来就是为此设计的；自动扫描器不存在，也不在本次范围内。

文档据此要改写两处旧口径：

- 「能力字段由工具侧扫描填写，作者手写无效」里的「工具侧」并不存在，改成「由审核者人工判定后写入覆写层；作者自填无效」；
- `docs/review.md` 增加一节「怎么读源码定能力」，八个能力名各自对应什么样的代码特征（`network` = fetch/XHR/socket、`credentials` = 读注册表/浏览器数据/密钥文件……），让这一步可重复。

**这条决定了安全红线能不能执行**：红线不是「清单里写了 `credentials`」，而是「审核者读代码确认它有 `credentials` 且有 `network`」。

### B. 谁改 `unreviewed`

现有文档让作者自己 PR `overrides.json` 写 `"unreviewed": false` —— **等于让作者自封已审核**，和「审核」这个动作直接矛盾。

**定稿：作者不写 `unreviewed`。** 流程改为：作者打 topic 被自动收录（未审核）→ 作者提一个 issue 请求审核（只填仓库地址，不改任何文件）→ 审核者判断后自己写 `overrides.json`。

因此 `docs/submit-plugin.md` **完全不出现 `overrides.json` 的键格式与空白语义**（那是审核者的工具），只在「怎么申请审核」里写「提一个 issue，写上仓库地址」。作者永远不需要编辑这个文件 —— 这样才守得住「一个事实一个出处」。

### C. `review_note` 的代码改动在范围内

**定稿：在范围内。** §2 的非目标「不改代码」让位给这一行改动，因为它是审核环节唯一缺的机制。

- `market/overrides.py`：`CONTROL_FIELDS` 加 `"review_note"`；
- 重新跑 `python market/overrides.py`；
- `docs/review.md` 有「拒绝理由怎么写」一节；
- §9 补一步验证：写一条带 `review_note` 的临时覆写，确认 `load()` 放行、且该字段**没有**被写进 `catalog.json`。

### D. 被拒之后怎么落地

审核者拒绝时，`review_note` / `exclude` 由**审核者自己提交**，不走作者的 PR —— 被拒的 PR 根本落不了地。作者通过 issue 收到答复，公开理由留在 `overrides.json` 与提交历史里。这堵上了「理由写了但没人能提交」的漏洞。

### E. `market/src/market.js:5` 的失效注释

该行注释指向本次将被删除的 `docs/host-and-plugins.md`。

**定稿：改注释 + 重新构建。**

- `market/src/market.js:5` 里的 `docs/host-and-plugins.md` → `docs/host-contract.md`；
- 跑 `python build_market.py` 重新生成 `plugin-market/index.html`；
- §9 第 7 步相应修正：`plugin-market/` 的变更应来自**重新构建**，diff 只该有两个来源（README 与这一行注释），逐行核对。

### F. 这份 spec 自己要不要入库

**定稿：入库，但不进导航。** 它是本次重构的依据，删了就丢了「为什么这么分」。它描述的是重构前的状态，**文件顶上必须标注「历史设计稿 · 已实施」**，避免被当成现行文档 —— 这是唯一一份允许与现状不一致的文件，因为它有明确时间戳和状态标注。

`docs/ryugi/specs/` 不加入 `.gitignore`，但也不出现在任何导航里。

## 6. 需要动代码的边界

本次全部改动只有三行代码级修改，其余都是 Markdown：

1. `market/overrides.py`：`CONTROL_FIELDS` 加 `"review_note"`（不是 `CATALOG_FIELDS` —— 它不是目录字段，不该被写进 `catalog.json`），让 `load()` 的白名单校验放行；
2. `market/src/market.js:5`：注释里的 `docs/host-and-plugins.md` → `docs/host-contract.md`；
3. 重新构建：`python build_market.py`，更新 `plugin-market/index.html` 与 `plugin-market/README.md`。

**不改**：`market.js` 的逻辑、`market.css`、`crawl_topic.py`、`validate_catalog.py`、`_tools/*`、CI。

`review_note` 的写法与语义由 `docs/review.md` 唯一持有。

**理由对公众可见**（我的判断，你未表态）：写在 `overrides.json` 和 PR 里，作者能看到，省掉重复沟通；代价是作者的短板被写进公开文件。我认为「说不清为什么被拒」比这个代价更贵。要改成不公开，把它挪到不提交的本地文件即可，随时可改。

## 7. 审核门槛（`docs/review.md` 的骨架）

三档，作者能自查、审核者能逐项过：

1. **不予收录**（`exclude: true`）
2. **收录，标注未审核**（默认状态，零审核快车道）
3. **可进已审核**（`unreviewed: false`）

必须写进文档的一句实话：**快车道是零审核**，作者打上 topic 就进目录，所以第 1 档不是事前拦截，而是**事后下架**。文档不能假装市场有准入闸。

### 一票否决的四条（安全）

底层的理由：**OpenRevo 一直运行在系统最高权限**，插件做的事就是最高权限在做的事。这四条的共同点是「用户无法自己核实」——不是「看起来危险」，而是「装了就只能信作者」。

- 要提权、装驱动、或带 `service` 伴随进程，却没有在 README 与清单里写明它做什么、为什么必须提权；
- 读凭据/密钥同时有联网能力（`credentials` + `network` 组合），且没有说明数据去向；
- 运行期下载并执行代码（`dynamic-code`），或用 `cmd` / `powershell` 拼字符串执行外部命令；
- 代码被混淆/打包成无法阅读的形式，或仓库里没有与产物对应的源码。

其余风险（联网、读写文件）走披露，不作为红线。

**这四条怎么判**：都靠审核者读源码得出，判完把结论写进 `overrides.json` 的 `capabilities`（见 §5.1-A）。文档必须写清「能力是审核者的结论，不是作者的声明」，否则读者会以为清单里的 `permissions` 能当证据 —— 宿主根本不读它。

### 环境适配的四个维度

缺一项就进不了第 3 档，但不拦收录：

- 操作系统与架构：Win10 / Win11、x64 / ARM64、必需运行库；
- 硬件厂商：Intel / AMD / 两者；只支持一种的必须在 README 第一屏写清；
- 外部依赖：驱动、PawnIO、其他软件、端口占用——缺了是报错还是静默失效（**静默失效是本档最在意的一条**）；
- 宿主版本：`min_host_version` 是否如实填（E14 只认三段数字 SemVer）。

### 与校验器的对应

`validate_catalog.py` 的 E1–E15 是**机器能挡的部分**（形状、身份、作者归属、能力值合法性等），文档里只列一次、按「机器挡 / 人要判」分成两栏，避免审核者重复劳动。特别注意 E15 只对已审核条目强制 `target_slot`，这个设计要在文档里解释清楚（未审核条目是爬虫自动收的，不该让 CI 变红）。

## 8. 留给构建者的

- 具体行文由构建者按第 3 节的风格重写，**不是把旧段落剪贴进新文件**。
- 每份文件开头给一句话说明「这份给谁看、什么时候该读」，不要目录。
- 交叉引用一律用相对路径 Markdown 链接，并且**链接句要说明点过去能看到什么**，不能只写「详见 X」。
- 根 README 的三扇门用表格，每行一句话，不展开。
- 写完后跑一遍链接检查（见 §9），不留死链。

## 9. 验证方式

做完必须给出证据，不接受「看起来对」：

1. `python build_market.py` 重新构建（必须——`market.js` 注释与 `PLUGIN_README.md` 都变了），随后 `python build_market.py --check` 通过。
2. `python market/overrides.py` 通过。
3. `python market/validate_catalog.py market/catalog.json` 通过。
4. `bash _tools/market-verify.sh cyber` 与 `mono` 均 ALL PASS（文档改动不该影响，但要跑，防止误触产物）。
5. **死链检查**：遍历所有改动文档里的相对链接，逐个确认目标文件存在；并确认活跃文档（不含本 spec 这类历史稿）里 `host-and-plugins` 0 命中。
6. **口径检查**：确认三件事为 0 命中 ——「改 catalog.json」式过时指引、「能力由工具侧扫描」、「作者 PR 写 unreviewed」；并确认 subpath 归档根**规则本身**只出现在 `docs/host-contract.md`（README 的「已知边界」可以点名这条坑并链过去，但不复述规则）。
7. **`review_note` 验证**：临时写一条带 `review_note` 的覆写，跑 `python market/overrides.py` 应放行；再跑 `python market/crawl_topic.py --local-only` 确认该字段**没有**出现在 `catalog.json` 里；验证完删除临时条目。
8. `git diff plugin-market/` 逐行核对：变更只来自重新构建，且能追溯到 `market/PLUGIN_README.md` 与 `market/src/market.js:5` 两处。

## 10. 讨论记录

`.ryugi/artifacts/document/docs-restructure/`（LiteXML + 评论）。该目录默认不进 git；本文件已把第 1 轮的全部结论以文字形式写入，即便 artifact 丢失也能独立阅读。
