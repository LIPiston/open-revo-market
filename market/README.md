# 插件市场（OpenRevo 第三方插件市场）

OpenRevo 主控台里的一个 `tab` 页签：**浏览**第三方插件、看**能力披露**、拿到**最短安装路径**。
收录入口是 GitHub topic —— 作者给自己的插件仓库打上 `openrevo-plugin`，它就会自动出现在市场里。

```
别人打 topic ──► 爬虫（每小时/可手动）──► market/catalog.json ──► 市场页签
                     ↑                                              │
              你也可以点「实时发现」直接查 GitHub，不等爬虫 ◄──────────┘
```

---

## 一分钟上手

```bash
# 1. 构建 + 安装到 %APPDATA%\OpenRevo\plugins\plugin-market\
python build_market.py --install

# 2. 打开 OpenRevo → 侧边栏【插件】页 → 右上角【刷新】
#    顶栏会出现「插件市场」页签，点进去即可
```

产物是**单文件** `plugin-market/index.html`（CSS/JS 全内联）。
这不是偷懒：宿主用 `srcDoc` 把插件 HTML 注入 iframe，基准 URL 是 `tauri://localhost`，
相对路径的 `<link>` / `<script src>` 必然 404，所以必须单文件。

---

## 这个市场能做什么、不能做什么

**能**：

- 拉取策展目录，按类型分组（**已审核** / **未审核**）并提供搜索、筛选、排序；
- **实时发现**：直接查 GitHub 上带 `openrevo-plugin` topic 的仓库，作者打完 topic 立刻可见，不必等爬虫；
- 通过宿主的 `get_custom_plugins`（只读）**认出已安装**的插件并打标；
- **能力披露**：逐条列出静态扫描检出的联网 / 文件读写等能力，危险组合单列（如"读凭据 + 有网络"）；
- **一键安装 / 卸载**：宿主开放了对应 IPC 时，点一下就装完，装完自动重扫；
- 宿主没开放时，退回一条**可直接粘贴的 PowerShell 命令**，把仓库（或其中某个子目录）放到插件目录。

**安装方式由宿主能力决定，不是写死的**。市场启动时调 `get_plugin_host_capabilities`，
按返回的能力位（`can_install` / `can_uninstall` / `can_reload` / `can_read_manifest` /
`can_open_url` / `can_write_clipboard`）决定显示哪些按钮。能力位为假或该命令不存在时，
市场整体降级到「浏览 + 复制命令」模式，**不报错、不假装能装**。

一键安装时市场只发一条 IPC，下载 / 校验 / 解压 / 落盘全在宿主侧：

```js
invoke('install_plugin_from_url', { id, url, subpath, sha256? })   // id 与 url 都必需
```

**`subpath` 是归档内路径，不是仓库内路径。** GitHub codeload 的 zip 解压后固定多一层
`<repo>-<branch>/`，宿主把 `subpath` 直接拼在 `extracted/` 后面且**不会剥这层**，
所以市场传的是 `open-revo-market-main/plugin-market`；插件在仓库根时传
`open-revo-market-main` 本身。构造逻辑在 `archiveSubpath()`，
详见 [`../docs/reference/host-plugin-ipc.md`](../docs/reference/host-plugin-ipc.md) §3.1。

宿主自己负责：拒绝非 HTTPS、可选 `sha256` 校验、解压防 Zip Slip、目标必须落在 AppData 边界内。
**市场不自己下载、不写盘** —— `tab` 的 iframe 既没有 `allow-downloads` 也没有 `allow-popups`，
这类动作本来就不在插件手里。

