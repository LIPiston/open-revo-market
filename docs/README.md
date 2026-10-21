# OpenRevo 插件开发 · 文档与技能包

这个目录同时承担两件事：

1. **开发记录**：`devlog.md` 记录每一轮从读手册到实测取证的完整时间线、每一步的数字证据与未决项。
2. **可复用技能**：`SKILL.md` + `reference\*.md` 是一份按 Agent Skills 规范组织的技能包
   （YAML frontmatter 的 `name` / `description`，主文件 + 分层参考文件），供下次开发或修改插件时直接加载。

当前技能只覆盖**一条链**：**插件市场**（`plugin-market`，`tab` 形态，本仓库主交付物）。
皮肤与背景插件链已于 2026-10-18 整体移除（见 `SKILL.md` §4）。

## 文件

```
docs\
├── README.md                            # 本文件
├── SKILL.md                             # 技能入口：状态 + 硬约束 + 工作流 + 验收清单 + 参考地图
├── devlog.md                            # 开发记录（时间线 + 证据 + 未决项）
├── market.md                            # 插件市场完整说明：能力 / 降级 / 构建 / 预览 / 验收闸
├── host-and-plugins.md                  # 插件生态实测：五种形态 / sandbox / 两代宿主 IPC
├── project-status.md                    # 已知边界 + 命名沿革
├── removed-skins.md                     # 已移除的皮肤与背景链留档
├── OpenRevo_第三方插件开发手册.md         # 官方手册 v1.0 存档（存档 ≠ 行为准则）
└── reference\
    ├── host-plugin-ipc.md                # **当前宿主**新增的插件 IPC：安装/卸载/能力位（9,437,696 B 实测）
    ├── market-host-constraints.md        # 「老宿主」基线：tab 契约 + 当时缺哪些接口（已被上一行部分推翻）
    ├── plugin-dev-0.8.8-skill.md         # 官方新版 Skill（0.8.8）逐条实测对照
    ├── plugin-manual-digest.md           # 手册消化件 + 「手册 ≠ 发行版」对照表
    ├── host-truth-extraction.md          # 从 exe 抽宿主 CSS/JS；宿主 DOM/令牌/!important 对手规则
    ├── environment-and-tools.md          # 环境硬事实 + 工具地图 + 证据索引 + 回退清单
    └── pitfalls.md                       # 踩坑总表：现象 → 原因 → 对策
```

> **取证基线有两代**，判断前先比 exe 体积：
> * **老宿主** 9,368,576 B —— `market-host-constraints.md`（tab 契约、当时没有任何安装 IPC）
> * **当前宿主** 9,437,696 B —— `host-plugin-ipc.md`（新增安装/卸载/能力位等整族 IPC）
>
> 两代的 `ProductVersion` **都报 0.9.1**，所以能力判断只能运行时探测，不能看版本号。
> `plugin-dev-0.8.8-skill.md` 与 `plugin-manual-digest.md` 的对照基线是 **0.8.8**，只作历史对照；
> **凡冲突，以 `host-plugin-ipc.md` 与 `_extracted/v091/` 的实测为准**。宿主会自我更新 ——
> 写断言前先比 exe 体积与资产文件名（**文件名里的哈希就是内容哈希**）。

> **仓库外的原文**：开发者新版 skill 在 `D:\LIPis\desktop\openrevo-plugin-dev\SKILL.md`（415 行）。
> 它**不在本仓库内**，所以 `reference\plugin-dev-0.8.8-skill.md` 是它的**唯一耐久存档**；
> 原文若变动，以本页记录的实测判定为准重新核对。

## 怎么用

* **人**：先读 `SKILL.md` 的「硬约束」与「现状快照」，再按「工作流」走；卡住时查 `pitfalls.md`。
* **Agent**：把整个 `docs\` 当作技能目录，加载 `SKILL.md` 作为入口；
  只有需要细节时才读 `reference\` 下的文件，避免一次性灌入全部内容。

## 维护约定

* 要接手/交接这摊事（环境、工具在哪、证据在哪、怎么退回用户原状、哪些明确没做）→ 直接看
  `reference\environment-and-tools.md`。原先那两份一次性接手文档（`HANDOVER.md` / `HANDOFF.md`）已于
  2026-10-04 删除，耐久内容全部并入该页；原件保留在 git 提交 `c1e2e03` 里，随时可取回。
* 宿主升级后，`reference\host-truth-extraction.md` 里的**字节偏移、规则条数**会失效，必须重新定位。
  当前 `_extracted/v091/` 对应宿主 0.9.1。
* 代码改完请同步这三处：`README.md`（项目根）、`docs\devlog.md`（这一轮新增了什么）、
  以及受影响的 `docs\reference\*.md`。
* **插件市场是唯一主链**：源码只在 `market\src\`，构建产物 `plugin-market\` 是生成物**别手改**；
  改完跑 `python build_market.py` 再跑 `bash _tools\market-verify.sh cyber`（另跑 `mono`），
  `PASS` 才许交付。目录改动要同步 `market\catalog.json` 与 `crawl_topic.py` 的 `CURATED` 集合。
* **本目录只在权威树里维护**（仓库 `LIPiston/open-revo-market`，2026-10-17 由 `open-revo-plugins` 更名；
  本机克隆目录名可能仍是旧的 `openrevo-plugins\`）。
  历史上同一份内容散在两棵树里，已踩过「改了 A 树、审计了 B 树」的坑；
  harness 工作区那棵 `…\default-workspace\openrevo-win-skin\` 是 2026-10-04 改名前的快照，**已作废，不要再同步**。
