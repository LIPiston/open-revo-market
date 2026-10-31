#!/usr/bin/env python3
"""人工覆写层：`market/overrides.json`。

`catalog.json` 是**纯派生物** —— 爬虫每小时按 topic 全量重写它，手改的字段下一轮就没了。
所以人工判断一律写在这个文件里，爬完之后由 `apply()` 叠加到目录上。

文件形状：

    {
      "format": 1,
      "plugins": {
        "owner/repo:subpath": { "字段": 值, ... }
      }
    }

键是 `owner/repo:subpath`（仓库根条目 subpath 留空），与爬虫的身份键一致。
**不用 id 当键**：作者改一次 manifest 里的 id，用 id 存键就会静默失配 ——
你想改的那条没改上，而且不报错。

字段规则：

  * 字段省略，或值为 `null` / `""` → **不覆写**，保留爬虫这一轮抓到的值；
  * 其余任何值（含 `false` / `[]` / `{}`）→ 直接覆盖。
    `capabilities: []` 是「扫过、没检出」，`permissions: []` 是「声明没有额外权限」——
    这两个都是**有内容的结论**，当空处理会让人写不出结论。
    想表达「不管它」，请直接省略这个字段；
  * `"exclude": true` → 这一条不进目录（下架 / 拉黑）。

字段名拼错会直接报错。静默不生效比报错危险得多 —— 你以为审过了，其实没有。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

KEY_SEP = ":"

# 目录条目里可能出现、因而可以由人工覆写的字段。
# 与 crawl_topic.build_entry() / extract_manifest_fields() 的产出一一对应。
CATALOG_FIELDS = frozenset({
    "id", "name", "version", "author", "plugin_type", "plugin_type_raw",
    "description", "repo", "subpath", "branch", "commit", "stars",
    "updatedAt", "license", "unreviewed", "capabilities", "topics", "homepage",
    "sha256", "entry", "target_slot", "slot_height", "min_host_version",
    "permissions", "service", "shortcuts", "watchers", "window", "telemetry",
    "theme_css", "background_css", "image",
})

# 身份字段由键决定（repo:subpath）。覆写它们会让键和条目对不上，直接拒绝。
IDENTITY_FIELDS = frozenset({"repo", "subpath"})

# 不是条目字段、但允许出现在条目里的控制键。
CONTROL_FIELDS = frozenset({"exclude"})

TOP_LEVEL = frozenset({"format", "plugins", "_note"})


class OverrideError(ValueError):
    """覆写文件本身有问题 —— 直接让 CI 红，别让它悄悄不生效。"""


def _blank(v) -> bool:
    """「留空」= 不覆写。只认两个空：null 与空串。

    特意**不**把 `[]` / `{}` 当空，见模块注释。
    """
    return v is None or v == ""


def key_of(entry: dict) -> str:
    """条目的身份键。唯一来源，别在别处另写一份拼接。"""
    return f"{entry.get('repo')}{KEY_SEP}{entry.get('subpath') or ''}"


def is_excluded(patch: dict) -> bool:
    return patch.get("exclude") is True


def load(path: Path) -> dict[str, dict]:
    """读覆写文件。不存在 = 空表（目录照常由爬虫生成）。"""
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        raise OverrideError(f"{path} 不是合法 JSON：{e}")
    if not isinstance(data, dict):
        raise OverrideError(f"{path} 顶层必须是对象")

    unknown = set(data) - TOP_LEVEL
    if unknown:
        raise OverrideError(f"{path} 顶层有未知键 {sorted(unknown)}，只认 {sorted(TOP_LEVEL)}")
    if data.get("format") != 1:
        raise OverrideError(f"{path} 的 format 必须是 1")

    plugins = data.get("plugins")
    if not isinstance(plugins, dict):
        raise OverrideError(f"{path} 的 plugins 必须是对象，键为 owner/repo:subpath")

    out: dict[str, dict] = {}
    for key, patch in plugins.items():
        _check_key(key)
        if not isinstance(patch, dict):
            raise OverrideError(f"{key}: 值必须是对象")

        bad = set(patch) - CATALOG_FIELDS - CONTROL_FIELDS
        if bad:
            raise OverrideError(f"{key}: 未知字段 {sorted(bad)}（字段名拼错了吧？）")
        ident = set(patch) & IDENTITY_FIELDS
        if ident:
            raise OverrideError(f"{key}: 身份字段 {sorted(ident)} 不可覆写 —— 它们由键决定")
        if "exclude" in patch and not isinstance(patch["exclude"], bool):
            raise OverrideError(f"{key}: exclude 必须是布尔，得到 {patch['exclude']!r}")

        out[key] = patch
    return out


def _check_key(key: str) -> None:
    repo, _, sub = key.partition(KEY_SEP)
    if "/" not in repo or repo.startswith("/") or repo.endswith("/"):
        raise OverrideError(f"覆写键 {key!r} 不合法：应为 owner/repo:subpath")
    if sub.startswith(("/", "\\")) or ".." in sub.replace("\\", "/").split("/"):
        raise OverrideError(f"{key}: subpath 可能逃逸：{sub!r}")


def apply(
    catalog: dict,
    overrides: dict[str, dict],
    make_entry=None,
    log=None,
) -> dict:
    """把覆写叠加到目录上，返回同一个 dict（就地改）。

    `make_entry(key, patch)` 只在「覆写引用了一个目录里没有的条目」时被调用，
    由调用方决定怎么补建（这里不猜默认值）。
    """
    say = log or (lambda _msg: None)

    by_key = {key_of(p): p for p in (catalog.get("plugins") or [])}

    kept: list[dict] = []
    for key, p in by_key.items():
        if key in overrides and is_excluded(overrides[key]):
            say(f"  覆写排除（不进目录）：{key}")
            continue
        kept.append(p)

    for key, patch in overrides.items():
        if is_excluded(patch):
            if key not in by_key:
                # 不报错（条目可能这轮真没了），但要出声：键写错时排除会静默失效
                say(f"  注意：{key} 本来就不在目录里，exclude 没有实际作用")
            continue
        p = by_key.get(key)
        if p is None:
            if make_entry is None:
                raise OverrideError(f"{key}: 目录里没有这个条目，且调用方不支持补建")
            say(f"  覆写补建（目录里没有）：{key}")
            p = make_entry(key, patch)
            by_key[key] = p
            kept.append(p)
        for field, value in patch.items():
            if field in CONTROL_FIELDS or _blank(value):
                continue
            p[field] = value

    catalog["plugins"] = sorted(
        kept,
        key=lambda e: (e.get("unreviewed", True), -(e.get("stars") or 0), e.get("repo") or ""),
    )
    catalog["count"] = len(catalog["plugins"])
    return catalog


def main() -> int:
    """单独校验覆写文件：`python market/overrides.py [overrides.json]`。"""
    default = Path(__file__).resolve().parent / "overrides.json"
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else default
    try:
        ov = load(path)
    except OverrideError as e:
        print(f"覆写文件校验失败：{e}", file=sys.stderr)
        return 1

    excl = [k for k, v in ov.items() if is_excluded(v)]
    print(f"覆写文件通过：{path}")
    print(f"  {len(ov)} 条被覆写，其中 {len(excl)} 条排除出目录")
    for k in excl:
        print(f"    - {k}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
