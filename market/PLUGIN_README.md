# 插件市场（plugin-market）

OpenRevo 主控台里的一个 `tab` 页签：浏览第三方插件、看能力披露、拿到最短安装路径。

## 它做什么

- **浏览目录**：拉取策展目录 `market/catalog.json`，按类型分组（已审核 / 未审核），支持搜索与筛选。
- **实时发现**：直接查 GitHub 上带 `openrevo-plugin` topic 的仓库 —— 作者打上 topic 后无需等待爬虫就能被发现。
- **识别已安装**：通过宿主的 `get_custom_plugins` 只读命令，给已安装的插件打标签。
- **能力披露**：列出静态扫描查到的联网 / 文件读写等能力，并把危险组合单列（如"读凭据 + 有网络"）。
- **给安装命令**：生成一条 PowerShell 命令，把仓库（或其中的子目录）放到插件目录。

## 它不做什么（重要）

**本版宿主（v0.9.1）没有任何安装接口。** 实测确认：

- Rust 命令表里没有 `install_plugin` / `uninstall_plugin` / `reload_plugin`，也没有写插件目录的 IPC；
- 没挂 Tauri 的 `fs` / `dialog` / `shell` 插件，所以不存在"写到磁盘"的通道；
- `tab` 插件的 iframe 是 `sandbox="allow-scripts allow-forms allow-same-origin"`，**没有** `allow-downloads`，
  下载动作会被浏览器拦掉。

所以市场**不能**替你下载安装，只能给你一条最短的手工路径（复制命令 → 终端粘贴 → 回插件页刷新）。
UI 上刻意不承诺做不到的事。

## 安装这个市场本身

```powershell
$d = "$env:APPDATA\OpenRevo\plugins\plugin-market"
New-Item -ItemType Directory -Force -Path $d | Out-Null
Copy-Item -Recurse -Force .\plugin-market\* $d
```

或者在本仓库根目录直接：

```bash
python build_market.py --install
```

装完在宿主侧边栏进 **插件** 页，点右上角 **刷新**，顶栏会出现「插件市场」页签。

## 收录新插件

给你自己的插件仓库打上 `openrevo-plugin` topic，它就会被收录（快车道，标注"未审核"）。
想进"已审核"分区，往 `market/catalog.json` 提一个 PR。

## 卸载

删掉 `%APPDATA%\OpenRevo\plugins\plugin-market` 整个文件夹，回插件页刷新。
