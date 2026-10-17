#!/usr/bin/env bash
# 市场插件的验收闸：在等价宿主环境里跑预览页，抓 JS 错误、渲染计数与安装弹窗。
#
# 为什么走 HTTP 而不是 file://：真实宿主里插件文档的基准 URL 是 tauri://localhost
# （一个 http-like origin），fetch 有 CORS 语义。file:// 下 fetch 直接被拒，
# 会让"目录能拉下来"这条路径永远测不到。这里起一个本地 HTTP 服务来对齐语义。
#
#   用法： bash _tools/market-verify.sh [theme]
#   退出码 0 = PASS，非 0 = FAIL（不许交付）
set -u
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/_shots"
mkdir -p "$OUT"
THEME="${1:-cyber}"
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

PAGE="http://127.0.0.1:$PORT/_tools/market-preview.html?theme=$THEME"
PROF="$(mktemp -d)"
"$CHROME" --headless=new --disable-gpu --no-first-run \
  --user-data-dir="$(cygpath -w "$PROF")" --hide-scrollbars \
  --virtual-time-budget=16000 --window-size=1180,880 \
  --screenshot="$(cygpath -w "$OUT/market-$THEME.png")" \
  --dump-dom "$PAGE" > "$OUT/market-$THEME.dom.html" 2>/dev/null

SIZE=$(stat -c%s "$OUT/market-$THEME.png" 2>/dev/null || echo 0)
TITLE=$(grep -o '<title>[^<]*' "$OUT/market-$THEME.dom.html" | head -1 | sed 's/<title>//')
echo "shot:   _shots/market-$THEME.png ($SIZE bytes)"
echo "title:  $TITLE"

python - "$OUT/market-$THEME.dom.html" <<'PY'
import json, re, sys, html
d = open(sys.argv[1], encoding='utf-8', errors='replace').read()
m = re.search(r'<pre id="diag"[^>]*>(.*?)</pre>', d, re.S)
if not m:
    print("diag: NOT FOUND —— 预览页没跑起来"); sys.exit(2)
raw = html.unescape(m.group(1))
try:
    j = json.loads(raw)
except Exception:
    print("diag:", raw[:700]); sys.exit(3)

errs = j.get('errors') or []
modal = j.get('modal') or {}
live = j.get('live') or {}
print(f"ready={j.get('ready')} cards={j.get('cards')} badges={j.get('badges')} "
      f"installed={j.get('installedBadges')}")
print("calls: ", j.get('calls'))
print("filter:", j.get('filterLabels'))
print("meta:  ", (j.get('meta') or '')[:160])
print(f"theme: child={j.get('theme')} parent={j.get('parentTheme')} "
      f"badge={j.get('badgeColor')} sat={j.get('badgeSat')} themeOk={j.get('themeOk')}")
print("modal: ", {k: v for k, v in modal.items() if k != 'cmdHead'})
print("live:  ", {k: v for k, v in live.items() if k != 'noteText'})
print("errors:", len(errs))
for e in errs:
    print("   -", e)

fail = (
    not j.get('ready')
    or j.get('cards', 0) == 0
    or bool(errs)
    or modal.get('modal') != 'open'
    or not modal.get('hasCmd')
    or not modal.get('discItems')
    or live.get('live') != 'clicked'
    # mono 下徽标必须去饱和；cyber 下不强求（themeOk 默认 True）
    or not j.get('themeOk')
)
print("RESULT:", "FAIL" if fail else "PASS")
sys.exit(1 if fail else 0)
PY
