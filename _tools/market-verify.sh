#!/usr/bin/env bash
# 市场插件的验收闸：在等价宿主环境里跑预览页，抓 JS 错误、渲染计数与安装路径。
#
# 为什么走 HTTP 而不是 file://：真实宿主里插件文档的基准 URL 是 tauri://localhost
# （一个 http-like origin），fetch 有 CORS 语义。file:// 下 fetch 直接被拒，
# 会让"目录能拉下来"这条路径永远测不到。这里起一个本地 HTTP 服务来对齐语义。
#
# 为什么跑两条宿主路径：市场的行为由 get_plugin_host_capabilities 决定，
# 能力齐全时走一键安装、缺安装 IPC 时走复制命令。两条都得验收，只测一条等于漏测。
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
  local skip_uninst="${5:-}"
  local extra_query="${6:-}"
  local tag="$THEME-$host$suffix"
  # catalog=local：把市场对在线目录的 fetch 劫持到仓库里的 market/catalog.json。
  # 不这样做，验收测的是 GitHub 上的旧目录 —— 本地改了目录但还没 push 时等于没测。
  local page="http://127.0.0.1:$PORT/_tools/market-preview.html?theme=$THEME&host=$host&catalog=local"
  if [ "$cat_rel" != "../market/catalog.json" ]; then
    page="$page&catalogPath=$cat_rel"
  fi
  if [ -n "$extra_query" ]; then
    page="$page&$extra_query"
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

  python - "$OUT/market-$tag.dom.html" "$host" "$cat_file" "$skip_uninst" "$extra_query" <<'PY'
import json, re, sys, html
d = open(sys.argv[1], encoding='utf-8', errors='replace').read()
host = sys.argv[2]
catalog_path = sys.argv[3]
SKIP_UNINSTALL = bool(sys.argv[4]) if len(sys.argv) > 4 else False
EXTRA_QUERY = sys.argv[5] if len(sys.argv) > 5 else ''
EXPECT_PROXY = 'proxy=1' in EXTRA_QUERY
# types=1：这一轮用的是合成目录（service / shell / driver 各一条），
# 要断言三个新形态的筛选按钮与徽标配色真的接上了。
EXPECT_TYPES = 'types=1' in EXTRA_QUERY
# disc=1：这一轮合成一条 slot（带 target_slot）与两条 min_host_version
# （一条高于宿主 → 当前过低，一条低于宿主 → 中性），专验披露与兼容徽章。
EXPECT_DISC = 'disc=1' in EXTRA_QUERY
# compat=1：同一轮里还断言 min_host_version 的两个分支（当前过低 / 满足）。
EXPECT_COMPAT = 'compat=1' in EXTRA_QUERY
# lifecycle=1：这一轮把目录里的条目标成「已装」，专验启用/停用与伴随服务两组按钮。
EXPECT_LIFECYCLE = 'lifecycle=1' in EXTRA_QUERY
# lifecycle=1&service=0：宿主没开放服务管理能力，服务按钮必须 disabled。
EXPECT_NO_SERVICE_CAP = 'lifecycle=1' in EXTRA_QUERY and 'service=0' in EXTRA_QUERY
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
    # 加速开关的断言：勾选后 url 必须带 gh-proxy 前缀，未勾选必须不带。
    # 两条都测，否则「开关存在但没接线」和「默认就偷偷走代理」都验不出来。
    is_proxied = url.startswith('https://gh-proxy.com/')
    proxy_ok = (is_proxied == EXPECT_PROXY)
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
        and proxy_ok
    )
    print("subpath:", sub, "root_ok=", root_ok, "proxy:", is_proxied, "proxy_ok=", proxy_ok)
    if inst.get('mockErrors'):
        print("宿主拒收的调用：", inst['mockErrors'])
    if inst.get('stillOpen'):
        print("安装弹窗未关闭 —— installEntry 抛了：", inst.get('toast'))
else:
    install_ok = inst.get('mode') == 'legacy' and inst.get('install') == 'modal-open' and inst.get('hasCmd')

