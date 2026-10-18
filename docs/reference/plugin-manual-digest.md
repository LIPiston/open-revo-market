# 官方开发手册 · 全文消化（v1.0 / 783 行 → 本页）

> **皮肤/背景链已于 2026-10-18 从本仓库移除**（用户口径）。本页提到的 `skin-authoring.md` / `background-plugin.md` / `preview-and-audit.md` / `real-machine-verification.md`、`build_skins.py`、`src/base.css`、`preview*.html`、`verify.sh` / `audit.sh` 等**都已不在仓库里**，完整存档在桌面 `OpenRevo 皮肤技能存档\`（导出自提交 `7d5b5da`）。
>
> 本页保留的价值是**实测结论本身**（宿主真值、手册与发行版的出入），这些结论对写任何插件形态都有效；只是**照着跑命令会找不到文件**。

> **原文存档**：`docs\OpenRevo_第三方插件开发手册.md`（官方 v1.0，自称「开发者圣经」）。本页是**消化件**：
> 把 9 节 + 7 个用例压成可检索的事实，并逐条标注「与发行版不符」的地方（§10）。
> **凡与发行版冲突，一律以发行版实测为准**（`host-truth-extraction.md` 是取证方法，`skin-authoring.md` 是皮肤落地）。
>
> 只做皮肤 → 读 §8 + §10 + §9；要做 widget / tab / service / shell → 从 §4（清单）和 §5（IPC）入手。
> 原文本身**不必再通读**；需要引用原文时按本页的小节号回查。
>
> ⚠️ **本页的发行版对照基线是 0.8.8**；当前宿主为 **0.9.1**。形态枚举、热重载时机等条目的最新实测见
> `market-host-constraints.md`（0.9.1）与 `SKILL.md` §1 —— 与本页冲突时以那两处为准。

## 0. 一句话定位

OpenRevo = **笔记本硬件微内核平台**：Rust Core（Ring0 ACPI、同方/宝龙达 EC 钥匙库 Vault、NVAPI、ITE 键盘流光、BLE 水冷魔盒、底层键盘钩子）+ Tauri 2 跨窗口 IPC + HAL 语义化能力网关。官方 React 主控台只是**默认客户端**，一切皆插件。

## 1. 架构与总线（原文 §1）

四层，自下而上：

| 层 | 内容 |
|---|---|
| 展现层 | 官方控制台 / 第三方桌宠 / AI 语音助手 / 极客自建客户端（Vue、Svelte、SolidJS、原生 HTML5、纯 Python 皆可） |
| 总线 | Tauri 2 跨窗口事件与 IPC |
| HAL Capability Broker | 语义化能力网关：权限防呆 → 边界钳位 → 阻断裸 EC 寄存器 → 自动析构 |
| Hardware Vault | 原生内核驱动：Tongfang ACPI IOCTL、ITE Lighting HID、WinRT Bluetooth |

原文列出的总线三件套：

* `hardware-state-updated` —— 按需自适应毫秒级遥测流（订阅制，见 §6）
* `fan-boost-changed` / `physical-mode-switched` —— 硬件状态广播
* `invoke('set_fan_boost')` / `invoke('set_power_mode')` —— 控制 API（见 §5）

插件根目录：`%APPDATA%\OpenRevo\plugins\<plugin_id>\`。

## 2. 六种插件形态（原文 §2 全景矩阵）

| `plugin_type` | 典型场景 | 运行载体 | 增量内存 | 视窗特性 |
|---|---|---|---|---|
| **`skin`** | 主题换肤、模块插槽网格重排、自定义窗口尺寸与背景 | **宿主主窗口 Webview**（动态注入 `theme.css` + 挂 `data-skin`） | **0 MB**（纯样式，热装卸） | 按 `manifest.window` 平滑重置主窗口几何，可锁定或自由拉伸 |
| **`tab`** | 显卡调试页、风扇实验室、社区扩展页 | 宿主主窗**沙盒 iframe**（安全隔离） | < 5 MB（复用 Chromium 上下文） | 嵌入顶栏 Sub-Nav 胶囊栏与内容视口 |
| **`widget`** | 桌宠、HUD 状态条、看板娘、大开关 | **独立 Edge WebView2**（物理沙盒隔离） | 15–25 MB | 全透明、无边框、置顶、跳过任务栏、可拖拽 |
| **`service`** | 开机灯效、自动温控曲线、按电量切模式 | **Rust 内置 Rhai 引擎** / 异步后台微任务 | < 100 KB | **完全无界面**（零 GUI，坚决不弹窗） |
| **`shell`** | 彻底替代官方主界面 | **独立全尺寸 Webview** | ~35 MB | 拥有主控权，可取代官方 `main` |
| **`driver`** | 适配新模具 / 新架构 | **原生 Rust 动态库 (.dll)** | 0 运行时 | 直接对接 ACPI/WMI |

> ⚠️ `driver` 只出现在这张矩阵里，**不在 §4 的 `plugin_type` 枚举中**（原文自相矛盾，未验证）。

## 3. 安全军规（原文 §3「Rule 4 硬件防火墙」）

1. **绝对禁止裸物理寄存器交互**：不许 `ec_write(0x1844, 0x01)`、不许 dump EC RAM；微内核只暴露**语义化指令**（如 `set_fan_boost(true)`）。
2. **硬件物理边界防呆**：功耗墙由机型固件钳位（原文例：PL4 必须 ≤ 255W，防 0xFF 单字节溢出变成 45W 慢充）；电池养护限额钳在 **60% ~ 100%**。
3. **非侵入式执行**：主线程严禁耗时同步阻塞；网络请求与大模型调用必须异步流式。

## 4. 插件清单权威规范（原文 §4）

一插件一目录，根目录必须有 `manifest.json`。字段表（原文原样）：

| 字段 | 类型 | 必填 | 适用 | 说明 |
|---|---|---|---|---|
| `id` | string | **必填** | 全类型 | 全局唯一（英文/数字/下划线/中划线） |
| `name` | string | **必填** | 全类型 | 展示名 |
| `version` | string | **必填** | 全类型 | 语义化版本 |
| `plugin_type` | string | **必填** | 全类型 | `"skin"` \| `"tab"` \| `"widget"` \| `"service"` \| `"shell"` |
| `theme_css` | string | **skin 必选** | skin | 样式入口相对路径（`"theme.css"`） |
| `entry` | string | 可选 | widget/tab/service | 入口相对路径（`index.html` / `welcome.rhai`） |
| `window` | object | 可选 | widget/skin/shell | 几何属性（宽高、透明、置顶、可调整） |
| `telemetry` | object | 可选 | 全类型 | 硬件遥测声明（防独显唤醒，见 §6） |
| `permissions` | string[] | 可选 | 全类型 | 未声明会被安全网关拦截 |

实测补充（**权威键是 `plugin_type`**）：`open-revo.exe` 内 Rust 明文字符串含 `plugin_type`（偏移 6887819）与 `load_plugin_theme_css`（6923005），见 `host-truth-extraction.md`。
原文 §7 的多个示例写的是 `"type": "widget"`（第 235、335、404 行），属旧写法 → 本项目 `build_skins.py` **同时发 `plugin_type` 与 `type` 对冲**。

> 原文自身还有两处不一致，别照抄：`window` 子键在 §4 示例里是 `always_on_top`，在用例 1/6 里是 `alwaysOnTop`；
> 用例 3 的 `"target": "lighting.welcome"` 不在字段表里。皮肤只用到 `window.width/height`，其余本项目均未验证。

## 5. 八大硬件 IPC 速查（原文 §5）

入口：`import { invoke } from '@tauri-apps/api/core'`。**调用前必须在 manifest `permissions` 里声明对应权限**（`telemetry:read` / `fan:control` / `power:control` …），否则被安全网关拦。

| # | 指令 | 参数 | 行为 / 广播 |
|---|---|---|---|
| 1 | `set_fan_boost` | `{ enable: boolean }` | 写 EC 强冷标志，风扇 5400+ RPM；托盘加角标；广播 `fan-boost-changed` |
| 2 | `set_power_mode` | `{ mode: 1\|2\|3\|4 }` | 1 办公 / 2 均衡 / 3 狂暴 / 4 自定义；刷新 CPU PL1/PL2/PL4、风扇曲线、动态背光；广播 `physical-mode-switched` |
| 3 | `set_battery_limit` | `{ limit: 60~100 }` | 写 EC 电池寄存器，到点断充（防高压鼓包） |
| 4 | `switch_refresh_rate` | `{ hz: number }` | 常用 60 / 165 / 240；Win32 显示配置，无黑屏瞬切 |
| 5 | `set_gpu_mode` | `{ mode: "discrete"\|"hybrid" }` | 独显直连 / 混合输出 |
| 6 | `apply_four_zone_colors` | `{ zone1..zone4: [r,g,b] }` | ITE 键盘四分区灯控 |
| 7 | `set_water_cooler_speed` | `{ level: number }` | WinRT BLE 外置水冷魔盒（二代） |
| 8 | `set_device_switch` | `{ device: "camera"\|"mic"\|"touchpad"\|"winlock", enabled: boolean }` | 外设软开关（含 Win 键锁定） |

## 6. 遥测总线（原文 §6）

* **铁律：防独显唤醒（Zero dGPU Wake-lock）**。独显办公时处于 D3Cold（0W）；**不需要 GPU 字段就坚决不要在 manifest 里声明 `gpu_*`** —— 若所有运行中插件都没订阅 GPU，微内核绝不调 NVAPI。
* **零功耗深睡**：纯陪伴小人 / 语音助手用 `"telemetry": { "enabled": false }`，遥测线程安详深睡，CPU 维持深 C-State。
* **前端消费**：`listen('hardware-state-updated', e => e.payload)`，payload 是 `HardwareState` 强类型对象（`cpu_temp`、`cpu_fan_rpm` …）。`desiredIntervalMs` 只是期望值。

## 7. 七个实战用例（原文 §7）—— 一句话结论

| 用例 | 形态 | 可复用的要点 |
|---|---|---|
| 1 五十行桌宠 | widget | `pointerdown` + `getCurrentWebviewWindow().startDragging()` 拖窗；**严禁与 `data-tauri-drag-region` 混用**（会冲突）；温度驱动 `--glow` 变色 |
| 2 一键强冷大开关 | widget | `invoke('set_fan_boost')` + `listen('fan-boost-changed')` 跟随托盘/物理键回滚 UI 状态 |
| 3 开机灯效仪式 | service | `entry: "welcome.rhai"`，Rhai 里 `on_startup_ceremony()`、`set_keyboard_rgb`、`sleep`（语法未验证） |
| 4 AI Function Calling | 任意 | 本质是 §5：LLM 返回 tool call → `invoke`，tools schema 里参数与 §5 对齐 |
| 5 自建替代控制台 | shell | `config.json` 配 `wake_window_mode: "mini"` + `autostart: true`，再注册 `plugin_type: "shell"` |
| 6 进阶桌宠工程 | widget | `css/ js/ assets/` 目录树；屏幕右侧 30px 内吸附 → `setSize(48×48)` + `body.docked-bubble`；主题走 CSS 令牌不写死；跨插件 `emit/listen('plugin:eva01:berserk')` |
| 7 **主窗皮肤** | **skin** | 本项目主战场 → 见 §8 |

## 8. 皮肤插件（原文 §7 用例 7）与发行版落地

**三条设计原则**（原文）：

1. **统一目录规范**：严禁另开 `skins\` 文件夹，皮肤一律放 `plugins\<skin_id>\`，在插件管理页享受统一启闭/版本/元数据治理。
2. **物理级 0 内存开销**：不建独立 Webview，只把 `theme.css` 文本注入宿主主窗口的 `<style id="openrevo-custom-skin">`，0ms 热装卸。
   → **0.8.8 起注入点改名为 `<style id="openrevo-theme-skin">`**（启动时仍兼容读旧 id：`document.getElementById("openrevo-theme-skin")||document.getElementById("openrevo-custom-skin")`，读到旧 id 会**就地改名为新 id**）；同时**新增**背景壁纸通道 `<style id="openrevo-custom-background">`（见 `plugin-dev-0.8.8-skill.md` §1）。
3. **互斥安全激活**：同时只允许一个第三方皮肤；激活新的自动卸载旧的，停用即刻无缝回退默认主题与 960×740 视窗基准。

**目录与清单**：`manifest.json` + `theme.css`（+ `assets\`）；清单用 `plugin_type: "skin"`、`theme_css: "theme.css"`、`window.{width,height,resizable}`。

**样式**：宿主根容器挂 `data-skin="<skin_id>"`，所有选择器必须以 `[data-skin="<skin_id>"]` 为根命名空间；覆写 Design Tokens + 用 CSS Grid 重排插槽。

**原文承诺的调试流程**：拷进插件目录 → 打开【插件】页 → 点【刷新】→ 拨开关 → CSS 热注入 + 视窗尺寸平滑拉伸到 `window` 声明值并居中。

> 发行版实际行为有几处不同（令牌名、示例类名、热加载口径）—— 见 §10 与 `skin-authoring.md`。
> **0.8.8 更新**：原文承诺的「拷进目录 → 点【刷新】→ 拨开关」流程**成立**，且比原文更省事 ——
> **`v0.8.8-dbfe615` 起点一次【刷新】即可**：按钮 handler 收一个「是否热重载」参数（逐字
> `onClick:()=>j(!0)`、title `"刷新已安装插件列表并热重载当前样式"`），重扫列表后会拿当前
> `activeSkin` / `activeBackground` 重跑注入回调 ⇒ 重新 `load_plugin_theme_css` /
> `load_plugin_background_css` 并刷新 `<style>.textContent`。CSS 同样改为按需注入（`useCallback` 内）。
> **早于该构建**（含 0.8.7、`v0.8.8-bf72755`）的【刷新】只重扫插件列表、不重注入，那时才需要
> 「拨开关」或重启。见 `plugin-dev-0.8.8-skill.md` §4 与 §9。

## 9. Design Tokens 与安全模式（原文 §8 / §9）

* 原文令牌（`--surface-card`、`--border-medium`、`--status-ok`、`--status-info`、`--color-beast`、`--radius-md`(8px)、`--radius-lg`(12px)）—— **⚠️ 原判「发行版没有这一套」是错的，已按 0.8.8 实测反转**：这些令牌在 0.8.7 与 0.8.8 的宿主 `:root` 里**全部存在**且取值一致（`--surface-card` 7/8 次、`--border-medium` 15/16、`--status-ok` 2/2、`--status-info` 6/6、`--color-beast` 1/1、`--radius-md` 11/12、`--radius-lg` 6/7），即**它们就是宿主真值**。真正不存在的是 `--core-*`（0/0）与 `--mica-*`（0/0）。
  → 完整令牌面见 `host-truth-extraction.md` §5 与 `plugin-dev-0.8.8-skill.md` §5.2。**`--wf-*` 不是宿主令牌**（old-css / new-css / new-js / exe 全 0），它是本工具链的**私有前缀**（`build_skins.py:352` 把色写进宿主 `--theme-<key>{,-border,-dim,-glow}` 后镜像成 `--wf-hue-<key>*`）；本项目在其上加**二色纪律**：只有 `--wf-accent` + `--wf-important`（`skin-authoring.md` §3.1）—— 这条约束是**我们自己的**，不是对宿主令牌名的主张。
* **Safe Mode 二分法**：插件把宿主搞崩时**不要重装**。编辑 `%APPDATA%\OpenRevo\config.json` 的 `custom_plugin_toggles`，把嫌疑插件 ID 置 `false`，重启即跳过。
  本机实测该键真实存在（2026-10-04：`{"eva01-core": false}`）。

## 10. 手册 ≠ 发行版（逐条实测对照）

| # | 手册说法（原文位置） | 发行版实测 | 证据 |
|---|---|---|---|
| 1 | 皮肤 CSS 用 `.overview-main-grid` / `.sensor-gauge-cluster` / `.cooling-fan-card` / `.power-mode-selector` 重排插槽（§7） | **这些类名在发行版里根本不存在**（WebView2 V8 代码缓存逐字检索命中 0），只能写前向兼容层 | `host-truth-extraction.md` §2、`devlog.md` §1 |
| 2 | 复用 `--core-accent` / `--surface-*` / `--status-*` / `--radius-md` 等令牌（§7 §8） | **⚠️ 已反转**：`--surface-*` / `--status-*` / `--radius-*` / `--text-*` / `--color-*` **就是宿主真值**（0.8.7/0.8.8 两份 `:root` 都在），只有 `--core-*` 与 `--mica-*` 全不存在；`--wf-*` 是**本工具链私有前缀**、不是宿主令牌 | `plugin-dev-0.8.8-skill.md` §5.2、`host-truth-extraction.md` §5；计数：`--surface-card` 7/8、`--status-ok` 2/2、`--core-` 0/0、`--wf-` 0/0 |
| 3 | 各示例写 `"type": "widget"`（§7 用例 1/3/5） | 权威键是 **`plugin_type`**（`"type"` 带引号在 exe **0 命中**）；新 Skill §3 称二者「完全等价（Rust 配了 alias）」**未证实** → 本项目继续**双发对冲** | exe manifest 字段表 @6949111 只有 `plugin_type`；`plugin-dev-0.8.8-skill.md` §6 |
| 4 | 插件页点【刷新】拨开关即热加载（§7 步骤 5） | ✅ **成立**（`v0.8.8-dbfe615` 起，比原文更省事）：【刷新】= 重扫列表 **+ 热重载当前样式**（重放 `onApplySkin`/`onApplyBackground` → 重新 `load_plugin_*_css` 并刷新 `<style>.textContent`），**点一次刷新即可，不必拨开关、不必重启**。CSS 也是按需注入（`useCallback` 内）。⚠️ 旧构建 `v0.8.8-bf72755` 及 0.8.7 的【刷新】**只重扫列表**，那时才需要「刷新 + 拨开关」 | `plugin-dev-0.8.8-skill.md` §4、§9.4 |
| 5 | `data-skin` 挂「宿主根容器」（§7） | **0.8.7**：只挂容器（主控台主容器 / 迷你面板根），`body` 上**没有** → 需要 `body:has([data-skin=…])` 兜底手臂才覆盖得到 body 级浮层；**0.8.8**：**同时**挂到 `document.documentElement`（`C?P.setAttribute("data-skin",C):P.removeAttribute("data-skin")`），本仓库皮肤的 `html[data-skin]` / `body[data-skin]` 手臂正好命中 | `host-truth-extraction.md` §4、`plugin-dev-0.8.8-skill.md` §5.3、`SKILL.md` 硬约束 3 |
| 6 | 切皮肤时宿主自动按 `window` 平滑改主窗几何并居中（§7） | 主窗几何由宿主自己管（含被停车到 `(-32000,-32000)` 收成 237×39 的状态），皮肤侧只声明 `window.width/height` | `real-machine-verification.md` §3/§5 |
| 7 | `custom_plugin_toggles` 改 `false` 即跳过插件（§9） | ✅ 成立（本机实测该键存在） | `config.json` 实读 |

## 11. 相关文件

```
docs\
├── OpenRevo_第三方插件开发手册.md          # 官方原文 v1.0（存档，不必通读）
└── reference\
    ├── plugin-manual-digest.md             # 本页：原文消化 + 手册≠发行版
    ├── host-truth-extraction.md            # 怎么从 exe 抽真值 + 真实 DOM/令牌/对手规则
    ├── skin-authoring.md                   # 皮肤落地：manifest、令牌架构、特异性阶梯、双面板配方
    ├── preview-and-audit.md                # 预览台 + 无头审计
    ├── real-machine-verification.md        # 真机取证与实测基线
    ├── environment-and-tools.md            # 环境硬事实 + 脚本地图 + 证据索引 + 回退
    └── pitfalls.md                         # 踩坑总表（现象 → 原因 → 对策）
```
