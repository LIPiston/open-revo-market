# OpenRevo 插件开发 · 文档与技能包

这个目录同时承担两件事：

1. **开发记录**：`devlog.md` 记录每一轮从读手册到真机取证的完整时间线、每一步的数字证据与未决项。
2. **可复用技能**：`SKILL.md` + `reference\*.md` 是一份按 Agent Skills 规范组织的技能包
   （YAML frontmatter 的 `name` / `description`，主文件 + 分层参考文件），供下次开发或修改插件时直接加载。

当前技能覆盖**两条链**：**插件市场**（`plugin-market`，`tab` 形态，本仓库主交付物）
与**皮肤工具链**（四套 WinUI 皮肤 + 背景插件；皮肤产物已删，工具链保留）。

## 文件

```
docs\
├── README.md                            # 本文件
├── SKILL.md                             # 技能入口：状态 + 硬约束 + 工作流 + 验收清单 + 参考地图
├── devlog.md                            # 开发记录（时间线 + 证据 + 未决项）
├── OpenRevo_第三方插件开发手册.md         # 官方手册 v1.0 存档（存档 ≠ 行为准则）
└── reference\
    ├── market-host-constraints.md        # 插件市场为什么长这样：0.9.1 的 tab 契约 / 缺哪些接口
    ├── plugin-dev-0.8.8-skill.md         # 官方新版 Skill（0.8.8）逐条实测对照 + 背景壁纸通道
    ├── plugin-manual-digest.md           # 手册消化件 + 「手册 ≠ 发行版」对照表
    ├── host-truth-extraction.md          # 从 exe 抽宿主 CSS/JS；宿主 DOM/令牌/!important 对手规则
    ├── skin-authoring.md                 # manifest/目录、令牌与镜像架构、特异性阶梯、双面板配方
    ├── background-plugin.md              # 自定义背景图独立插件：data URI、遮罩同层、background 通道
    ├── preview-and-audit.md              # 预览页能力与 URL 参数、无头 Chrome 命令、像素判据
    ├── real-machine-verification.md      # 提权重启/唤醒/置顶抓图/度量与实测基线
    ├── environment-and-tools.md          # 环境硬事实 + 工具地图 + 证据索引 + 回退清单
    └── pitfalls.md                       # 踩坑总表：现象 → 原因 → 对策
```

> **取证基线是宿主 0.9.1**（exe 9,368,576 B）。`plugin-dev-0.8.8-skill.md` 与 `plugin-manual-digest.md`
> 的对照基线是 **0.8.8**，只作历史对照；**凡与 0.9.1 冲突的，以 `market-host-constraints.md` 与
> `_extracted/v091/` 的实测为准**。宿主会自我更新 —— 写断言前先比 exe 体积与资产文件名
> （**文件名里的哈希就是内容哈希**）。

> **仓库外的原文**：开发者新版 skill 在 `D:\LIPis\desktop\openrevo-plugin-dev\SKILL.md`（415 行）。
> 它**不在本仓库内**，所以 `reference\plugin-dev-0.8.8-skill.md` 是它的**唯一耐久存档**；
> 原文若变动，以本页记录的实测判定为准重新核对。

## 怎么用

