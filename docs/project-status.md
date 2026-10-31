# 已知边界

* **一键安装依赖宿主能力**：宿主开放了 `install_plugin_from_url` 等 IPC 才能一键装；
  否则市场退回「复制命令」的交接路径，不会假装能装（见 [`market.md`](market.md) §2）。
* **`subpath` 是归档内路径**：宿主不剥 codeload 的 `<repo>-<branch>/` 包装层，
  传错就会报 `manifest.json not found in resolved content directory`
  （见 [`reference/host-plugin-ipc.md`](reference/host-plugin-ipc.md) §4）。
* **八种 `plugin_type` 的运行行为未做端到端实测**：`skin` / `background` / `tab` / `widget` / `slot`
  在前端里有注入分支，`service` / `shell` / `driver` 的取值与语义来自官方手册。
  市场对 `plugin_type` 只做分组筛选与配色，不据此推断任何运行期行为，也不承诺八种都装得上。
* **加速下载是可选路径**：加速后的归档根目录与直连一致（已实测），但宿主是否接受
  GitHub 之外的下载域名**未验证** —— 所以加速默认关闭，由用户在安装弹窗里勾选。
* **没有在真实宿主里完整走完一次「一键安装到生效」**：参数与归档目录解析已对齐，
  但「装完插件真的出现在侧边栏」这一步没有真机截图佐证。
* **许可**：仓库目前**没有 `LICENSE` 文件**（尽管目录条目声明 MIT）——如需正式授权请补一份。
