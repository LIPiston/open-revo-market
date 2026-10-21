# 文档

插件市场（`plugin-market`）的开发文档。皮肤与背景插件链已于 2026-10-18 整体移除，
见 [`removed-skins.md`](removed-skins.md)。

## 文件

| 文档 | 内容 |
|---|---|
| [`market.md`](market.md) | 市场完整说明：能力、宿主能力降级、目录机制、构建、本地预览、验收闸、安装卸载 |
| [`host-and-plugins.md`](host-and-plugins.md) | 插件生态实测：五种形态、三套 sandbox、两代宿主 IPC |
| [`project-status.md`](project-status.md) | 已知边界 + 命名沿革 |
| [`removed-skins.md`](removed-skins.md) | 已移除的皮肤 / 背景链留档 |
| [`reference/host-plugin-ipc.md`](reference/host-plugin-ipc.md) | **新宿主**的插件 IPC：签名、能力位、安装器防线（9,437,696 B 实测） |
| [`reference/market-host-constraints.md`](reference/market-host-constraints.md) | **老宿主**的 tab 契约：为什么市场选 `tab`、当时缺哪些接口 |

## 取证基线有两代，判断前先比 exe 体积

* **老宿主** 9,368,576 B —— `reference/market-host-constraints.md`
* **当前宿主** 9,437,696 B —— `reference/host-plugin-ipc.md`（新增安装 / 卸载 / 能力位整族 IPC）

两代的 `ProductVersion` **都报 0.9.1**，所以能力判断只能运行时探测，不能看版本号。
宿主会自我更新 —— 写断言前先比 exe 体积与 mtime，并用资产文件名里的内容哈希
（`index-<hash>.js`，文件名里的哈希就是内容哈希）判断前端有没有变。

## 维护约定

* 代码改完请同步：`README.md`（项目根）与受影响的 `docs/*.md`。
* **市场是唯一主链**：源码只在 `market/src/`，产物 `plugin-market/` 是生成物**别手改**；
  改完跑 `python build_market.py` 再跑 `bash _tools/market-verify.sh cyber`（另跑 `mono`），
  `PASS` 才许交付。目录改动要同步 `market/catalog.json` 与 `crawl_topic.py` 的 `CURATED` 集合。
* **只在权威树里维护**（仓库 `LIPiston/open-revo-market`，2026-10-17 由 `openrevo-plugins` 更名；
  本机克隆目录名可能仍是旧的）。
