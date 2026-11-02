"""构建器 `build_market.py` 的单元测试。

只测构建器的对外契约：

  * 产物是**多文件**（index.html / market.css / market.js / manifest.json / README.md），
    不再是单文件内联 —— 宿主实测能加载外链资源（见 docs/host-contract.md）；
  * index.html 只引用 market.css 与 market.js 两个相对资源，别的一律不许有；
  * 目录仍然被内联进 market.js 作为离线兜底（`const SEED`）；
  * manifest 的 `window` 声明存在且可关窗（decorations/resizable）。

不测 IPC 断言细节（那是 sanity_checks 的领域，由 `--check` 在真实产物上跑）。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import build_market  # noqa: E402


@pytest.fixture(scope="module")
def artifacts() -> dict[str, str]:
    return build_market.build_artifacts()


def test_artifacts_are_split_into_files(artifacts):
    for name in ("index.html", "market.css", "market.js"):
        assert name in artifacts, f"缺少产物 {name}"


def test_index_html_references_only_market_css_and_js(artifacts):
    html = artifacts["index.html"]
    refs = re.findall(r'<(?:link|script|img)[^>]*?(?:href|src)\s*=\s*["\']([^"\']+)["\']', html, re.I)
    rel = [r for r in refs if not r.startswith(("data:", "http:", "https:", "#"))]
    assert sorted(rel) == ["market.css", "market.js"], f"index.html 只许引用这两个资源，实际：{rel}"


def test_index_html_has_no_inline_placeholders(artifacts):
    html = artifacts["index.html"]
    assert "/*__MARKET_CSS__*/" not in html
    assert "/*__MARKET_JS__*/" not in html


def test_css_is_not_inlined_into_html(artifacts):
    # 拆分后样式不该再出现在 HTML 里；判据用 CSS 独有的令牌块注释
    assert "OpenRevo 插件市场 · 样式" not in artifacts["index.html"]
    assert "OpenRevo 插件市场 · 样式" in artifacts["market.css"]


def test_js_is_not_inlined_into_html(artifacts):
    assert "OpenRevo 插件市场 · 应用逻辑" not in artifacts["index.html"]
    assert "OpenRevo 插件市场 · 应用逻辑" in artifacts["market.js"]


def test_catalog_is_embedded_into_js_as_seed(artifacts):
    js = artifacts["market.js"]
    assert not re.search(r"^const SEED = \{\s*generatedAt", js, re.M), "SEED 仍是源码里的种子，目录没被内联"
    m = re.search(r"^const SEED = (\{.*?\});\s*$", js, re.M | re.S)
    assert m, "找不到内联后的 const SEED"
    data = json.loads(m.group(1))
    assert isinstance(data.get("plugins"), list) and data["plugins"], "内联目录为空"


def test_embedded_seed_matches_catalog_file(artifacts):
    cat = json.loads((ROOT / "market" / "catalog.json").read_text(encoding="utf-8"))
    m = re.search(r"^const SEED = (\{.*?\});\s*$", artifacts["market.js"], re.M | re.S)
    data = json.loads(m.group(1))
    assert [p["id"] for p in data["plugins"]] == [p["id"] for p in cat["plugins"]]


def test_manifest_declares_window_that_can_be_closed(artifacts):
    man = json.loads(artifacts["manifest.json"])
    win = man.get("window")
    assert isinstance(win, dict), "manifest 必须有 window 声明，否则弹出视窗用宿主默认 240x320 且无标题栏"
    assert win.get("decorations") is True, "没有原生标题栏 ⇒ 独立视窗关不掉"
    assert win.get("resizable") is True
    assert win.get("width", 0) >= 900 and win.get("height", 0) >= 640


def test_manifest_keeps_plugin_type_tab(artifacts):
    man = json.loads(artifacts["manifest.json"])
    assert man["plugin_type"] == "tab"
    assert man["entry"] == "index.html"


def test_artifacts_pass_sanity_checks(artifacts):
    problems = build_market.sanity_checks(artifacts)
    assert problems == [], "产物自检未通过：\n" + "\n".join(problems)


def test_sanity_flags_stray_external_ref(artifacts):
    """自检必须真的会失败：多一个外链就得报出来。"""
    html = artifacts["index.html"].replace(
        "</head>", '<link rel="stylesheet" href="extra.css">\n</head>'
    )
    broken = dict(artifacts, **{"index.html": html})
    problems = build_market.sanity_checks(broken)
    assert any("extra.css" in p or "外部" in p for p in problems), problems


def test_sanity_flags_missing_window(artifacts):
    man = json.loads(artifacts["manifest.json"])
    man.pop("window", None)
    broken = dict(artifacts, **{"manifest.json": json.dumps(man, ensure_ascii=False)})
    problems = build_market.sanity_checks(broken)
    assert any("window" in p for p in problems), problems


def test_sanity_flags_unreplaced_seed(artifacts):
    js = re.sub(r"^const SEED = \{.*?\};\s*$", "const SEED = { generatedAt: null };\n", artifacts["market.js"], count=1, flags=re.M | re.S)
    broken = dict(artifacts, **{"market.js": js})
    problems = build_market.sanity_checks(broken)
    assert any("SEED" in p or "目录" in p for p in problems), problems