* **人**：先读 `SKILL.md` 的「硬约束」与「现状快照」，再按「工作流」走；卡住时查 `pitfalls.md`。
* **Agent**：把整个 `docs\` 当作技能目录（目录名 `openrevo-skin-plugin\`），加载 `SKILL.md` 作为入口；
  只有需要细节时才读 `reference\` 下的文件，避免一次性灌入全部内容。

## 维护约定

* 要接手/交接这摊事（环境、工具在哪、证据在哪、怎么退回用户原状、哪些明确没做）→ 直接看
  `reference\environment-and-tools.md`。原先那两份一次性接手文档（`HANDOVER.md` / `HANDOFF.md`）已于
  2026-10-04 删除，耐久内容全部并入该页；原件保留在 git 提交 `c1e2e03` 里，随时可取回。
* 宿主升级后，`reference\host-truth-extraction.md` 里的**字节偏移、规则条数**会失效，必须重新定位；
  `real-machine-verification.md` 里的几何/直方图/MAE 是**该版本的基线**，仅用于回归对比。
  当前 `_extracted/v091/` 对应宿主 **0.9.1**。
* 代码改完请同步这三处：`README.md`（项目根）、`docs\devlog.md`（这一轮新增了什么）、
  以及受影响的 `docs\reference\*.md`。
* **配色是硬约束**：整份 UI 只有 `--wf-accent`（系统主题色）+ `--wf-important`（重要强调色）两个装饰色
  （用户口径 m00001 / m00053）。⚠️ `--wf-*` 是**本工具链自己的前缀**（`build_skins.py` 的 `token_block()`
  把配色写进宿主 `--theme-<key>{,-border,-dim,-glow}` 槽位后镜像而来），**不是宿主令牌** —— 宿主真值是
  `--surface-*` / `--border-*` / `--text-*` / `--status-*` / `--radius-*`（见 `reference\plugin-dev-0.8.8-skill.md` §5.2）。
  加新部件时先读 `SKILL.md` 的「配色纪律」一节；
  改完必须跑 `bash _tools\verify.sh`（验收总闸，132 条断言，`exit 1` 就是没改完）；它内含 `audit.sh`
  的 `dom.hueFamilies = 2` 与 `census.py` 的色族数 = 2，并额外核对正向条件 —— **只看族数 = 2 会骗人**：
  坏读数里全是宿主原色时，族数也恰好是 2（`pitfalls.md` #35 / #39）。动过预览页或皮肤 CSS 后，另跑
  `PAGES=preview-mini.html:mini bash _tools/_stress.sh 48 8`，须报「异常 0 次」。
  ⚠️ **`verify.sh` / `audit.sh` 依赖 `<id>/theme.css`**，而四套皮肤产物已删（见 `SKILL.md` §0.1）——
  要跑验收先 `python build_skins.py`，否则审计会报 `rules_applied = none`。
* **背景插件是独立的一条链**：真值在 `bg.config.json`，模板在 `src\background.css`，改完跑
  `python build_background.py build`（重新编码图片）再跑 `bash _tools\verify-bg.sh` —— 它第一条就是
  「既有 132 条无回归」，所以背景链不会绕过皮肤验收。产物 `bg-custom\`（默认）与 `<id>-bg\`（显式
  `--targets` 才有）**入库即装即用**；`assets\sample-wallpaper.jpg` 是确定性源图，保证任何 clone 都能
  构建出同一份产物。宿主 0.8.8 起有 `plugin_type:"background"` 的独立通道
  （`active_background` → `<style id="openrevo-custom-background">`），与皮肤槽位正交可共存 —— 详见
  `reference\background-plugin.md` 与 `reference\plugin-dev-0.8.8-skill.md` §1。
  **按用户口径 m00785，这部分功能「先不做」**：代码与验收都在，但**刻意不装进宿主、不激活**
  （宿主侧零改动，`active_background` 为 `null`）。本仓库产物仍是 `plugin_type:"skin"` 形态，
  改造清单见 `reference\plugin-dev-0.8.8-skill.md` §7 第 8 项。
* **插件市场是另一条链**：源码只在 `market\src\`，构建产物 `plugin-market\` 是生成物**别手改**；
  改完跑 `python build_market.py` 再跑 `bash _tools\market-verify.sh cyber`（另跑 `mono`），
  `PASS` 才许交付。目录改动要同步 `market\catalog.json` 与 `crawl_topic.py` 的 `CURATED` 集合。
* **本目录只在权威树里维护**（仓库 `LIPiston/open-revo-market`，2026-10-17 由 `open-revo-plugins` 更名；
  本机克隆目录名可能仍是旧的 `openrevo-plugins\`）。
  历史上同一份内容散在两棵树里，已踩过「改了 A 树、审计了 B 树」的坑；
  harness 工作区那棵 `…\default-workspace\openrevo-win-skin\` 是 2026-10-04 改名前的快照，**已作废，不要再同步**。
