#!/usr/bin/env python3
"""构建 OpenRevo 插件市场插件。

把 market/src/{market.css,market.js} 内联进一份单文件 index.html，
输出到 plugin-market/（可直接拷进 %APPDATA%\\OpenRevo\\plugins\\）。

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
MANIFEST = {
    "id": PLUGIN_ID,
    "name": "插件市场",
    "version": "1.1.0",
    "author": "LIPiston",
    "description": "浏览 GitHub 上带 openrevo-plugin topic 的第三方插件，宿主支持时一键安装/卸载。",
    "plugin_type": "tab",
    "entry": "index.html",
}


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def embed_catalog(js: str) -> str:
    """把 market/catalog.json 内联进产物，作为「连不上在线目录」时的兜底。

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

    # 用 JSON 字面量替换 SEED 常量。JSON 是 JS 字面量的子集，
    # 但仍要防 `</` 把内联 <script> 提前闭合。
    literal = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    literal = literal.replace("</", "<\\/")

    marker = re.compile(r"^const SEED = \{.*?^\};$", re.S | re.M)
    replacement = (
        "/* 由 build_market.py 内联的离线目录（来源：market/catalog.json，\n"
        "   与在线目录同构；在线目录可达时会被覆盖）。 */\n"
        f"const SEED = {literal};"
    )
    new, n = marker.subn(lambda _: replacement, js, count=1)
    if n != 1:
        raise SystemExit("在 market.js 里找不到 `const SEED = {...};` 块，无法内联目录")
    return new


def build_html() -> str:
    tpl = read(SRC / "index.template.html")
    css = read(SRC / "market.css")
    js = embed_catalog(read(SRC / "market.js"))

    if re.search(r"<\s*/\s*script", js, re.I):
        raise SystemExit("market.js 含 </script> 字面量，会截断内联脚本，请改写为 <\\/script>")

    html = tpl.replace("/*__MARKET_CSS__*/", css).replace("/*__MARKET_JS__*/", js)
    return html


def sanity_checks(html: str) -> list[str]:
    """产物自检：这几条都是踩过的坑，坏了必须在构建期就炸，而不是等宿主里白屏。"""
    problems: list[str] = []

    if "/*__MARKET_CSS__*/" in html or "/*__MARKET_JS__*/" in html:
        problems.append("占位符没有被替换")

    # 宿主把整份 HTML 作为 srcdoc 注入；任何外部引用都会按 tauri:// base 解析而 404
    for pat, label in (
        (r'<link[^>]+rel=["\']?stylesheet', "外部样式表 <link rel=stylesheet>"),
        (r'<script[^>]+\bsrc=', "外部脚本 <script src>"),
        (r'<img[^>]+\bsrc=["\'](?!data:)', "外部图片 <img src>"),
        (r'@import\s', "CSS @import"),
    ):
        if re.search(pat, html, re.I):
            problems.append(f"产物含{label} —— srcdoc 下必然取不到")

    # 内联脚本里出现裸 </script> 会提前闭合
    if html.count("<script>") != 1 or html.count("</script>") != 1:
        problems.append("script 标签数量异常（内联脚本里可能有裸 </script>）")

    # 模板字面量里的 </script> 必须转义
    if re.search(r"<\s*/\s*script", read(SRC / "market.js"), re.I):
        problems.append("market.js 里出现 </script> 字面量，需写成 <\\/script>")

    if 'plugin_type' not in read(SRC / "market.js"):
        problems.append("未使用 plugin_type —— v0.9.1 的权威键是 plugin_type")

    # 能力探测必须在，而且不能按版本号猜 —— 老宿主报的版本号和新宿主一样
    js_src = read(SRC / "market.js")
    if "get_plugin_host_capabilities" not in js_src:
        problems.append("没有调用 get_plugin_host_capabilities，无法按宿主能力降级")
    for cap in ("can_install", "can_uninstall", "can_reload"):
        if cap not in js_src:
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
    mfn = re.search(r"function\s+invokeByPluginId\s*\([^)]*\)\s*\{(.*?)\n\}", js_src, re.S)
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
    if re.search(r"expectedSha256", js_src):
        problems.append("install_plugin_from_url 的参数是 sha256，不是 expectedSha256")

    # install_plugin_from_url 的必需参数是 { id, url } —— 少了 id 宿主会直接拒：
    #   invalid args `id` ... missing required key id
    # 这条是真机上踩过的：只看 exe 里紧跟命令名的 subpath/sha256 会误以为只有三个字段，
    # 因为 id 与 url 被其它命令复用、已被编译器去重到别处。
    # 参数对象是变量（args）再传进去，所以校验它的构造处，而不是调用处。
    m = re.search(r"const\s+args\s*=\s*(\{[^}]*\})", js_src)
    if not m:
        problems.append("找不到 install_plugin_from_url 的参数对象，无法校验必需字段")
    else:
        call_args = m.group(1)
        for k in ("id", "url"):
            if not re.search(rf"\b{k}\s*:", call_args):
                problems.append(f"install_plugin_from_url 必须传 {k}（宿主必需字段）")
        if "install_plugin_from_url" not in js_src:
            problems.append("没有调用 install_plugin_from_url")

    # subpath 必须是**归档内**路径 —— 宿主把 subpath 直接拼在 extracted/ 后面去找
    # manifest.json，不会剥掉 codeload 的 `repo-<branch>/` 包装目录。
    # 真机报错：manifest.json not found in resolved content directory: ...\extracted\plugin-market
    if "archiveSubpath" not in js_src:
        problems.append("install_plugin_from_url 的 subpath 必须经 archiveSubpath() 补上归档根目录")
    elif not re.search(r"subpath\s*:\s*archiveSubpath\(", js_src):
        problems.append("参数对象里的 subpath 没有走 archiveSubpath()")

    # 绝不能把「本版宿主没有安装接口」这类判断写死成版本号
    if re.search(r"v?0\.9\.1[^0-9]", js_src):
        problems.append("market.js 里仍硬编码宿主版本号 —— 能力必须运行时探测")

    return problems


def write_outputs(html: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # newline="\n"：本仓库 .gitattributes 是 `* -text`（不做行尾转换），
    # 而 Windows 下 write_text 默认写 CRLF、Linux CI 写 LF ⇒ 同一份产物跨平台会整篇 diff。
    (OUT / "index.html").write_text(html, encoding="utf-8", newline="\n")
    (OUT / "manifest.json").write_text(
        json.dumps(MANIFEST, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
    )
    # 顺手放一份说明，装进宿主后用户能在插件目录里看到
    (OUT / "README.md").write_text(
        read(ROOT / "market" / "PLUGIN_README.md"), encoding="utf-8", newline="\n"
    )


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

    html = build_html()
    problems = sanity_checks(html)

    if problems:
        print("产物自检未通过：", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1

    if args.check:
        print(f"自检通过（index.html 约 {len(html):,} 字符）")
        return 0

    write_outputs(html)
    print(f"已构建 {OUT / 'index.html'}（{len(html):,} 字符）")
    print(f"  {OUT / 'manifest.json'}")

    if args.install:
        dest = install()
        print(f"已安装到 {dest}")
        print("回到宿主「插件」页点一次【刷新】，侧边栏会出现「插件市场」页签。")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
