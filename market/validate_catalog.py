#!/usr/bin/env python3
"""校验市场目录 catalog.json。

这道闸的作用不是"跑一遍看有没有崩"，而是把几条**不能让步的约定**钉死：

  E1 计数一致        —— 顶层 count 必须等于 plugins.length（否则 UI 的徽章会撒谎）
  E2 身份唯一        —— repo+subpath 不得重复；id 也不得重复（id 是插件目录名）
  E3 身份形状        —— repo 必须 owner/name；subpath 不得逃逸（无 .. / 不以 / 开头）
  E4 类型合法        —— plugin_type 必须在实测枚举内
  E5 能力三态        —— capabilities 只能是 null 或字符串数组；**不允许**缺字段
                        （缺字段 = 说不清扫没扫过，UI 会渲染成"未扫描"，但显式 null 才诚实）
  E6 能力值合法      —— 数组里只能是已知能力名
  E7 审核标记类型    —— unreviewed 必须是布尔，不允许 "true" 这种字符串
  E8 必填字段        —— id/name/repo/plugin_type/description 必须存在（可为空串但要显式在）
  E9 无内联脚本      —— description 里不许出现 HTML/script（UI 会转义，但不该放进目录）
  E10 commit 形状    —— 有 commit 时必须是 40 位 hex
  E11 sha256 形状    —— 有 sha256 时必须是 64 位 hex（会透传给宿主做完整性校验）

用法：
    python market/validate_catalog.py [catalog.json]
退出码 0 = 通过。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

KNOWN_TYPES = {"skin", "background", "tab", "widget", "slot", "service", "shell", "driver"}
KNOWN_CAPS = {
    "network", "fs-read", "fs-write", "shell", "env",
    "credentials", "dynamic-code", "host-runtime",
}
REQUIRED = ("id", "name", "repo", "plugin_type", "description", "capabilities", "unreviewed")
HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
REPO_RE = re.compile(r"^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")


def validate(path: Path) -> list[str]:
    errs: list[str] = []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        return [f"无法解析 JSON：{e}"]

    plugins = data.get("plugins")
    if not isinstance(plugins, list):
        return ["缺少 plugins 数组"]

    # E1
    if data.get("count") != len(plugins):
        errs.append(f"E1 count={data.get('count')} 与 plugins.length={len(plugins)} 不一致")

    seen_ids: dict[str, str] = {}
    seen_keys: set[str] = set()

    for i, p in enumerate(plugins):
        where = f"plugins[{i}] ({p.get('repo', '?')}:{p.get('subpath', '')})"

        if not isinstance(p, dict):
            errs.append(f"{where}: 不是对象")
            continue

        # E8
        for f in REQUIRED:
            if f not in p:
                errs.append(f"{where}: E8 缺少必填字段 {f}")

        pid = p.get("id")
        repo = p.get("repo")
        sub = p.get("subpath", "") or ""
        ptype = p.get("plugin_type")

        # E2
        key = f"{repo}:{sub}"
        if key in seen_keys:
            errs.append(f"{where}: E2 身份重复 {key}")
        seen_keys.add(key)
        if isinstance(pid, str):
            if pid in seen_ids and seen_ids[pid] != key:
                errs.append(f"{where}: E2 id '{pid}' 与 {seen_ids[pid]} 撞车（id 是插件目录名，必须唯一）")
            seen_ids[pid] = key

        # E3
        if not isinstance(repo, str) or not REPO_RE.match(repo):
            errs.append(f"{where}: E3 repo 形状非法：{repo!r}")
        if sub:
            if sub.startswith("/") or sub.startswith("\\") or ".." in sub.replace("\\", "/").split("/"):
                errs.append(f"{where}: E3 subpath 可能逃逸：{sub!r}")

        # E4
        if ptype not in KNOWN_TYPES:
            errs.append(f"{where}: E4 plugin_type 非法：{ptype!r}（实测枚举 {sorted(KNOWN_TYPES)}）")

        # E5 / E6
        caps = p.get("capabilities", "__missing__")
        if caps != "__missing__":
            if caps is None:
                pass                       # 未扫描，合法
            elif isinstance(caps, list):
                for c in caps:
                    if c not in KNOWN_CAPS:
                        errs.append(f"{where}: E6 未知能力值 {c!r}")
            else:
                errs.append(f"{where}: E5 capabilities 必须是 null 或数组，得到 {type(caps).__name__}")

        # E7
        if not isinstance(p.get("unreviewed"), bool):
            errs.append(f"{where}: E7 unreviewed 必须是布尔，得到 {p.get('unreviewed')!r}")

        # E9
        desc = p.get("description") or ""
        if isinstance(desc, str) and re.search(r"<\s*(script|iframe|img|style)\b", desc, re.I):
            errs.append(f"{where}: E9 description 含 HTML 标签")

        # E10
        c = p.get("commit")
        if c is not None and not (isinstance(c, str) and HEX40.match(c)):
            errs.append(f"{where}: E10 commit 形状非法：{c!r}（应为 40 位 hex 或 null）")

        # E11 sha256 是可选的「可验证安装」凭据：要么省略，要么写 64 位 hex。
        # 市场会把它原样透传给宿主的 install_plugin_from_url，宿主据此拒绝被替换的包。
        sha = p.get("sha256")
        if sha is not None and not (isinstance(sha, str) and HEX64.match(sha)):
            errs.append(f"{where}: E11 sha256 形状非法：{sha!r}（应为 64 位小写 hex 或省略）")

    return errs


def main() -> int:
    default = Path(__file__).resolve().parent / "catalog.json"
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else default
    if not path.is_file():
        print(f"找不到 {path}", file=sys.stderr)
        return 2

    errs = validate(path)
    if errs:
        print(f"目录校验未通过（{len(errs)} 条）：", file=sys.stderr)
        for e in errs:
            print(f"  - {e}", file=sys.stderr)
        return 1

    data = json.loads(path.read_text(encoding="utf-8"))
    print(f"目录校验通过：{len(data['plugins'])} 条，generatedAt={data.get('generatedAt')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
