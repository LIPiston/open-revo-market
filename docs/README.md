# 文档

插件市场（`plugin-market`）的开发文档。

## 文件

| 文档 | 内容 |
|---|---|
| [`market.md`](market.md) | 市场完整说明：能力、宿主能力降级、目录机制、构建、本地预览、验收闸、安装卸载 |
| [`host-and-plugins.md`](host-and-plugins.md) | 插件生态实测：五种形态、`tab` 契约与 sandbox、宿主 IPC、下载链路 |
| [`project-status.md`](project-status.md) | 已知边界 |
| [`reference/host-plugin-ipc.md`](reference/host-plugin-ipc.md) | 插件 IPC 逐条清单：签名、能力位、安装器防线 |

## 维护约定

* 代码改完请同步：`README.md`（项目根）与受影响的 `docs/*.md`。
* **市场是唯一主链**：源码只在 `market/src/`，产物 `plugin-market/` 是生成物**别手改**；
  改完跑 `python build_market.py` 再跑 `bash _tools/market-verify.sh cyber`（另跑 `mono`），
  `PASS` 才许交付。目录改动要同步 `market/catalog.json` 与 `crawl_topic.py` 的 `CURATED` 集合。
* 宿主会自我更新：写与 exe 相关的断言前先比 exe 体积与资产文件名
  （**文件名里的哈希就是内容哈希**），字节偏移不能跨版本沿用。