# 卸载：能力齐全时必须真的发出 uninstall_plugin，参数字段名是 id（不是 pluginId），
# 且弹窗关闭、宿主没拒收。没有卸载接口时按钮 disabled，这里只要求「没有误发」。
if host == 'new':
    ua = uninst.get('args') or {}
    # 分页轮次用的是伪造条目（host 已装列表里没有它们），卡片上本来就没有卸载按钮 ——
    # 那一轮只验滚动与翻页，卸载判据跳过。
    if uninst.get('uninstall') == 'no button':
        uninstall_ok = bool(SKIP_UNINSTALL)
    else:
        uninstall_ok = (
            uninst.get('uninstall') == 'invoked'
            and ua.get('id')
            and not ua.get('pluginId')
            and uninst.get('stillOpen') is False
            and not (uninst.get('mockErrors') or [])
        )
    if uninst.get('mockErrors'):
        print("卸载被宿主拒收：", uninst['mockErrors'])
    if uninst.get('stillOpen'):
        print("卸载弹窗未关闭 —— uninstallEntry 抛了：", uninst.get('toast'))
    print("uninstall_args:", ua, "uninstall_ok=", uninstall_ok)
else:
    uninstall_ok = uninst.get('uninstall') in ('disabled', 'no button', None)
    print("uninstall:", uninst, "uninstall_ok=", uninstall_ok)

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

# 形态专项：合成目录里 service / shell / driver 各一条时，三个筛选按钮都得出现、
# 计数都为 1，且卡片上真的用了对应的徽标类名（否则配色规则写对了也没被引用）。
if EXPECT_TYPES:
    fmap = {f.get('key'): f.get('n') for f in (j.get('filters') or [])}
    seen = set(j.get('badgeTypes') or [])
    missing_btn = [t for t in ('service', 'shell', 'driver') if fmap.get(t) != 1]
    missing_badge = [t for t in ('service', 'shell', 'driver') if f'type-{t}' not in seen]
    types_ok = not missing_btn and not missing_badge
    print("types: filters=", fmap, " badges=", sorted(t for t in seen if t))
    if missing_btn:
        print("缺少筛选按钮或计数不为 1：", missing_btn)
    if missing_badge:
        print("卡片缺少形态徽标类名：", missing_badge)
else:
    types_ok = True

# 披露专项：合成目录里 slot 条目带 target_slot，卡片上必须真的写出它。
# 只断言 DOM 有 .mkt-disc 太弱 —— 披露块存在但内容是空的也照样"有"。
if EXPECT_DISC:
    disc = j.get('discText') or ''
    # 断言的是**给人看的中文标签**与值，而不是字段名：UI 展示「挂载插槽」比
    # 直接印 target_slot 更好读，把断言写成字段名等于把实现细节钉死。
    want_bits = ['挂载插槽', 'power.hardware_limit', '54px']
    missing = [b for b in want_bits if b not in disc]
    disc_ok = not missing
    print("disc: 含", want_bits, "→", "OK" if disc_ok else f"缺 {missing}")
    if not disc_ok:
        print("实际披露文本：", disc[:400])
else:
    disc_ok = True

# 兼容性专项：两条合成条目，min_host_version 高于/低于宿主版本。
#   low  → 需宿主 ≥ 0.0.1，宿主 0.10.0 满足 ⇒ 徽标出现但**不得**含「当前过低」
#   high → 需宿主 ≥ 99.0.0，不满足 ⇒ 徽标必须含「当前过低」
#   bad  → min_host_version 非法（目录不该有，但远端可能写进来）⇒ 任何徽标都不该出现
if EXPECT_COMPAT:
    texts = [t for t in (j.get('badgeTexts') or []) if '需宿主' in t]
    joined = ' | '.join(texts)
    low_ok = any('0.0.1' in t and '当前过低' not in t for t in texts)
    high_ok = any('99.0.0' in t and '当前过低' in t for t in texts)
    bad_ok = not any('BADVER' in t for t in texts)
    compat_ok = low_ok and high_ok and bad_ok
    print(f"compat: low_ok={low_ok} high_ok={high_ok} bad_ok={bad_ok} badges={joined[:200]}")
    if not compat_ok:
        print("兼容性徽标不符合预期：", texts)
else:
    compat_ok = True

