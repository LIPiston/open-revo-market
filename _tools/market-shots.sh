#!/usr/bin/env bash
# 出图：目录页 + 安装弹窗，各在 cyber / mono 两套主题下。
# 用法： bash _tools/market-shots.sh
set -u
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/_shots"; mkdir -p "$OUT"
PORT="${PORT:-8792}"
python - "$ROOT" "$PORT" <<'PY' &
import functools, http.server, socketserver, sys
root, port = sys.argv[1], int(sys.argv[2])
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)
class Q(socketserver.ThreadingTCPServer):
    allow_reuse_address = True; daemon_threads = True
with Q(("127.0.0.1", port), H) as s: s.serve_forever()
PY
SRV=$!; trap 'kill $SRV 2>/dev/null' EXIT
for _ in $(seq 1 40); do curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/_tools/market-preview.html" && break; sleep 0.25; done

shoot() { # name theme extraquery w h
  local name="$1" theme="$2" extra="$3" w="$4" h="$5" prof
  prof="$(mktemp -d)"
  "$CHROME" --headless=new --disable-gpu --no-first-run --hide-scrollbars \
    --user-data-dir="$(cygpath -w "$prof")" --virtual-time-budget=9000 \
    --window-size="$w,$h" \
    --screenshot="$(cygpath -w "$OUT/$name.png")" \
    "http://127.0.0.1:$PORT/_tools/market-preview.html?theme=$theme&nodiag=1$extra" >/dev/null 2>&1
  echo "  $name.png ($(stat -c%s "$OUT/$name.png" 2>/dev/null || echo 0) bytes)"
}
shoot market-clean-cyber cyber  "" 1180 880
shoot market-clean-mono  mono   "" 1180 880
shoot market-modal-cyber cyber  "&modal=1" 1180 880
