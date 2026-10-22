#!/usr/bin/env python3
"""抓取 GitHub 上带 `openrevo-plugin` topic 的仓库，生成市场目录 catalog.json。

设计取舍（沿用项目既有的"文件夹插件市场"结论）：
  * **身份 = owner/repo[/subpath]**，绝不用展示名当键 —— 展示名会撞车，star/安装量会聚合到错的地方。
  * **能力值三态**：`[...]` = 扫过并检出；`[]` = 扫过未检出；`null` = 没扫过。
    这里不做真实扫描（那需要把代码拉下来跑扫描器），所以一律写 `null`，UI 会渲染成"未扫描"。
    绝不能写 `[]` —— 那是在撒谎说"我检查过，很干净"。
  * **不内置过期快照**：目录每次重新生成，`generatedAt` 如实记录。
  * **失败不清空**：源站不可达时保留旧 catalog，只更新 `generatedAt`？不 —— 那是撒谎。
    正确做法是**报错退出、不动文件**，让上一次的产物继续用。

用法：
    python market/crawl_topic.py                 # 需要 GITHUB_TOKEN（CI 里自带）
    python market/crawl_topic.py --dry-run       # 只打印，不写文件
    python market/crawl_topic.py --merge         # 与现有 catalog 合并（保留已审核条目的人工字段）
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "market" / "catalog.json"

TOPIC = "openrevo-plugin"
API = "https://api.github.com"

# 实测暴露的 plugin_type 枚举（v0.9.1 前端 JS 里的字面量 + 手册矩阵）
KNOWN_TYPES = {"skin", "background", "tab", "widget", "slot", "service", "shell", "driver"}

# 本仓库自己的插件：目录里仍会列出，但标记成已审核（它们与目录同源同审）
CURATED = {
    "LIPiston/open-revo-market:plugin-market",
}

# 本仓库（目录的同源作者）。作者标识一律取仓库归属者，见 REPO_OWNER。
REPO = "LIPiston/open-revo-market"
REPO_OWNER = REPO.split("/")[0]


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


def gh_get(path: str, token: str | None, retries: int = 4) -> dict | None:
    """带退避的 GitHub GET。403/429 通常是限速，退避重试；404 直接回 None。"""
    url = path if path.startswith("http") else API + path
    for attempt in range(retries):
        req = urllib.request.Request(url)
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("User-Agent", "openrevo-market-crawler")
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code in (403, 429):
                reset = e.headers.get("X-RateLimit-Reset")
                wait = 60
                if reset:
                    try:
                        wait = max(5, int(reset) - int(time.time()) + 2)
                    except ValueError:
                        pass
                wait = min(wait, 120)
                log(f"  限速 {e.code}，{wait}s 后重试（{attempt + 1}/{retries}）")
                time.sleep(wait)
                continue
            log(f"  HTTP {e.code}: {url}")
            return None
        except Exception as e:  # noqa: BLE001 - 网络层什么都可能抛
            log(f"  请求失败: {e}")
            time.sleep(3)
    return None


def search_topic(token: str | None) -> list[dict]:
    """搜 topic；用分页拿全量。GitHub 搜索接口单查询上限 1000 条，够这个 topic 用很久。"""
    items: list[dict] = []
    page = 1
    while page <= 10:
        data = gh_get(f"/search/repositories?q=topic:{TOPIC}&per_page=100&page={page}&sort=updated", token)
        if not data:
            break
        batch = data.get("items") or []
        items.extend(batch)
        log(f"  第 {page} 页：{len(batch)} 条（累计 {len(items)}）")
        if len(batch) < 100:
            break
        page += 1
        time.sleep(2)  # 搜索接口限额紧，页间退让
    return items


def fetch_manifest(repo: str, branch: str, token: str | None, subpath: str = "") -> dict | None:
    """取仓库根（或子目录）的 manifest.json。取不到就返回 None —— 不猜字段。"""
    p = f"{subpath.strip('/')}/manifest.json" if subpath else "manifest.json"
    data = gh_get(f"/repos/{repo}/contents/{p}?ref={branch}", token)
    if not data or data.get("type") != "file":
        return None
    try:
        import base64
        raw = base64.b64decode(data.get("content") or "")
        return json.loads(raw.decode("utf-8"))
    except Exception:  # noqa: BLE001
        return None


def latest_commit(repo: str, branch: str, token: str | None) -> tuple[str | None, str | None]:
    data = gh_get(f"/repos/{repo}/commits/{branch}", token)
    if not data:
        return None, None
    sha = data.get("sha")
    date = (data.get("commit") or {}).get("committer", {}).get("date")
    return sha, date


def detect_subpaths(repo: str, branch: str, token: str | None, max_probe: int = 24) -> list[str]:
    """monorepo 支持：扫一层子目录，看谁里面有 manifest.json。
    浅一层足够覆盖绝大多数布局，且不会把 API 配额烧光。"""
    data = gh_get(f"/repos/{repo}/contents/?ref={branch}", token)
    if not isinstance(data, list):
        return []
    out: list[str] = []
    for item in data:
        if item.get("type") != "dir" or item.get("name", "").startswith("."):
            continue
        if len(out) >= max_probe:
            break
        name = item["name"]
        if fetch_manifest(repo, branch, token, subpath=name):
            out.append(name)
    return out


def build_entry(
    repo_meta: dict,
    token: str | None,
    subpath: str = "",
    manifest: dict | None = None,
) -> dict | None:
    full = repo_meta.get("full_name") or ""
    if not full:
        return None
    branch = repo_meta.get("default_branch") or "main"

    if manifest is None:
        manifest = fetch_manifest(full, branch, token, subpath=subpath)

    # 身份：repo + subpath。没有 manifest 也照样收录（作者可能用了别的入口），
    # 但字段全部留空而不是编造 —— UI 上会显示"作者未填写描述"。
    pid = manifest_id(manifest) if manifest else None
    if not pid:
        leaf = subpath.split("/")[-1] if subpath else repo_meta.get("name", "")
        pid = re.sub(r"[^a-z0-9\-]+", "-", leaf.lower()).strip("-") or "plugin"

    commit = manifest.get("_commit") if manifest else None
    entry = {
        "id": pid,
        "name": (manifest or {}).get("name") or repo_meta.get("name") or pid,
        "version": (manifest or {}).get("version") or "",
        # 作者 = 仓库归属者。manifest 里的 author 是自填的展示名，可能与仓库实际
        # 归属者无关（甚至挂着社区名义），目录里只用 owner 登录名。
        "author": (repo_meta.get("owner") or {}).get("login") or full.split("/")[0],
        "plugin_type": (manifest or {}).get("plugin_type") or (manifest or {}).get("type") or "tab",
        "description": (manifest or {}).get("description") or repo_meta.get("description") or "",
        "repo": full,
        "subpath": subpath,
        "branch": branch,
        "commit": commit,
        "stars": repo_meta.get("stargazers_count"),
        "updatedAt": repo_meta.get("pushed_at") or repo_meta.get("updated_at"),
        "license": ((repo_meta.get("license") or {}).get("spdx_id")) or None,
        # topic 自动收录的一律标未审核；人工 PR 进正典时把这个字段改成 false
        "unreviewed": True,
        # 能力三态里的"未扫描"：显式 null，绝不是 []
        "capabilities": None,
        "topics": repo_meta.get("topics") or [],
        "homepage": repo_meta.get("homepage") or None,
    }

    if entry["plugin_type"] not in KNOWN_TYPES:
        # 未知类型不拒（宿主自己也是原样显示），但记下来便于人工看
        entry["plugin_type_raw"] = entry["plugin_type"]
        entry["plugin_type"] = "tab"

    if f"{full}:{subpath}" in CURATED:
        entry["unreviewed"] = False

    return entry


def manifest_id(manifest: dict) -> str | None:
    v = manifest.get("id")
    return v if isinstance(v, str) and v.strip() else None


def local_entries() -> list[dict]:
    """收录本仓库自带的插件。

    topic 刚起步时它是空集，光靠爬取目录里会一条都没有；而本仓库就是目录的同源作者，
    把自己的插件读本地 manifest 收进来既准确又不需要网络。这些条目直接标「已审核」。
    """
    out: list[dict] = []
    for d in sorted(ROOT.iterdir()):
        mf = d / "manifest.json"
        if not d.is_dir() or not mf.is_file() or d.name.startswith((".", "_", "market")):
            continue
        try:
            m = json.loads(mf.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            log(f"  跳过 {d.name}：manifest.json 解析失败")
            continue
        pid = manifest_id(m)
        if not pid:
            continue
        out.append({
            "id": pid,
            "name": m.get("name") or pid,
            "version": m.get("version") or "",
            "author": REPO_OWNER,
            "plugin_type": m.get("plugin_type") or m.get("type") or "tab",
            "description": m.get("description") or "",
            "repo": REPO,
            "subpath": d.name,
            "branch": "main",
            "commit": None,
            "stars": None,
            "updatedAt": None,
            "license": "MIT",
            "unreviewed": False,      # 与目录同源同审
            "capabilities": None,     # 仍未做静态扫描 —— 三态里的"未扫描"
            "topics": [TOPIC],
            "homepage": None,
        })
    return out


def crawl(token: str | None, include_local: bool = True) -> dict:
    log(f"搜索 topic:{TOPIC} …")
    repos = search_topic(token)
    log(f"共 {len(repos)} 个仓库")

    entries: list[dict] = []
    for i, meta in enumerate(repos, 1):
        full = meta.get("full_name") or "?"
        branch = meta.get("default_branch") or "main"
        log(f"[{i}/{len(repos)}] {full}")

        root_manifest = fetch_manifest(full, branch, token)

        if root_manifest:
            sha, _ = latest_commit(full, branch, token)
            if sha:
                root_manifest["_commit"] = sha
            e = build_entry(meta, token, "", root_manifest)
            if e:
                entries.append(e)
            # 根目录是插件时，也顺带看看有没有 monorepo 子插件
            for sub in detect_subpaths(full, branch, token):
                sm = fetch_manifest(full, branch, token, subpath=sub)
                if not sm:
                    continue
                if sm.get("id") == root_manifest.get("id"):
                    continue  # 根和子目录同一个 id，跳过重复
                if sha:
                    sm["_commit"] = sha
                se = build_entry(meta, token, sub, sm)
                if se:
                    entries.append(se)
        else:
            subs = detect_subpaths(full, branch, token)
            if subs:
                sha, _ = latest_commit(full, branch, token)
                for sub in subs:
                    sm = fetch_manifest(full, branch, token, subpath=sub)
                    if sm and sha:
                        sm["_commit"] = sha
                    se = build_entry(meta, token, sub, sm)
                    if se:
                        entries.append(se)
            else:
                # 打了 topic 但没有 manifest：仍然收录，字段留空，用户自己看源码
                e = build_entry(meta, token, "", None)
                if e:
                    entries.append(e)

    # 身份去重（repo+subpath），后者覆盖前者
    dedup: dict[str, dict] = {}
    if include_local:
        for e in local_entries():
            dedup[f"{e['repo']}:{e['subpath']}"] = e
    for e in entries:
        dedup[f"{e['repo']}:{e['subpath']}"] = e
    final = sorted(dedup.values(), key=lambda e: (e.get("unreviewed", True), -(e.get("stars") or 0), e["repo"]))

    return {
        "format": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "topic": TOPIC,
        "count": len(final),
        "plugins": final,
    }


def merge(prev: dict, fresh: dict) -> dict:
    """与上一份目录合并：
      * 人工改过的字段（进正典后 unreviewed=false、手写 description/capabilities）保留；
      * 仓库侧字段（stars / updatedAt / commit / version）以新抓到的为准。"""
    by_key = {f"{p['repo']}:{p.get('subpath','')}": p for p in (prev.get("plugins") or [])}
    out = []
    for p in fresh["plugins"]:
        key = f"{p['repo']}:{p.get('subpath','')}"
        old = by_key.get(key)
        if old:
            for f in ("unreviewed", "capabilities", "description", "name", "plugin_type"):
                if f == "unreviewed" and old.get(f) is False:
                    p[f] = False          # 正典标记一旦落下，爬虫不得翻回未审核
                elif old.get(f) is not None and old.get(f) != [] and p.get(f) in (None, ""):
                    p[f] = old[f]         # 爬虫没抓到，沿用人工写的
            # sha256 是人工算好后写进目录的「可验证安装」凭据，爬虫抓不到也不能丢 ——
            # 丢了就等于悄悄把安装从"可校验"降级成"仅传输完整"。
            if old.get("sha256"):
                p["sha256"] = old["sha256"]
        out.append(p)

    # 人工加进 catalog 但不在 topic 结果里的条目（比如自建 CDN 托管）也保留
    fresh_keys = {f"{p['repo']}:{p.get('subpath','')}" for p in fresh["plugins"]}
    for p in prev.get("plugins") or []:
        key = f"{p['repo']}:{p.get('subpath','')}"
        if key not in fresh_keys and p.get("unreviewed") is False:
            out.append(p)

    fresh["plugins"] = sorted(out, key=lambda e: (-(e.get("stars") or 0), e["repo"]))
    fresh["count"] = len(fresh["plugins"])
    return fresh


def main() -> int:
    ap = argparse.ArgumentParser(description="抓取 openrevo-plugin topic 生成市场目录")
    ap.add_argument("--dry-run", action="store_true", help="只打印统计，不写文件")
    ap.add_argument("--merge", action="store_true", help="与现有 catalog.json 合并")
    ap.add_argument("--out", default=str(CATALOG), help="输出路径")
    args = ap.parse_args()

    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not token:
        log("警告：没有 GITHUB_TOKEN，未认证限额 60 次/小时，很可能中途被限速")

    try:
        fresh = crawl(token)
    except Exception as e:  # noqa: BLE001
        # 失败不写文件 —— 让上一次的产物继续服务，也不假装"目录里没有插件"
        log(f"抓取失败，保留现有目录不动：{e}")
        return 1

    if args.merge and Path(args.out).exists():
        prev = json.loads(Path(args.out).read_text(encoding="utf-8"))
        fresh = merge(prev, fresh)

    log(f"\n共 {fresh['count']} 条：")
    by_type: dict[str, int] = {}
    for p in fresh["plugins"]:
        by_type[p["plugin_type"]] = by_type.get(p["plugin_type"], 0) + 1
    for t, n in sorted(by_type.items(), key=lambda kv: -kv[1]):
        log(f"  {t:12s} {n}")

    if args.dry_run:
        print(json.dumps(fresh, ensure_ascii=False, indent=2)[:4000])
        return 0

    # newline="\n"：仓库 .gitattributes 是 `* -text`，且 CI 在 Linux 上跑，
    # 不能让 Windows 本地写 CRLF、CI 写 LF，否则每小时刷新会整篇重写 catalog.json。
    Path(args.out).write_text(
        json.dumps(fresh, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    log(f"已写入 {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