# 生命周期专项：合成目录把条目都标成「已装」，专验两组按钮真的接上了线上。
#   启用/停用 → 必须发出 set_plugin_enabled_unified（字段 id + 布尔 enabled），
#                且 enabled 的取值要跟着按钮走（停用 false、启用 true）。
#   伴随服务 → 有 service 声明才画按钮；can_manage_service=false 时必须 disabled。
# 只断言「按钮存在」不够：按钮画了但没接线时市场自己 catch 了异常，errors 里看不到。
life = j.get('lifecycle') or {}
svc = j.get('service') or {}
if EXPECT_LIFECYCLE:
    dis_args = (life.get('disableArgs') or [])
    en_args = (life.get('enableArgs') or [])
    # 停用那一发：字段名必须是 id，enabled 必须是 False（不是字符串 'false'）
    dis_ok = any(
        a.get('id') and a.get('enabled') is False and not a.get('pluginId')
        and a.get('via') is None
        for a in dis_args
    )
    en_ok = any(
        a.get('id') and a.get('enabled') is True and not a.get('pluginId')
        and a.get('via') is None
        for a in en_args
    )
    life_ok = dis_ok and en_ok and not (life.get('mockErrors') or [])
    if EXPECT_NO_SERVICE_CAP:
        # 能力缺失时按钮要画出来但 disabled —— 藏起来等于骗用户「宿主支持」。
        # 同时**一条服务类 IPC 都不许发**：旧宿主上 get_plugin_service_status 本身
        # 就会报错，那行字会变成「无法查询：command not found」，
        # 把「宿主没这个功能」误报成「查询失败」。
        svc_calls = [c for c in (j.get('calls') or [])
                     if c in ('get_plugin_service_status',
                              'start_plugin_service', 'stop_plugin_service')]
        cap_gate_ok = bool(life.get('hasServiceBtns')) and bool(life.get('serviceDisabled')) \
            and svc.get('service') == 'disabled' and not svc_calls
        if not cap_gate_ok:
            print("服务能力缺失时的处理不符合预期：", {
                'hasServiceBtns': life.get('hasServiceBtns'),
                'serviceDisabled': life.get('serviceDisabled'),
                'service': svc.get('service'),
                '误发的服务 IPC': svc_calls,
            })
    else:
        # 能力齐全时点了【启动服务】必须真发 IPC，状态文字要转成有内容的一行
        cap_gate_ok = (
            bool((svc.get('afterStart') or []))
            and svc.get('service') == 'clicked'
            and bool(svc.get('statusAfterStart'))
            and not (svc.get('mockErrors') or [])
        )
        if not cap_gate_ok:
            print("服务启停不符合预期：", svc)
    life_ok = life_ok and cap_gate_ok
    print(f"lifecycle: dis_ok={dis_ok} en_ok={en_ok} cap_gate_ok={cap_gate_ok} "
          f"status={svc.get('statusAfterStart')!r}")
    if not dis_ok or not en_ok:
        print("启停 IPC 不符合预期：disable=", dis_args, " enable=", en_args)
else:
    life_ok = True

fail = (
    not j.get('ready')
    or j.get('cards', 0) != want_cards
    or bool(errs)
    or not install_ok
    or not uninstall_ok
    or not scroll_ok
    or not paging_ok
    or live.get('live') != 'clicked'
    # mono 下徽标必须去饱和；cyber 下不强求（themeOk 默认 True）
    or not j.get('themeOk')
    or not types_ok
    or not disc_ok
    or not compat_ok
    or not life_ok
)
print(f"install_ok={install_ok} uninstall_ok={uninstall_ok} "
      f"scroll_ok={scroll_ok} paging_ok={paging_ok} types_ok={types_ok} "
      f"disc_ok={disc_ok} compat_ok={compat_ok} life_ok={life_ok}")
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
  # 第三条：勾上「走 gh-proxy 加速」再装一次，断言 url 真的换了地址。
  # 只测直连会漏掉「开关画了但没接线」，只测加速会漏掉「默认偷偷走代理」。
  echo "=== 加速开关专项（?proxy=1）==="
  run_one new "../market/catalog.json" "$ROOT/market/catalog.json" "-proxy" "" "proxy=1" || rc=1
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
run_one new "../_shots/_big-catalog.json" "$BIG" "-paged" "skip-uninstall" || rc=1
rm -f "$BIG" "$OUT/market-$THEME-new-paged.png" "$OUT/market-$THEME-new-paged.dom.html"

