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


SEMVER3 = re.compile(r"^\d+\.\d+\.\d+$")


def _nonempty_str(v) -> str | None:
    """非空字符串，其余（含纯空白）一律 None。"""
    return v if isinstance(v, str) and v.strip() else None


def sanitize_min_host_version(v) -> str | None:
    """三段数字 SemVer 才算数；`>=0.9.3`、`^0.9` 这类范围表达式不属于本字段语义。"""
    s = _nonempty_str(v)
    return s if s and SEMVER3.match(s) else None


def sanitize_permissions(v) -> list[str] | None:
    """字符串数组或 None。非字符串元素丢弃，不替换成空串。"""
    if not isinstance(v, list):
        return None
    return [x for x in v if isinstance(x, str) and x.strip()]


def sanitize_service(v) -> dict | None:
    """伴随服务声明。`executable` 是宿主唯一强制的字段，缺它整块作废。

    `args` 永不写入目录 —— 它可能带端口口令或本机路径，而宿主结构里也没有该字段。
    """
    if not isinstance(v, dict):
        return None
    exe = _nonempty_str(v.get("executable"))
    if not exe:
        return None
    out: dict = {"executable": exe}
    for k in ("elevated", "auto_start", "auto_stop"):
        if isinstance(v.get(k), bool):
            out[k] = v[k]
    health = _nonempty_str(v.get("health_url"))
    if health:
        out["health_url"] = health
    port = v.get("port")
    if isinstance(port, int) and not isinstance(port, bool) and port > 0:
        out["port"] = port
    desc = _nonempty_str(v.get("description"))
    if desc:
        out["description"] = desc
    return out


def sanitize_shortcuts(v) -> list[dict] | None:
    """只保留可展示的最小面：id / name / combo。动作载荷不进目录。"""
    if not isinstance(v, list):
        return None
    out: list[dict] = []
    for it in v:
        if not isinstance(it, dict):
            continue
        sid = _nonempty_str(it.get("id"))
        if not sid:
            continue
        row = {"id": sid}
        for k in ("name", "combo"):
            s = _nonempty_str(it.get(k))
            if s:
                row[k] = s
        out.append(row)
    return out or None


def sanitize_watchers(v) -> list[dict] | None:
    """只保留 id / name / 条件类型。条件类型缺失就不写 when，不猜。"""
    if not isinstance(v, list):
        return None
    out: list[dict] = []
    for it in v:
        if not isinstance(it, dict):
            continue
        wid = _nonempty_str(it.get("id"))
        if not wid:
            continue
        row = {"id": wid}
        name = _nonempty_str(it.get("name"))
        if name:
            row["name"] = name
        when = it.get("when")
        if isinstance(when, dict):
            wtype = _nonempty_str(when.get("type"))
            if wtype:
                row["when"] = wtype
        out.append(row)
    return out or None


def sanitize_window(v) -> dict | None:
    if not isinstance(v, dict):
        return None
    out: dict = {}
    for k in ("width", "height"):
        x = v.get(k)
        if isinstance(x, int) and not isinstance(x, bool) and x > 0:
            out[k] = x
    # 宿主同时接受 snake_case 与手册里的 camelCase 写法，这里统一收成 snake_case
    for name, keys in (
        ("transparent", ("transparent",)),
        ("always_on_top", ("always_on_top", "alwaysOnTop")),
        ("resizable", ("resizable",)),
        ("decorations", ("decorations",)),
        ("skip_taskbar", ("skip_taskbar", "skipTaskbar")),
    ):
        for k in keys:
            if isinstance(v.get(k), bool):
                out[name] = v[k]
                break
    return out or None


def sanitize_telemetry(v) -> dict | None:
    """`enabled` 是清单自述（宿主不校验），按声明原样记录，不改写含义。"""
    if not isinstance(v, dict):
        return None
    out: dict = {}
    if isinstance(v.get("enabled"), bool):
        out["enabled"] = v["enabled"]
    sensors = v.get("sensors")
    if isinstance(sensors, list):
        kept = [x for x in sensors if isinstance(x, str) and x.strip()]
        if kept:
            out["sensors"] = kept
    return out or None


