# 审核指南：一个插件能不能进「已审核」

> **给谁看 / 什么时候读**：你是这个市场的审核者，有人提了 issue 申请审核，或者你看到目录里有条目需要下架时读这份。它给出可照做的判据与逐项检查单，以及把结论写进 `market/overrides.json` 的方法。
>
> 作者那一侧看到的东西在 [`submit-plugin.md`](submit-plugin.md)；宿主能力的依据在 [`host-contract.md`](host-contract.md)。

## 先看清一件事：收录是零审核的

作者打上 `openrevo-plugin` topic，下一轮爬虫就会把他收进目录，**没有任何人看过**。所以审核不是准入闸 —— 它只做两件事：

- 决定谁能从「未审核」升到「已审核」；
- 出事之后把人**撤下来**（`exclude`）。

文档不能假装市场有前置审查。用户看到的「未审核」标记才是真正的防线，审核只是给它加一层。

## 三档

| 档 | 表现 | 怎么写 |
|---|---|---|
| **可进已审核** | 列表里不再带未审核标记 | `"unreviewed": false` |
| **收录，仍标未审核** | 保持原样，用户看得到标记 | 不写，或附 `review_note` 说明缺什么 |
| **不予收录** | 从目录移除 | `"exclude": true` + `review_note` |

只在申请审核或发现问题时才动手。**不要为了让目录「整齐」给没申请的条目改字段。**

## 判据只有两条

审核不是评代码质量。只有两件事决定结论：

1. **安全性** —— 它拿到的权限会不会害到用户；
2. **环境适配** —— 在别人的机器上装了会不会坏。

底层原因：**OpenRevo 运行在系统最高权限**，插件做的事就是最高权限在做的事。所以「它能读什么、能写什么」不是抽象风险。这两条之外的东西（代码风格、目录结构、README 排版、有没有测试）**都不作为拒绝理由**。

## 一、安全性：四条一票否决

这四条的共同点是**用户无法自己核实** —— 不是「看起来危险」，而是「装了就只能信作者」。

| # | 否决条件 |
|---|---|
| S1 | 要提权、装驱动、或带 `service` 伴随进程，**却没有在 README 与清单里写明它做什么、为什么必须提权** |
| S2 | 读凭据/密钥**同时**有联网能力，且没有说明数据去向 |
| S3 | 运行期下载并执行代码，或用 `cmd` / `powershell` 拼字符串执行外部命令 |
| S4 | 代码被混淆/打包成无法阅读，或仓库里没有与产物对应的源码 |

怎么核：

- **S1** —— 看清单有没有 `service` 段或 `elevated: true`，再回头读 README 的前两屏。写了「需要管理员」但没写「为什么」的，按 S1 处理。
- **S2** —— 需要同时命中「读凭据」与「有网络」两个能力。只有其中一个不算否决，走披露即可。
- **S3** —— 在源码里搜 `eval(`、`new Function(`、`exec(`、`spawn(`、`Invoke-Expression`、`download` 后跟执行的模式。
- **S4** —— 仓库里应有能读懂、且与发布的 `index.html` 对应的源码。构建产物可以入库，但源码不能缺席。

除这四条外的风险（联网、读写文件、读环境变量）**不作为否决**，它们会进披露区，由用户自己判断。

## 二、环境适配：四维，不拦收录

缺一项就进不了「已审核」，但不会因此下架。

| # | 维度 | 要看什么 |
|---|---|---|
| A1 | 操作系统与架构 | Win10 / Win11、x64 / ARM64、必需的 VC++ 运行库 |
| A2 | 硬件厂商 | Intel / AMD / 两者。只支持一种的，README 第一屏必须写清 |
| A3 | 外部依赖 | 驱动、PawnIO、其他软件、端口占用。**缺了会怎样必须写出来** |
| A4 | 宿主版本 | `min_host_version` 是否如实填（只认三段数字） |

> 编号用 `A1–A4` 而不是 `E`，是为了和校验器的 `E1–E15` 区分开 —— 两套东西互相无关。

**A3 是这一档最在意的**：用户以为装上了、其实没生效，比装不上更糟。一个「缺驱动时静默不工作」的插件，即使代码毫无恶意也进不了已审核。

## 三、怎么定能力

`capabilities` 现在是**审核者读源码后写下的结论**，不是作者的声明，也不是自动扫描的产物 —— 爬虫恒写 `null`（三态里的「未扫描」），仓库里没有扫描器。

在 `overrides.json` 里写：

