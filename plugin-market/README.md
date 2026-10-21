# 插件市场（plugin-market）

OpenRevo 主控台里的一个 `tab` 页签：浏览第三方插件、看能力披露、安装与卸载。

## 它做什么

- **浏览目录**：拉取策展目录 `market/catalog.json`，按类型分组（已审核 / 未审核），支持搜索与筛选；
  列表可滚动，超过一页自动分页（每页 12 条）。
- **实时发现**：直接查 GitHub 上带 `openrevo-plugin` topic 的仓库 —— 作者打上 topic 后无需等待爬虫就能被发现。
- **识别已安装**：通过宿主的 `get_custom_plugins` 只读命令，给已安装的插件打标签。
- **能力披露**：列出静态扫描查到的联网 / 文件读写等能力，并把危险组合单列（如"读凭据 + 有网络"）。
- **安装 / 卸载**：宿主提供接口时一键完成；不提供时给出可粘贴的命令。

## 安装方式由宿主能力决定（运行时探测）

市场启动时调用 `get_plugin_host_capabilities`，按返回的能力位决定 UI，**不看版本号**：

| 能力位 | 为 true 时市场会 | 为 false / 命令不存在时 |
|---|---|---|
| `can_install` | 点【安装】直接调 `install_plugin_from_url` | 弹窗给出可粘贴的 PowerShell 命令 |
| `can_uninstall` | 卡片上出现【卸载】，移入回收站 | 隐藏【卸载】按钮 |
| `can_reload` | 装完调 `reload_plugins` 自动重扫 | 退回 `get_custom_plugins` 只读枚举 |
| `can_read_manifest` | 读已装版本，标出「可更新」 | 不显示更新提示 |
| `can_open_url` | 【打开源码】交给系统浏览器 | 降级为复制链接 |
| `can_write_clipboard` | 复制走宿主 | 退回 `navigator.clipboard` / `execCommand` |

**宿主没有这个命令时不会报错**，市场整体降级到「浏览 + 复制命令」模式。
这一点是硬要求：能力判断必须是探测出来的，不能写死在文案里。

## 一键安装做了什么、没做什么

安装时市场只发一条 IPC：

```js
invoke('install_plugin_from_url', { id, url: 'https://codeload.github.com/<repo>/zip/refs/heads/<branch>', subpath? })
```

`id` 与 `url` 都是**宿主 serde 的必需字段**，缺一个就是
`missing required key <name>`；`id` 同时决定安装后的目录名。`subpath` / `sha256` 可选。

**宿主**负责下载、校验、解压、落盘，具体防线都在宿主侧：

- 拒绝非 `https://` 的 URL；
- 可选 `sha256` 完整性校验（目录条目提供时才会带上）；
- 解压后断言路径边界，防 Zip Slip；
- 目标目录必须落在 OpenRevo 的 AppData 边界内；
- 装完自动重扫插件目录。

**市场不做的**：不自己下载、不写盘、不执行解压 —— `tab` 的 iframe 没有 `allow-downloads`，
`window.open` 也被拦（没有 `allow-popups`），这些能力本来就不在插件手里。

> 目录条目里如果不带 `sha256`，宿主只能校验传输完整性，**证明不了内容没被篡改**。
> 想升级为可验证安装，请给 `catalog.json` 的条目补上 `sha256` 字段。

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

宿主支持 `can_uninstall` 时，直接在卡片上点【卸载】（会移入回收站）。
否则删掉 `%APPDATA%\OpenRevo\plugins\plugin-market` 整个文件夹，回插件页刷新。
