#!/usr/bin/env python3
"""构建 OpenRevo 插件市场插件。

把 market/src/ 下的三个源文件组装成一份**多文件**插件，
输出到 plugin-market/（可直接拷进 %APPDATA%\\OpenRevo\\plugins\\）。

产物：
    index.html     骨架（只外链 market.css / market.js）
    market.css     样式
    market.js      应用逻辑（内联离线目录作为 SEED）
    manifest.json  清单（含 window 声明 —— 缺了它独立视窗只有 240x320 且无标题栏）
    README.md      给装进宿主后的终端用户看

为什么是外链而不是单文件：宿主对 `tab` 插件的 iframe 用 srcDoc 注入，
但基准 URL 被处理成插件目录，`<link rel=stylesheet>` / `<script src>` /
`<img src="assets/…">` / `fetch('…')` 实测都能取到（宿主 0.9.5）。
取证方法与边界见 docs/host-contract.md。

用法：
    python build_market.py            # 构建到 plugin-market/
    python build_market.py --install  # 构建并安装到 %APPDATA%\\OpenRevo\\plugins\\
    python build_market.py --check    # 只做一致性检查，不写文件
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "market" / "src"
OUT = ROOT / "plugin-market"

PLUGIN_ID = "plugin-market"

# 独立视窗：decorations 是「关得掉」的唯一来源 —— 没有原生标题栏时
# 用户只能去任务栏结束宿主进程。skip_taskbar:false 让它在 Alt+Tab 里也能找回。
MANIFEST = {
    "id": PLUGIN_ID,
    "name": "插件市场",
    "version": "1.3.0",
    "author": "LIPiston",
    "description": "浏览 GitHub 上带 openrevo-plugin topic 的第三方插件，宿主支持时一键安装/卸载。",
    "plugin_type": "tab",
    "entry": "index.html",
    "window": {
        "width": 1120,
        "height": 780,
        "resizable": True,
        "decorations": True,
        "transparent": False,
        "always_on_top": False,
        "skip_taskbar": False,
    },
}

# index.html 允许且仅允许的两个相对资源引用。
ALLOWED_REFS = ("market.css", "market.js")

# 目录来源：在线拉不到时用的兜底。market.js 里这一行会被替换成真实目录字面量。
SEED_DECL = re.compile(r"^const SEED = \{.*?^\};$", re.S | re.M)


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def embed_catalog(js: str) -> str:
    """把 market/catalog.json 内联进 market.js，作为「连不上在线目录」时的兜底。

    这样即使仓库还没推、raw.githubusercontent 拉不到，市场一打开也是**真实目录**，
    而不是一份写死在源码里的示例。爬虫产物变了，重跑一次构建即可。
    """
    cat = ROOT / "market" / "catalog.json"
    if not cat.is_file():
        print("提示：market/catalog.json 不存在，产物沿用源码内置的种子列表")
        return js

    try:
        data = json.loads(read(cat))
    except Exception as e:  # noqa: BLE001
        raise SystemExit(f"market/catalog.json 解析失败：{e}")

    if not isinstance(data.get("plugins"), list):
        raise SystemExit("market/catalog.json 缺少 plugins 数组")

    # 用 JSON 字面量替换 SEED 常量。JSON 是 JS 字面量的子集；
    # `</` 仍需转义，防止将来被塞回 <script> 内联时提前闭合。
    literal = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    literal = literal.replace("</", "<\\/")

    replacement = (
        "/* 由 build_market.py 内联的离线目录（来源：market/catalog.json，\n"
        "   与在线目录同构；在线目录可达时会被覆盖）。 */\n"
        f"const SEED = {literal};"
    )
    new, n = SEED_DECL.subn(lambda _: replacement, js, count=1)
    if n != 1:
        raise SystemExit("在 market.js 里找不到 `const SEED = {...};` 块，无法内联目录")
    return new


def build_artifacts() -> dict[str, str]:
    """组装全部产物文本（不落盘）。键是文件名，值是内容。"""
    html = read(SRC / "index.template.html")
    css = read(SRC / "market.css")
    js = embed_catalog(read(SRC / "market.js"))

    return {
        "index.html": html,
        "market.css": css,
        "market.js": js,
        "manifest.json": json.dumps(MANIFEST, ensure_ascii=False, indent=2) + "\n",
        "README.md": read(ROOT / "market" / "PLUGIN_README.md"),
    }


def _refs(html: str) -> list[str]:
    """index.html 里的相对资源引用（不含 data:/http(s):/#）。"""
    found = re.findall(
        r'<(?:link|script|img|source)\b[^>]*?(?:href|src)\s*=\s*["\']([^"\']+)["\']',
        html,
        re.I,
    )
    return [r for r in found if not r.startswith(("data:", "http:", "https:", "#", "//"))]