> ⚠️ 目录条目没带 `sha256` 时，宿主只能校验传输完整性，**证明不了内容没被篡改**。
> 想升级为可验证安装，请给 `catalog.json` 条目补上 `sha256`。
>
> ⚠️ 一键安装走的是 GitHub 的源码归档（`codeload.github.com/<repo>/zip/refs/heads/<branch>`），
> 归档根名规则（`<repo>-<branch>`，分支里的 `/` 换成 `-`）由 `archiveSubpath()` 复刻。
> 若某天接入非 GitHub 的归档源，这条规则要重新确认。弹窗里始终保留「复制命令」的手动备用路径。

取证细节（含命令注册表与安装器的错误串）见 [`../docs/reference/host-plugin-ipc.md`](../docs/reference/host-plugin-ipc.md)；
`tab` 形态的沙盒能力边界见 [`../docs/host-and-plugins.md`](../docs/host-and-plugins.md)。

---

## 给自己的插件上架

**快车道（零审核，自动收录）**：给你的插件仓库打上 topic `openrevo-plugin`。

```bash
gh repo edit --add-topic openrevo-plugin
```

大约一小时后（或本地立刻用市场的【实时发现】按钮）就能看到它。快车道条目在 UI 上**显著标注"未审核"**。

**正典（进"已审核"分区）**：往 `market/catalog.json` 提一个 PR，
把 `unreviewed` 改成 `false`。爬虫合并时会**保留**这个标记，不会把它翻回未审核。

作者需要知道的约定：

| 项 | 约定 |
|---|---|
| 插件目录 | 仓库根目录放 `manifest.json`，**或**某个子目录里放（monorepo 会扫一层，自动识别） |
| 必填 | `manifest.json` 的 `id` / `name` / `version` / `plugin_type`。`id` 就是安装后的目录名 |
| `plugin_type` | `skin` / `background` / `tab` / `widget` / `slot`（v0.9.1 实测枚举） |
| 描述 | 写清**做什么**；不要把内容写成"最好的插件"这种无法核对的话 |
| 能力 | 由工具侧扫描填写，作者手写无效 |

---

## 仓库结构

```
market/
├── src/
│   ├── index.template.html   # 模板（含两个占位符）
│   ├── market.css            # 样式（内联进产物）
│   └── market.js             # 应用逻辑（内联进产物）
├── crawl_topic.py            # 抓 openrevo-plugin topic → catalog.json
├── validate_catalog.py       # 目录校验（E1–E11）
├── catalog.json              # 生成的目录（CI 每小时刷新）
└── PLUGIN_README.md          # 会随插件一起装进插件目录

build_market.py               # 把 src/ 内联成单文件，并做产物自检
plugin-market/                # 构建产物（可直接拷进插件目录）
_tools/
├── market-preview.html       # 等价宿主环境预览（复刻 srcdoc + sandbox + 桥）
├── market-verify.sh          # 验收闸：JS 错误 / 渲染计数 / 安装弹窗
└── market-shots.sh           # 出图（干净版 + 弹窗）
```

## 开发

```bash
python build_market.py             # 构建 + 产物自检
python build_market.py --check     # 只自检

# 出图看观感（会起一个本地 HTTP 服务）
bash _tools/market-shots.sh        # → _shots/market-clean-{cyber,mono}.png、market-modal-cyber.png

# 验收闸（PASS 才许交付）
bash _tools/market-verify.sh cyber

# 目录
python market/crawl_topic.py --merge    # 需要 GITHUB_TOKEN
python market/validate_catalog.py
```

改完样式或逻辑，**只改 `market/src/`**，`plugin-market/` 是生成物，别手改。

---

## 免责声明

> 插件是第三方代码，**以你的权限运行**。本市场只做来源绑定与静态披露，**不构成安全审计**。
> 安装即把代码写入插件目录，卸载即删除对应文件夹 —— 请只安装你信任的来源。

`tab` 插件与宿主**同源**（`allow-same-origin`），意味着插件能读到宿主页面的 DOM 并调用宿主的 IPC。
这不代表沙盒无用，但**不要**把"跑在 iframe 里"当成安全边界。市场在 UI 上刻意不写"安全隔离"这类措辞。