```json
"owner/repo:": { "capabilities": ["network", "fs-read"] }
```

只认下面八个取值（校验器 E6 强制，写别的会让 CI 红）：

| 取值 | 对应的代码特征 |
|---|---|
| `network` | `fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource`，或宿主侧的 HTTP 客户端 |
| `fs-read` | 读文件、读目录、读注册表 |
| `fs-write` | 写文件、改配置、写注册表 |
| `shell` | 调 `cmd` / `powershell` / `bash`，或 `exec` / `spawn` 外部程序 |
| `env` | 读环境变量、读系统信息 |
| `credentials` | 读浏览器数据、密钥、令牌、密码库 |
| `dynamic-code` | `eval` / `new Function` / 运行期加载并执行代码 |
| `host-runtime` | 依赖宿主 IPC 才能工作（不调 IPC 就什么都做不了） |

三态语义，别混：

| 值 | 含义 |
|---|---|
| `["network"]` 等数组（非空） | 扫过，检出这些 |
| `[]` | **扫过，没检出任何能力** —— 这是个结论，不是空 |
| `null`（字面量） | 没扫过 |

所以「这个插件我没看过」要写 `null`、或者干脆不碰这个字段；**不要写 `[]`**，那等于声称「我检查过，很干净」。

## 四、机器挡的 / 人要判的

`market/validate_catalog.py` 已经挡掉了一批形状问题。审核时**不必重复人工核对**，跑一遍就行：

```bash
python market/validate_catalog.py market/catalog.json
```

| 校验项 | 管什么 | 谁管 |
|---|---|---|
| E1 | 顶层 `count` 等于条目数 | 机器 |
| E2 | 身份唯一（`repo`+`subpath`、`id` 都不重复） | 机器 |
| E3 | `repo` 是 `owner/name`；`subpath` 不逃逸 | 机器 |
| E4 | `plugin_type` 在八个取值内 | 机器 |
| E5 | `capabilities` 是 `null` 或数组 | 机器 |
| E6 | 能力值在八个名字内 | 机器 |
| E7 | `unreviewed` 是布尔 | 机器 |
| E8 | 必填字段存在 | 机器 |
| E9 | `description` 不含 HTML 标签 | 机器 |
| E10 | `commit` 是 40 位 hex | 机器 |
| E11 | `sha256` 是 64 位 hex | 机器 |
| E12 | `author` 等于 `repo` 的 owner | 机器 |
| E13 | 形态字段形状（`target_slot` / `service` / `shortcuts` 等） | 机器 |
| E14 | `min_host_version` 是三段数字或 `null` | 机器 |
| E15 | `plugin_type: slot` 必须给 `target_slot` | 机器（**只对已审核条目**） |

E15 只对已审核条目强制，是有意的：未审核条目是爬虫自动收的，第三方清单写不全不该让本仓库的 CI 变红 —— 那会让目录停止刷新。所以 **`slot` 插件要升级到已审核时，`target_slot` 必须补齐**，这条得人工确认。

**机器挡不住的，才是审核的活**：S1–S4、A1–A4（适配那四项），以及「他写的描述是否诚实」。

## 五、逐项检查单

照着走一遍，十条：

1. 打开仓库，确认**默认分支**里有 `manifest.json`（根或一级子目录）。
2. 读 `manifest.json`：`id` 是否符合命名（小写字母/数字/`-`）、`plugin_type` 是否填对、`description` 是否说清了做什么。
3. 读 README 前两屏：**有没有讲清楚它做什么**。
4. 有 `service` 或 `elevated` → 对照 **S1**，看有没有写明「为什么需要提权」。
5. 翻源码：对照 **S3 / S4**，有没有混淆、有没有运行期下载执行。
6. 对照 **S2**：有没有同时出现读凭据与联网；有的话数据去向写没写。
7. 对照 **A1–A4**：支持的平台、硬件、外部依赖、`min_host_version`。
8. 特别看 **A3**：缺依赖时是报错还是静默失效，README 说了没有。
9. 把能力结论写进 `overrides.json` 的 `capabilities`（八个取值，见上）。
10. 按结论写 `unreviewed: false` 或 `exclude: true`，附 `review_note`。

## 六、把结论写进覆写层

`market/overrides.json` 是**唯一**要人工编辑的文件。`catalog.json` 是爬虫每小时整份重写的派生物，改它没用。

键是 `owner/repo:subpath`，仓库根条目 subpath 留空：

