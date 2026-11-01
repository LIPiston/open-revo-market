#!/usr/bin/env bash
# 出「能力文案」对比图：同一份合成目录（capabilities 三态各一条）分别喂给
# 指定修订的产物与当前产物，在等价宿主里各截一张，供人眼核对界面文案。
#
# 用法：
#   bash _tools/cap-wording-shots.sh                 # 默认对比 e2377dd^（文案改动前）
#   bash _tools/cap-wording-shots.sh <rev>           # 对比指定的历史产物
#
# 输出落在 _shots/capwording/，不进 _shots 之外的任何地方。
set -u
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
BASE_REV="${1:-e2377dd^}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/_shots/capwording"
BEFORE="$OUT/_before"
PORT_BEFORE="${PORT_BEFORE:-8793}"
PORT_AFTER="${PORT_AFTER:-8794}"

rm -rf "$BEFORE"
mkdir -p "$OUT" "$BEFORE/_tools" "$BEFORE/plugin-market" "$BEFORE/market"

# 改动前的产物与预览页副本。预览页要一起取旧版，否则「宿主」本身变了就不是单变量对比。
git -C "$ROOT" show "$BASE_REV:plugin-market/index.html" > "$BEFORE/plugin-market/index.html"
cp "$ROOT/_tools/market-preview.html" "$BEFORE/_tools/market-preview.html"

# 合成目录：capabilities 三态各一条。只落在 _shots/，不进 market/catalog.json。
python - "$ROOT/market/catalog.json" "$OUT/cap-catalog.json" <<'PY'
import json, sys
cat = json.load(open(sys.argv[1], encoding='utf-8'))
base = dict(cat['plugins'][0])
out = dict(cat)
out['plugins'] = [
    dict(base, id='synth-unscreened', name='合成未审查', plugin_type='tab',
         repo='example/synth-unscreened', subpath='', sha256=None,
         capabilities=None),
    dict(base, id='synth-clean', name='合成审查未检出', plugin_type='tab',
         repo='example/synth-clean', subpath='', sha256=None,
         capabilities=[]),
    dict(base, id='synth-detected', name='合成审查检出', plugin_type='tab',
         repo='example/synth-detected', subpath='', sha256=None,
         capabilities=['network', 'fs-read']),
]
json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
PY
cp "$OUT/cap-catalog.json" "$BEFORE/market/catalog.json"

# 服务器输出全部丢弃：否则命令替换 `$(serve ...)` 要等服务器退出才返回。
serve() { # root port
  python - "$1" "$2" >/dev/null 2>&1 <<'PY' &
import functools, http.server, socketserver, sys
root, port = sys.argv[1], int(sys.argv[2])
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)
class Q(socketserver.ThreadingTCPServer):
    allow_reuse_address = True; daemon_threads = True
with Q(("127.0.0.1", port), H) as s: s.serve_forever()
PY
  echo $!
}

shoot() { # name root port url-query
  local name="$1" root="$2" port="$3" query="$4" prof
  prof="$(mktemp -d)"
  "$CHROME" --headless=new --disable-gpu --no-first-run --hide-scrollbars \
    --user-data-dir="$(cygpath -w "$prof")" --virtual-time-budget=9000 \
    --window-size=1180,900 \
    --screenshot="$(cygpath -w "$OUT/$name.png")" \
    "http://127.0.0.1:$port/_tools/market-preview.html?theme=cyber&nodiag=1&catalog=local$query" \
    >/dev/null 2>&1
  echo "  $name.png ($(stat -c%s "$OUT/$name.png" 2>/dev/null || echo 0) bytes)"
}

S1=$(serve "$BEFORE" "$PORT_BEFORE"); S2=$(serve "$ROOT" "$PORT_AFTER")
trap 'kill $S1 $S2 2>/dev/null' EXIT
for _ in $(seq 1 40); do
  curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT_BEFORE/_tools/market-preview.html" && \
  curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT_AFTER/_tools/market-preview.html" && break
  sleep 0.25
done

# 两边都用相对路径，避免 Windows 反斜杠进 URL：
# before 根的 market/catalog.json 已被换成合成目录；after 指回 _shots 下那一份。
echo "=== 能力文案对比（base=$BASE_REV）==="
shoot before "$BEFORE" "$PORT_BEFORE" ""
shoot after  "$ROOT"   "$PORT_AFTER"  "&catalogPath=../_shots/capwording/cap-catalog.json"

# 整页截图里那行字只有 11px，不放大等于没给证据。裁出三张卡片的能力行并拼成对照图。
python - "$OUT" <<'PY'
import sys
from pathlib import Path
from PIL import Image

out = Path(sys.argv[1])
# 三张卡片的能力行在 1180x900 视口里的位置
CROPS = [(36, 396, 390, 424), (407, 396, 761, 424), (778, 396, 1144, 424)]
SCALE, PAD = 3, 16


def band(img):
    crops = [img.crop(b) for b in CROPS]
    w = max(c.width for c in crops) * SCALE
    h = sum(c.height * SCALE + PAD for c in crops) + PAD
    sheet = Image.new("RGB", (w + PAD * 2, h), (14, 18, 26))
    y = 0
    for c in crops:
        s = c.resize((c.width * SCALE, c.height * SCALE), Image.LANCZOS)
        sheet.paste(s, (PAD, y))
        y += s.height + PAD
    return sheet


before = Image.open(out / "before.png").convert("RGB")
after = Image.open(out / "after.png").convert("RGB")
b, a = band(before), band(after)
gap = 40
canvas = Image.new("RGB", (b.width + a.width + gap, max(b.height, a.height)), (8, 11, 17))
canvas.paste(b, (0, 0))
canvas.paste(a, (b.width + gap, 0))
canvas.save(out / "crop.png")
print(f"  crop.png ({canvas.width}x{canvas.height})")
PY

echo "输出：$OUT"