# 第三条闸：合成目录只放 service / shell / driver 各一条，专验新增形态的筛选与配色。
# 真实目录里现在没有这三种形态的插件，不合成的话「筛选按钮画了没接线」
# 与「徽标配色写了没引用」都验不出来。合成的目录只落在 _shots/，不进 market/catalog.json。
TYPES="$ROOT/_shots/_type-catalog.json"
python - "$ROOT/market/catalog.json" "$TYPES" <<'PY'
import json, sys
cat = json.load(open(sys.argv[1], encoding='utf-8'))
base = dict(cat['plugins'][0])
out = dict(cat)
out['plugins'] = [
    dict(base, id='synth-service', name='合成无头服务', plugin_type='service',
         repo='example/synth-service', subpath='', sha256=None),
    dict(base, id='synth-shell', name='合成完整外壳', plugin_type='shell',
         repo='example/synth-shell', subpath='', sha256=None),
    dict(base, id='synth-driver', name='合成硬件驱动', plugin_type='driver',
         repo='example/synth-driver', subpath='', sha256=None),
]
json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
PY
echo "=== 形态筛选专项（service / shell / driver）==="
run_one new "../_shots/_type-catalog.json" "$TYPES" "-types" "skip-uninstall" "types=1" || rc=1
rm -f "$TYPES" "$OUT/market-$THEME-new-types.png" "$OUT/market-$THEME-new-types.dom.html"

# 第四条闸：披露 + 兼容性徽章。合成目录放一条 slot（带 target_slot / slot_height）
# 与三条 min_host_version 不同的条目，专验「披露文本真的写出来了」与徽章两个分支。
# 合成条目只落在 _shots/，不进 market/catalog.json。
DISC="$ROOT/_shots/_disc-catalog.json"
python - "$ROOT/market/catalog.json" "$DISC" <<'PY'
import json, sys
cat = json.load(open(sys.argv[1], encoding='utf-8'))
base = dict(cat['plugins'][0])
out = dict(cat)
out['plugins'] = [
    dict(base, id='synth-slot', name='合成微插槽', plugin_type='slot',
         repo='example/synth-slot', subpath='', sha256=None,
         target_slot='power.hardware_limit', slot_height='54px',
         entry='index.html', permissions=['power:control']),
    dict(base, id='synth-low', name='合成低版本要求', plugin_type='tab',
         repo='example/synth-low', subpath='', sha256=None,
         min_host_version='0.0.1'),
    dict(base, id='synth-high', name='合成高版本要求', plugin_type='tab',
         repo='example/synth-high', subpath='', sha256=None,
         min_host_version='99.0.0'),
    dict(base, id='synth-bad', name='合成非法版本要求', plugin_type='tab',
         repo='example/synth-bad', subpath='', sha256=None,
         min_host_version='BADVER'),
]
json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
PY
echo "=== 披露/兼容性专项（slot 披露 + 版本过低两分支）==="
run_one new "../_shots/_disc-catalog.json" "$DISC" "-disc" "skip-uninstall" "disc=1&compat=1" || rc=1
rm -f "$DISC" "$OUT/market-$THEME-new-disc.png" "$OUT/market-$THEME-new-disc.dom.html"

# 第五条闸：生命周期（启用/停用 + 伴随服务）。
# 目录里放一条带 `service` 声明的条目，并用 ?installed= 把它标成已装 ——
# 只有已装插件的卡片才会渲染启停按钮，否则这两组按钮永远测不到。
LIFE="$ROOT/_shots/_life-catalog.json"
python - "$ROOT/market/catalog.json" "$LIFE" <<'PY'
import json, sys
cat = json.load(open(sys.argv[1], encoding='utf-8'))
base = dict(cat['plugins'][0])
out = dict(cat)
out['plugins'] = [
    dict(base, id='synth-life', name='合成有服务插件', plugin_type='service',
         repo='example/synth-life', subpath='', sha256=None,
         service={'executable': 'synth-life.exe', 'auto_start': True}),
]
json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
PY
echo "=== 生命周期专项（启用/停用 + 服务启停）==="
run_one new "../_shots/_life-catalog.json" "$LIFE" "-life" "" \
  "lifecycle=1&installed=synth-life" || rc=1
rm -f "$OUT/market-$THEME-new-life.png" "$OUT/market-$THEME-new-life.dom.html"

# 第六条闸：宿主没有 can_manage_service 时，服务按钮必须 disabled 而不是消失。
# 「藏起来」会让用户以为宿主支持，点不了才发现 —— 与卸载按钮同一口径。
# 目录沿用上一条的 $LIFE（此时还没删），只换宿主能力位。
echo "=== 服务能力缺失专项（?service=0）==="
run_one new "../_shots/_life-catalog.json" "$LIFE" "-nocap" "" \
  "lifecycle=1&service=0&installed=synth-life" || rc=1
rm -f "$LIFE" "$OUT/market-$THEME-new-nocap.png" "$OUT/market-$THEME-new-nocap.dom.html"

if [ "$rc" -eq 0 ]; then echo "ALL PASS ($THEME)"; else echo "FAILED ($THEME)"; fi
exit "$rc"