def sanity_checks(art: dict[str, str]) -> list[str]:
    """产物自检：这几条都是踩过的坑，坏了必须在构建期就炸，而不是等宿主里白屏。"""
    problems: list[str] = []

    for name in ("index.html", "market.css", "market.js", "manifest.json"):
        if not art.get(name):
            problems.append(f"产物缺少 {name}")
    if problems:
        return problems

    html, css, js = art["index.html"], art["market.css"], art["market.js"]

    # 1) 占位符必须已被替换（模板不再内联，但旧模板可能残留）
    if "/*__MARKET_CSS__*/" in html or "/*__MARKET_JS__*/" in html:
        problems.append("模板里仍有未替换的占位符")

    # 2) 只许两个相对引用，且都必须是预期的那两个。
    #    同时挡住 @import —— 它会再引入一层相对路径，宿主里未必解析得到。
    refs = _refs(html)
    stray = [r for r in refs if r not in ALLOWED_REFS]
    if stray:
        problems.append(f"index.html 引用了未预期的外部资源：{', '.join(stray)}")
    for want in ALLOWED_REFS:
        if want not in refs:
            problems.append(f"index.html 没有引用 {want}")
    if re.search(r"@import\s", css, re.I):
        problems.append("market.css 含 @import —— 相对路径会再套一层，宿主里未必取得到")

    # 3) 样式与脚本不许再被内联回 HTML（拆分的意义就在这）
    if re.search(r"<style\b[^>]*>(?:(?!</style>).){500,}", html, re.S):
        problems.append("index.html 里仍有大段内联 <style>，拆分没生效")
    if re.search(r"<script\b(?![^>]*\bsrc=)[^>]*>(?:(?!</script>).){500,}", html, re.S):
        problems.append("index.html 里仍有大段内联 <script>，拆分没生效")

    # 4) 目录必须已内联进 market.js
    m = re.search(r"^const SEED = (\{.*?\});\s*$", js, re.M | re.S)
    if not m:
        problems.append("market.js 里找不到内联后的 `const SEED = {...};`")
    else:
        try:
            data = json.loads(m.group(1))
        except Exception as e:  # noqa: BLE001
            problems.append(f"内联的 SEED 不是合法 JSON：{e}")
        else:
            if not isinstance(data.get("plugins"), list) or not data["plugins"]:
                problems.append("内联的 SEED 没有插件条目（目录为空或内联失败）")
            elif data.get("source") == "builtin-seed":
                problems.append("SEED 仍是源码里的内置种子，market/catalog.json 没有被内联")

    # 5) manifest 必须有能关窗的 window 声明
    try:
        man = json.loads(art["manifest.json"])
    except Exception as e:  # noqa: BLE001
        problems.append(f"manifest.json 不是合法 JSON：{e}")
        man = {}
    win = man.get("window")
    if not isinstance(win, dict):
        problems.append("manifest 缺少 window 声明 —— 独立视窗会用默认 240x320 且无标题栏（关不掉）")
    else:
        if win.get("decorations") is not True:
            problems.append("manifest.window.decorations 必须为 true —— 否则独立视窗没有关闭按钮")
        if win.get("resizable") is not True:
            problems.append("manifest.window.resizable 应为 true（布局已自适应，允许用户拉伸）")
    if man.get("plugin_type") != "tab":
        problems.append("plugin_type 必须是 tab")

    # 6) 能力探测必须在，而且不能按版本号猜 —— 有无安装接口与版本号字符串无关
    if "get_plugin_host_capabilities" not in js:
        problems.append("没有调用 get_plugin_host_capabilities，无法按宿主能力降级")
    for cap in ("can_install", "can_uninstall", "can_reload"):
        if cap not in js:
            problems.append(f"没有使用能力位 {cap}")

    # 这一族「以插件 id 为键」的命令（install / uninstall / get_plugin_manifest）
    # 字段名都是 **id**。真机报错过两次：
    #   install_plugin_from_url missing required key id
    #   uninstall_plugin       missing required key id
    # pluginId 在 exe 里只出现一次、紧跟 open_custom_widget，是那条命令的字段。
    #
    # 检查的是 invokeByPluginId 的函数体：**首选分支必须是 { id }**，
    # pluginId 只能出现在 catch 里的兜底重试。校验调用点没用 ——
    # 调用点传的是裸 id（invokeByPluginId(cmd, id)），字段名在函数体里才定。
    mfn = re.search(r"function\s+invokeByPluginId\s*\([^)]*\)\s*\{(.*?)\n\}", js, re.S)
    if not mfn:
        problems.append("找不到 invokeByPluginId()，无法校验插件 id 类的参数名")
    else:
        body = mfn.group(1)
        trypos = body.find("catch")
        primary = body if trypos < 0 else body[:trypos]
        if not re.search(r"hostInvoke\(\s*cmd\s*,\s*\{\s*id\s*\}", primary):
            problems.append("uninstall/get_manifest 的首选参数必须是 { id }（真机 serde 字段）")
        if re.search(r"\{[^}]*\bid\s*:[^}]*pluginId", body):
            problems.append("不能同时传 id 与 pluginId —— serde 会以 unknown field 拒收")
    if re.search(r"expectedSha256", js):
        problems.append("install_plugin_from_url 的参数是 sha256，不是 expectedSha256")

    # install_plugin_from_url 的必需参数是 { id, url } —— 少了 id 宿主会直接拒：
    #   invalid args `id` ... missing required key id
    m = re.search(r"const\s+args\s*=\s*(\{[^}]*\})", js)
    if not m:
        problems.append("找不到 install_plugin_from_url 的参数对象，无法校验必需字段")
    else:
        call_args = m.group(1)
        for k in ("id", "url"):
            if not re.search(rf"\b{k}\s*:", call_args):
                problems.append(f"install_plugin_from_url 必须传 {k}（宿主必需字段）")
        if "install_plugin_from_url" not in js:
            problems.append("没有调用 install_plugin_from_url")

    # subpath 必须是**归档内**路径 —— 宿主把 subpath 直接拼在 extracted/ 后面去找
    # manifest.json，不会剥掉 codeload 的 `repo-<branch>/` 包装目录。
    # 真机报错：manifest.json not found in resolved content directory: ...\extracted\plugin-market
    if "archiveSubpath" not in js:
        problems.append("install_plugin_from_url 的 subpath 必须经 archiveSubpath() 补上归档根目录")
    elif not re.search(r"subpath\s*:\s*archiveSubpath\(", js):
        problems.append("参数对象里的 subpath 没有走 archiveSubpath()")

    # 绝不能把「本版宿主没有安装接口」这类判断写死成版本号
    if re.search(r"v?0\.9\.1[^0-9]", js):
        problems.append("market.js 里仍硬编码宿主版本号 —— 能力必须运行时探测")

    # 7) 实时发现必须自动触发、且 UI 上不再有那个按钮
    if 'data-act="live"' in js:
        problems.append('market.js 里仍有 data-act="live" 按钮 —— 实时发现应改为进入即触发')
    if "maybeAutoLive" not in js:
        problems.append("market.js 缺少 maybeAutoLive()，实时发现不会自动触发")

    return problems


