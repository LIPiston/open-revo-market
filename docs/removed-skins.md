# 已移除：皮肤与背景（2026-10-18）

按用户口径整体移除，**不再维护**。本页留档，避免后来者按旧文档继续做。

| 移除项 | 说明 |
|---|---|
| 四套皮肤 `skin-win1{0,1}-{light,dark}` | 产物已于 2026-10-17 删除，本轮连同生成器一起移除 |
| `build_skins.py` / `src/base.css` | 皮肤生成器与结构层 |
| `bg-custom` 及其构建链 | `build_background.py` / `bg_common.py` / `src/background.css` / `bg.config.json` |
| `preview.html` / `preview-mini.html` | 皮肤预览页 |
| `_tools/verify.sh` / `audit.sh` / `_stress.sh` / `shots.sh` / `shoot1.sh` / `verify-bg.sh` / `set-active-skin.ps1` | 皮肤与背景的验收 / 出图 / 切皮脚本 |
| `docs/reference/{skin-authoring,background-plugin,preview-and-audit,real-machine-verification}.md` | 对应文档 |

历史实现都在 git 历史里：`git log --oneline -- build_skins.py` 可取回。

**背景插件后续会重做** —— 重做时不要再依赖 `build_skins`（那条 import 依赖正是上一轮工具链
被迫保留的原因），直接用宿主的 `plugin_type:"background"` 通道
（`active_background` → `<style id="openrevo-custom-background">`）。

> 相关遗留：讲皮肤链的踩坑条目（`pitfalls.md` #5/#6/#12/#21~#26/#33~#35/#39 等）已随
> 开发文档一起移出仓库存档，保留只为「不重犯同样的判断错误」和外部文档的编号引用。
