# 已知边界与命名沿革

## 1. 已知边界

* **一键安装依赖宿主能力**：新宿主开放了 `install_plugin_from_url` 等 IPC，老宿主没有；
  市场按 `get_plugin_host_capabilities` 运行时降级（见 [`market.md`](market.md) §2），不会假装能装。
* **一键安装的参数链已在真机上对齐**：`{ id, url, subpath }` 逐字对上宿主 serde，
  `subpath` 传的是**归档内**路径（`open-revo-market-main/plugin-market`）——
  宿主不会剥 codeload 的 `<repo>-<branch>/` 包装层，这条是踩过一次才查清的
  （[`reference/host-plugin-ipc.md`](reference/host-plugin-ipc.md) §3.1）。弹窗里仍保留「复制命令」的手动路径。
* **真机 CDP 不是工作路径**：宿主 `requireAdministrator`，且 WebView2 启动参数被 wry 覆盖，
  `--remote-debugging-port` 不会打开。真机取证只能走提权置顶抓图 + 像素度量。
* **`widget` / `slot` 未实测**：形态枚举来自前端字面量，宿主里的实际行为没做过端到端验证。
* **本机模型无图片输入**：一切观感判读只能靠直方图、列行亮度、分块 MAE 与 ASCII 渲染。
* **没有在真实宿主里完整走完一次「一键安装到生效」**：参数与归档目录解析已对齐，
  但「装完插件真的出现在侧边栏」这一步没有真机截图佐证。
* **许可**：`market/catalog.json` 的条目声明 `MIT`，但仓库目前**没有 `LICENSE` 文件**——
  如需正式授权，请补一份。

## 2. 命名沿革

| 时间 | 事件 |
|---|---|
| 2026-10-17 | 仓库 `openrevo-plugins` → `open-revo-market`，主交付物收敛为插件市场 |
| 2026-10-17 | 四套皮肤产物目录删除（工具链保留） |
| 2026-10-18 | 市场改为按宿主能力探测，支持一键安装 / 卸载 |
| 2026-10-18 | 皮肤与背景整链移除；目录收敛为 1 条（`plugin-market`） |
| 2026-10-21 | 文档重构：README 精简，细节拆到 `docs/`；非市场内容（宿主取证、抓图工具、开发记录）移出仓库另行存档 |