def write_outputs(art: dict[str, str]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # newline="\n"：本仓库 .gitattributes 是 `* -text`（不做行尾转换），
    # 而 Windows 下 write_text 默认写 CRLF、Linux CI 写 LF ⇒ 同一份产物跨平台会整篇 diff。
    for name, text in art.items():
        (OUT / name).write_text(text, encoding="utf-8", newline="\n")

    # 清掉单文件时代的残留，否则装进宿主后会留一个没人引用的旧副本
    for stale in ("index.template.html", "styles.css", "app.js"):
        p = OUT / stale
        if p.exists():
            p.unlink()


def install() -> Path:
    appdata = os.environ.get("APPDATA")
    if not appdata:
        raise SystemExit("找不到 %APPDATA% 环境变量")
    dest = Path(appdata) / "OpenRevo" / "plugins" / PLUGIN_ID
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(OUT, dest)
    return dest


def main() -> int:
    ap = argparse.ArgumentParser(description="构建 OpenRevo 插件市场插件")
    ap.add_argument("--install", action="store_true", help="构建后安装到插件目录（APPDATA/OpenRevo/plugins）")
    ap.add_argument("--check", action="store_true", help="只检查，不写文件")
    args = ap.parse_args()

    art = build_artifacts()
    problems = sanity_checks(art)

    if problems:
        print("产物自检未通过：", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1

    total = sum(len(v) for v in art.values())
    if args.check:
        detail = "，".join(f"{k} {len(v):,}" for k, v in art.items())
        print(f"自检通过（{len(art)} 个文件，合计约 {total:,} 字符：{detail}）")
        return 0

    write_outputs(art)
    print(f"已构建 {OUT}（{len(art)} 个文件，合计约 {total:,} 字符）")
    for name in art:
        print(f"  {OUT / name}")

    if args.install:
        dest = install()
        print(f"已安装到 {dest}")
        print("回到宿主「插件」页点一次【刷新】，侧边栏会出现「插件市场」页签。")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
