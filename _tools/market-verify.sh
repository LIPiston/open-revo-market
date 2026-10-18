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
  local tag="$THEME-$host"
  # catalog=local：把市场对在线目录的 fetch 劫持到仓库里的 market/catalog.json。
  # 不这样做，验收测的是 GitHub 上的旧目录 —— 本地改了目录但还没 push 时等于没测。
  local page="http://127.0.0.1:$PORT/_tools/market-preview.html?theme=$THEME&host=$host&catalog=local"
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

  python - "$OUT/market-$tag.dom.html" "$host" "$ROOT/market/catalog.json" <<'PY'
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

# 卡片数必须等于本地目录条数 —— 只断言「> 0」会让「目录整个拉丢了」
# 和「目录真的只有 1 条」看起来一样。
want = len(json.load(open(catalog_path, encoding='utf-8'))['plugins'])

errs = j.get('errors') or []
inst = j.get('install') or {}
uninst = j.get('uninstall') or {}
live = j.get('live') or {}

print(f"ready={j.get('ready')} cards={j.get('cards')}/{want} badges={j.get('badges')} "
      f"installed={j.get('installedBadges')}")
print("calls: ", j.get('calls'))
print("filter:", j.get('filterLabels'))
print("meta:  ", (j.get('meta') or '')[:200])
print(f"theme: child={j.get('theme')} parent={j.get('parentTheme')} "
      f"badge={j.get('badgeColor')} sat={j.get('badgeSat')} themeOk={j.get('themeOk')}")
print("install:", {k: v for k, v in inst.items() if k != 'cmdHead'})
print("uninstall:", uninst)
print("live:  ", {k: v for k, v in live.items() if k != 'noteText'})
print("errors:", len(errs))
for e in errs:
    print("   -", e)

# 宿主能力决定成功判据，两条都必须成立：
#   new  → 弹确认窗 → 点【立即安装】→ 真发 install_plugin_from_url，且不依赖 window.confirm
#   old  → 弹窗并给出含 plugins 路径的可粘贴命令
if host == 'new':
    install_ok = (
        inst.get('mode') == 'oneclick'
        and inst.get('install') == 'confirmed'
        and inst.get('invoked')
        and inst.get('usedNativeConfirm') is False
    )
else:
    install_ok = inst.get('mode') == 'legacy' and inst.get('install') == 'modal-open' and inst.get('hasCmd')

fail = (
    not j.get('ready')
    or j.get('cards', 0) != want
    or bool(errs)
    or not install_ok
    or live.get('live') != 'clicked'
    # mono 下徽标必须去饱和；cyber 下不强求（themeOk 默认 True）
    or not j.get('themeOk')
)
print(f"install_ok={install_ok}")
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

if [ "$rc" -eq 0 ]; then echo "ALL PASS ($THEME)"; else echo "FAILED ($THEME)"; fi
exit "$rc"
