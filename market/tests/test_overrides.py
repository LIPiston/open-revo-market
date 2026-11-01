"""覆写层 `market/overrides.json` 的单元测试。

只测覆写层自己的契约：哪些字段能写、哪些写了会被拒、
以及 `review_note` 这类控制字段不能被漏进目录里。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import overrides  # noqa: E402


def write_overrides(tmp_path: Path, plugins: dict) -> Path:
    p = tmp_path / "overrides.json"
    p.write_text(
        json.dumps({"format": 1, "plugins": plugins}, ensure_ascii=False),
        encoding="utf-8",
    )
    return p


def make_catalog() -> dict:
    return {
        "count": 1,
        "plugins": [
            {
                "id": "demo",
                "name": "Demo",
                "repo": "owner/demo",
                "subpath": "",
                "plugin_type": "tab",
                "description": "x",
                "capabilities": None,
                "unreviewed": True,
            }
        ],
    }


def test_review_note_is_accepted_as_control_field(tmp_path: Path) -> None:
    """审核者要能在覆写里写拒绝理由，否则拒人时无话可写。"""
    path = write_overrides(
        tmp_path,
        {"owner/demo:": {"review_note": "要求提权但未说明用途"}},
    )

    loaded = overrides.load(path)

    assert loaded["owner/demo:"]["review_note"] == "要求提权但未说明用途"


def test_review_note_does_not_leak_into_catalog(tmp_path: Path) -> None:
    """`review_note` 是给人看的备注，不是目录字段，不能进 catalog.json。"""
    catalog = make_catalog()
    overrides.apply(
        catalog,
        {"owner/demo:": {"review_note": "理由", "description": "新描述"}},
    )

    entry = catalog["plugins"][0]
    assert "review_note" not in entry
    # 同一个 patch 里的普通目录字段照常生效，证明只跳过了控制字段
    assert entry["description"] == "新描述"


def test_unknown_field_still_rejected(tmp_path: Path) -> None:
    """回归：白名单不能因为加了 review_note 就变成不设防。"""
    path = write_overrides(tmp_path, {"owner/demo:": {"review_not": "拼错了"}})

    with pytest.raises(overrides.OverrideError):
        overrides.load(path)


def test_key_without_trailing_colon_is_rejected(tmp_path: Path) -> None:
    """键必须写明 `repo:` —— 少一个冒号不会报错，只会静默匹配不到任何条目。

    这是真实踩过的坑：文档示例漏了冒号，`{"owner/repo": {...}}` 被 `load()` 收下，
    然后 `apply()` 找不到条目：`exclude` 静默失效（条目还在目录里），
    其它字段则抛错让整次抓取失败。两种后果都比直接拒绝这个键难查得多。
    """
    path = write_overrides(tmp_path, {"owner/demo": {"unreviewed": False}})

    with pytest.raises(overrides.OverrideError):
        overrides.load(path)


def test_exclude_on_missing_entry_only_warns() -> None:
    """给目录里没有的条目写 exclude 只提示、不炸整次抓取。

    作者删了 topic 或改了仓库名时，键还在覆写层里但条目已经没了 ——
    这不该让目录停止刷新。
    """
    catalog = make_catalog()
    warnings: list[str] = []

    overrides.apply(
        catalog,
        {"someone/gone:": {"exclude": True, "review_note": "已下架"}},
        log=warnings.append,
    )

    assert len(catalog["plugins"]) == 1
    assert any("exclude 没有实际作用" in w for w in warnings)


def test_review_note_on_missing_entry_does_not_crash() -> None:
    """`review_note` 只是给人看的备注，不该因为条目这轮不在目录里就炸掉抓取。

    审核者常给「收录但未审核」的条目写备注；作者改仓库名或某轮 --local-only
    没重建到它时，条目会短暂消失。一条备注不该让整份目录写不出去。
    """
    catalog = make_catalog()
    warnings: list[str] = []

    overrides.apply(
        catalog,
        {"someone/gone:": {"review_note": "理由"}},
        log=warnings.append,
    )

    assert len(catalog["plugins"]) == 1
    assert any("review_note 暂时没有对应条目" in w for w in warnings)


def test_review_note_must_be_string(tmp_path: Path) -> None:
    """备注是写给人读的，数字或对象写进来只会让人看到 `123` 这种没意义的东西。"""
    path = write_overrides(tmp_path, {"owner/demo:": {"review_note": 123}})

    with pytest.raises(overrides.OverrideError):
        overrides.load(path)

