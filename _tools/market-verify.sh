#!/usr/bin/env bash
# 市场插件的验收闸：在等价宿主环境里跑预览页，抓 JS 错误、渲染计数与安装路径。
#
# 为什么走 HTTP 而不是 file://：真实宿主里插件文档的基准 URL 是 tauri://localhost
# （一个 http-like origin），fetch 有 CORS 语义。file:// 下 fetch 直接被拒，
# 会让"目录能拉下来"这条路径永远测不到。这里起一个本地 HTTP 服务来对齐语义。
#
# 为什么跑两条宿主路径：市场的行为由 get_plugin_host_capabilities 决定，
# 新宿主走一键安装、老宿主走复制命令。两条都得验收，只测一条等于漏测。
#
#   用法： bash _tools/market-verify.sh [theme] [host]
#          theme = cyber|mono|light   （默认 cyber）
#          host  = new|old            （默认 new；省略时两条都跑）
#   退出码 0 = PASS，非 0 = FAIL（不许交付）
set -u
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/_shots"
mkdir -p "$OUT"
THEME="${1:-cyber}"
HOST_ONLY="${2:-}"
PORT="${PORT:-8791}"

# 起静态服务（只监听回环），指向仓库根 —— 预览页用相对路径取 plugin-market/index.html
python - "$ROOT" "$PORT" <<'PY' &
import functools, http.server, socketserver, sys
root, port = sys.argv[1], int(sys.argv[2])
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)
class Q(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
with Q(("127.0.0.1", port), Handler) as srv:
    srv.serve_forever()
PY
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT

# 等端口就绪
for _ in $(seq 1 40); do
  if curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/_tools/market-preview.html"; then break; fi
  sleep 0.25
done

run_one() {
  local host="$1"
  local cat_rel="${2:-../market/catalog.json}"   # 预览页里的相对路径
  local cat_file="${3:-$ROOT/market/catalog.json}"
  local suffix="${4:-}"
  local tag="$THEME-$host$suffix"
  # catalog=local：把市场对在线目录的 fetch 劫持到仓库里的 market/catalog.json。
  # 不这样做，验收测的是 GitHub 上的旧目录 —— 本地改了目录但还没 push 时等于没测。
  local page="http://127.0.0.1:$PORT/_tools/market-preview.html?theme=$THEME&host=$host&catalog=local"
  if [ "$cat_rel" != "../market/catalog.json" ]; then
    page="$page&catalogPath=$cat_rel"
  fi
  local prof
  prof="$(mktemp -d)"
  "$CHROME" --headless=new --disable-gpu --no-first-run \
    --user-data-dir="$(cygpath -w "$prof")" --hide-scrollbars \
    --virtual-time-budget=16000 --window-size=1180,880 \
    --screenshot="$(cygpath -w "$OUT/market-$tag.png")" \
    --dump-dom "$page" > "$OUT/market-$tag.dom.html" 2>/dev/null
  rm -rf "$prof"

  local size
  size=$(stat -c%s "$OUT/market-$tag.png" 2>/dev/null || echo 0)
  echo "=== host=$host  shot: _shots/market-$tag.png ($size bytes) ==="

  python - "$OUT/market-$tag.dom.html" "$host" "$cat_file" <<'PY'
import json, re, sys, html
d = open(sys.argv[1], encoding='utf-8', errors='replace').read()
host = sys.argv[2]
catalog_path = sys.argv[3]
m = re.search(r'<pre id="diag"[^>]*>(.*?)</pre>', d, re.S)
if not m:
    print("diag: NOT FOUND —— 预览页没跑起来"); sys.exit(2)
raw = html.unescape(m.group(1))
try:
    j = json.loads(raw)
except Exception:
    print("diag:", raw[:700]); sys.exit(3)

# 卡片数必须等于本地目录条数（条目多于一页时等于每页条数）——
# 只断言「> 0」会让「目录整个拉丢了」和「目录真的只有 1 条」看起来一样。
PAGE_SIZE = 12
want = len(json.load(open(catalog_path, encoding='utf-8'))['plugins'])
want_cards = min(want, PAGE_SIZE)

errs = j.get('errors') or []
inst = j.get('install') or {}
uninst = j.get('uninstall') or {}
live = j.get('live') or {}
scroll = j.get('scroll') or {}
pag = j.get('pager') or {}

print(f"ready={j.get('ready')} cards={j.get('cards')}/{want_cards} badges={j.get('badges')} "
      f"installed={j.get('installedBadges')}")
print("calls: ", j.get('calls'))
print("filter:", j.get('filterLabels'))
print("meta:  ", (j.get('meta') or '')[:200])
print(f"theme: child={j.get('theme')} parent={j.get('parentTheme')} "
      f"badge={j.get('badgeColor')} sat={j.get('badgeSat')} themeOk={j.get('themeOk')}")
print("install:", {k: v for k, v in inst.items() if k != 'cmdHead'})
print("uninstall:", uninst)
print("live:  ", {k: v for k, v in live.items() if k != 'noteText'})
print("scroll:", scroll)
print("paging:", pag)
print("errors:", len(errs))
for e in errs:
    print("   -", e)

# 宿主能力决定成功判据，两条都必须成立：
#   new  → 弹确认窗 → 点【立即安装】→ 真发 install_plugin_from_url，且不依赖 window.confirm
#          并且宿主没拒参数（mockErrors 空）、参数里确实带了 id，
#          且 subpath 是**归档内**路径（必须以 codeload 的 `repo-<branch>/` 开头）
#   old  → 弹窗并给出含 plugins 路径的可粘贴命令
if host == 'new':
    a = inst.get('args') or {}
    sub = a.get('subpath') or ''
    # subpath 是**归档内**路径：必须等于 codeload 的归档根目录，或以 `根/` 开头。
    # 从 url 反推期望的根，而不是硬编码 '-main' —— 否则根目录插件（无子目录）会误判。
    import re as _re
    url = a.get('url') or ''
    mm = _re.search(r'codeload\.github\.com/[^/]+/([^/]+)/zip/refs/heads/(.+)$', url)
    exp_root = (mm.group(1) + '-' + mm.group(2).replace('/', '-')) if mm else None
    root_ok = bool(sub) and bool(exp_root) and (sub == exp_root or sub.startswith(exp_root + '/'))
    install_ok = (
        inst.get('mode') == 'oneclick'
        and inst.get('install') == 'confirmed'
        and inst.get('invoked')
        and inst.get('usedNativeConfirm') is False
        and inst.get('stillOpen') is False
        and not (inst.get('mockErrors') or [])
        and a.get('id')
        and a.get('url')
        and root_ok
    )
    print("subpath:", sub, "root_ok=", root_ok)
    if inst.get('mockErrors'):
        print("宿主拒收的调用：", inst['mockErrors'])
    if inst.get('stillOpen'):
        print("安装弹窗未关闭 —— installEntry 抛了：", inst.get('toast'))
else:
    install_ok = inst.get('mode') == 'legacy' and inst.get('install') == 'modal-open' and inst.get('hasCmd')

# 滚动与翻页：条目超过一页时必须**真的**能滚、能翻。
# 反例是实测出来的：#app 没设 height 时 .mkt 退化成 auto，
# .mkt-body 的 scrollHeight == clientHeight，一屏塞不下就整页卡死。
# pag = 快照里的翻页条（页数/当前页）；pgx = 真的点了一次「下一页」的结果。
pgx = j.get('paging') or {}
if want > PAGE_SIZE:
    pages_expect = -(-want // PAGE_SIZE)      # ceil
    scroll_ok = bool(scroll.get('can')) and scroll.get('overflow') in ('auto', 'scroll')
    paging_ok = (
        pag.get('pages') == pages_expect
        and pag.get('current') == 1
        and pgx.get('paging') == 'clicked'
        and pgx.get('startPage') == 1
        and pgx.get('endPage') == 2
        and pgx.get('endCards') == min(PAGE_SIZE, want - PAGE_SIZE)
        and pgx.get('topAfter') == 0          # 翻页要回顶部
    )
    if not scroll_ok:
        print(f"滚动失败：body {scroll.get('h')}/{scroll.get('sh')} overflow={scroll.get('overflow')}")
    if not paging_ok:
        print("翻页失败：pager=", pag, " 点击结果=", pgx)
    print(f"pages_expect={pages_expect} scroll_ok={scroll_ok} paging_ok={paging_ok}")
else:
    # 单页时不该出现翻页条（没内容可翻）
    scroll_ok = True
    paging_ok = pag.get('paging') in (None, 'no pager')

fail = (
    not j.get('ready')
    or j.get('cards', 0) != want_cards
    or bool(errs)
    or not install_ok
    or not scroll_ok
    or not paging_ok
    or live.get('live') != 'clicked'
    # mono 下徽标必须去饱和；cyber 下不强求（themeOk 默认 True）
    or not j.get('themeOk')
)
print(f"install_ok={install_ok} scroll_ok={scroll_ok} paging_ok={paging_ok}")
print("RESULT:", "FAIL" if fail else "PASS")
sys.exit(1 if fail else 0)
PY
}

rc=0
if [ -n "$HOST_ONLY" ]; then
  run_one "$HOST_ONLY" || rc=1
else
  run_one new || rc=1
  run_one old || rc=1
fi

# 第二条闸：用一份「条目多到必须翻页」的临时目录再跑一次。
# 单页目录永远不会触发翻页代码，也测不出滚动容器是否真的被约束住 ——
# 实测踩过：#app 缺 height 时 scrollHeight == clientHeight，插件多时整页滚不动。
BIG="$ROOT/_shots/_big-catalog.json"
python - "$ROOT/market/catalog.json" "$BIG" <<'PY'
import json, sys
cat = json.load(open(sys.argv[1], encoding='utf-8'))
base = cat['plugins'][0]
out = dict(cat)
out['plugins'] = [dict(base, id=f'bulk-{i:02d}', name=f'批量条目 {i:02d}',
                       repo=f'example/bulk-{i:02d}', subpath='', sha256=None) for i in range(30)]
json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
PY
echo "=== 分页/滚动专项（30 条，每页 12）==="
run_one new "../_shots/_big-catalog.json" "$BIG" "-paged" || rc=1
rm -f "$BIG" "$OUT/market-$THEME-new-paged.png" "$OUT/market-$THEME-new-paged.dom.html"

if [ "$rc" -eq 0 ]; then echo "ALL PASS ($THEME)"; else echo "FAILED ($THEME)"; fi
exit "$rc"
