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