def extract_manifest_fields(manifest: dict | None) -> dict:
    """从 manifest 抽取形态专属字段，供目录条目携带。

    取舍：**形状不合法一律收敛为 null**。这是「丢弃无法理解的声明」，不是编造值 ——
    远端作者写错一个字段不该让本仓库的目录校验变红。
    """
    m = manifest if isinstance(manifest, dict) else {}
    existing = m.get("watchers")
    rules = existing if existing is not None else m.get("rules")
    return {
        "entry": _nonempty_str(m.get("entry")),
        "target_slot": _nonempty_str(m.get("target_slot")) or _nonempty_str(m.get("slot")),
        "slot_height": _nonempty_str(m.get("slot_height")) or _nonempty_str(m.get("slotHeight")),
        "min_host_version": (
            sanitize_min_host_version(m.get("min_host_version"))
            or sanitize_min_host_version(m.get("min_version"))
            or sanitize_min_host_version(m.get("openrevo_version"))
        ),
        "permissions": sanitize_permissions(m.get("permissions")),
        "service": sanitize_service(m.get("service")),
        "shortcuts": sanitize_shortcuts(m.get("shortcuts")),
        "watchers": sanitize_watchers(rules),
        "window": sanitize_window(m.get("window")),
        "telemetry": sanitize_telemetry(m.get("telemetry")),
        "theme_css": _nonempty_str(m.get("theme_css")),
        "background_css": _nonempty_str(m.get("background_css")),
        "image": _nonempty_str(m.get("image")) or _nonempty_str(m.get("wallpaper")),
    }


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
    # 形态专属字段：合规的照抄，形状不合法一律 null（见 extract_manifest_fields）
    entry.update(extract_manifest_fields(manifest))

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
            # 仓库侧事实（commit / stars / updatedAt / license）本地扫描读不到：
            # 留 null 由 crawl() 或 --local-only 的合并步骤沿用上次真实抓取的值。
            "commit": None,
            "stars": None,
            "updatedAt": None,
            "license": None,
            "unreviewed": False,      # 与目录同源同审
            "capabilities": None,     # 仍未做静态扫描 —— 三态里的"未扫描"
            "topics": [TOPIC],
            "homepage": None,
        })
        out[-1].update(extract_manifest_fields(m))
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


def local_only_catalog(out: Path) -> dict | None:
    """跳过网络，只重建本仓库自带的插件条目，与现有目录合并。

    用途：本仓库新增/修改自己的插件时刷新目录，不需要 GITHUB_TOKEN、也不依赖
    远端 topic 搜索是否成功。远端条目**原样保留** —— 这里不假装重新抓过它们，
    `generatedAt` 也不改动：它记录的是上一次真实全量抓取的时间。
    """
    if not out.exists():
        log(f"找不到现有目录 {out}，--local-only 需要一个基线")
        return None
    try:
        prev = json.loads(out.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        log(f"现有目录解析失败：{e}")
        return None

    prev_by_key = {f"{p.get('repo')}:{p.get('subpath', '')}": p for p in (prev.get("plugins") or [])}
    local = {f"{e['repo']}:{e['subpath']}": e for e in local_entries()}
    # 本地扫描读不到仓库侧事实：同一条目沿用上次真实抓取的值，
    # 否则一次 --local-only 就会把「可定位到某个 commit」悄悄降级成「只知道分支」。
    for key, e in local.items():
        old = prev_by_key.get(key)
        if not old:
            continue
        for f in ("commit", "stars", "updatedAt", "license"):
            if e.get(f) is None and old.get(f) is not None:
                e[f] = old[f]
    # 远端条目原样保留；本仓库的条目以本地 manifest 为准（可新增、可更新）
    kept = [p for key, p in prev_by_key.items() if key not in local]
    final = kept + list(local.values())
    final = sorted(final, key=lambda e: (e.get("unreviewed", True), -(e.get("stars") or 0), e["repo"]))

    return {
        "format": prev.get("format", 1),
        "generatedAt": prev.get("generatedAt"),
        "topic": prev.get("topic", TOPIC),
        "count": len(final),
        "plugins": final,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="抓取 openrevo-plugin topic 生成市场目录")
    ap.add_argument("--dry-run", action="store_true", help="只打印统计，不写文件")
    ap.add_argument("--merge", action="store_true", help="与现有 catalog.json 合并")
    ap.add_argument("--out", default=str(CATALOG), help="输出路径")
    ap.add_argument(
        "--local-only",
        action="store_true",
        help="跳过网络，只重建本仓库自带插件条目并与现有目录合并",
    )
    args = ap.parse_args()

    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not token:
        log("警告：没有 GITHUB_TOKEN，未认证限额 60 次/小时，很可能中途被限速")

    if args.local_only:
        fresh = local_only_catalog(Path(args.out))
        if fresh is None:
            return 1
        log(f"共 {fresh['count']} 条：")
        for p in fresh["plugins"]:
            log(f"  {p['plugin_type']:12s} {p['repo']}:{p.get('subpath','')}")
        Path(args.out).write_text(
            json.dumps(fresh, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        log(f"已写入 {args.out}")
        return 0

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