```json
{
  "format": 1,
  "plugins": {
    "LIPiston/open-revo-market:plugin-market": { "unreviewed": false },
    "someone/power-plugin": {
      "unreviewed": false,
      "capabilities": ["host-runtime", "fs-write"],
      "sha256": "64 位小写 hex"
    },
    "someone/broken-plugin": {
      "exclude": true,
      "review_note": "需要 PawnIO 驱动，但 README 与清单都没写缺驱动时会怎样；AMD 专用未在首屏说明。"
    }
  }
}
```

### 值的语义

| 值 | 结果 |
|---|---|
| 字段省略，或为 `null` / `""` | **不覆写**，保留爬虫这一轮抓到的值 |
| 其余任何值（含 `false` / `[]` / `{}`） | 直接覆盖 |
| `"exclude": true` | 该条**不进目录** |
| `"review_note": "…"` | 只给人看，**不进 `catalog.json`** |

### 三个容易踩的

- **`[]` 不当空处理。** `capabilities: []` 是「扫过、没检出」这个结论。想表达「不管它」就省略字段。
- **键不用 `id`。** 作者改一次 `manifest` 里的 `id`，用 `id` 存键就会静默失配 —— 想改的那条没改上，而且不报错。
- **拼错会报错。** 字段名拼错、覆写 `repo`／`subpath`、`exclude` 写成非布尔、`format` 不是 `1`，都直接抛 `OverrideError` 并让 CI 红。

### 拒绝理由

写在 `review_note` 里，一句话到三句话，**说清缺哪一项**。它会公开留在仓库里，作者能看到，也省掉反复私聊。

写法要求：

- 指向具体的检查项（「S1」「A3」），不要写「质量不行」；
- 说清**怎么改能过**，而不只是「不行」；
- 不要评价作者、不要贴源码片段。

`review_note` 是控制字段，不会进 `catalog.json` —— 它是给人看的备注，不是目录数据。

### 常用操作

**收进正典**：

```json
"owner/repo:": { "unreviewed": false }
```

**只改描述，其余照抓**：

```json
"owner/repo:": { "description": "一句话说清做什么。" }
```

**钉死扫描结论**（`[]` = 扫过、没检出）：

```json
"owner/repo:": { "capabilities": [] }
```

**钉住 sha256，升级为可验证安装**（宿主据此拒绝被替换的包）：

```json
"owner/repo:": { "sha256": "64 位小写 hex" }
```

**下架**：

```json
"owner/repo:": { "exclude": true, "review_note": "…" }
```

**收录一个 topic 搜不到的条目**（自建 CDN、fork 等）：必须显式给 `id`，否则明确中止 —— 目录里的 `id` 是安装后的目录名，猜不出来就不猜。

```json
"owner/repo:某子目录": { "id": "插件目录名", "unreviewed": false }
```

`exclude` 到一条当前不在目录里的键（多半是键拼错了）不报错，但会打一行提示 —— 排除静默失效比报错难查。

### 自检

```bash
python market/overrides.py                      # format / 字段名 / 空白语义 / 排除统计
python market/validate_catalog.py market/catalog.json
```

CI 在抓取之前先跑 `overrides.py`：文件有错立刻红，不用等爬完十分钟才发现。

## 七、公开理由的边界

`review_note` 会随仓库公开。所以：

- **可以写**：缺哪一项、代码里观察到什么行为、怎么改能过；
- **不要写**：作者的账号可信度评价、猜测的动机、未经验证的指控。

如果你是**因为安全疑虑下架**的，写「观察到 X 行为，与声明不符」就够，不要写「此人有恶意」—— 你观察到的是代码，不是动机。

## 八、不变式（审核时不能让步的）

- **身份 = `owner/repo[/subpath]`**，绝不用展示名当键。
- **作者 = 仓库归属者**，`manifest` 自填的 `author` 不作数。
- **能力是三态**：`[...]` 检出、`[]` 扫过未检出、`null` 没扫过。爬虫只许写 `null`；人工写 `[]` 才是结论。
- **人工判断不写在派生物里**：`catalog.json` 每小时整份重写，审核结论一律写 `overrides.json`。
- **失败不伪装**：判不了就说判不了（`null`），不要填一个好看的默认值。

## 下一步

- 作者侧的上架流程：[`submit-plugin.md`](submit-plugin.md)
- 宿主能力与安装器防线：[`host-contract.md`](host-contract.md)
- 改市场本身（构建、验收闸、爬虫）：[`maintenance.md`](maintenance.md)
