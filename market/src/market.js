/* ============================================================================
 * OpenRevo 插件市场 · 应用逻辑
 * 由 build_market.py 内联进 plugin-market/index.html。
 *
 * 宿主约束（v0.9.1 实测，详见 docs/reference/market-host-constraints.md）：
 *  1. `tab` 插件跑在 `srcDoc` iframe（sandbox=allow-scripts allow-forms allow-same-origin），
 *     与宿主**同源** → 可访问 window.parent.__TAURI_INTERNALS__.invoke 与父文档 DOM。
 *  2. 该 iframe **没有** allow-downloads / allow-popups → 下载与 window.open 全部被拦。
 *     所以「一键下载安装」在本版宿主上做不到，只能做「复制命令 + 打开目录」的交接。
 *  3. 命令表里**没有** install_plugin / uninstall_plugin / 写插件目录的 IPC（实测 0 命中），
 *     也没有 fs/dialog/shell 等 Tauri 插件 —— 不要在 UI 里承诺做不到的事。
 *  4. iframe 是独立文档，宿主 :root 令牌**不继承** → 主题靠读父文档 data-theme 手动镜像。
 * ========================================================================== */

'use strict';

/* ------------------------------------------------------------------ config */
const CONFIG = {
  // 目录（catalog.json）来源，按顺序尝试，第一个成功即用。
  catalogUrls: [
    'https://raw.githubusercontent.com/LIPiston/open-revo-plugins/main/market/catalog.json',
    'https://cdn.jsdelivr.net/gh/LIPiston/open-revo-plugins@main/market/catalog.json',
  ],
  // 收录用的 GitHub topic。作者给自己的插件仓库打上它就自动进市场。
  topic: 'openrevo-plugin',
  // 无第三方 API key 时 GitHub 搜索限额 10 次/分钟，做防抖与结果缓存。
  searchDebounceMs: 450,
  catalogTtlMs: 10 * 60 * 1000,
};

/* 内置种子：目录拉不到时（离线 / 还没跑爬虫）也保证市场不是空的。
 * 取决于本仓库当前自带的插件，字段与 catalog.json 条目同构。
 * 注意：构建时 build_market.py 会用 market/catalog.json 整块替换这个常量，
 * 所以这里只是「catalog.json 缺失」时的兜底，两处应保持一致。 */
const SEED = {
  format: 1,
  generatedAt: null,
  source: 'builtin-seed',
  count: 2,
  plugins: [
    {
      id: 'bg-custom', name: '自定义背景图', version: '1.0.0',
      author: 'OpenRevo Fluent Skin Kit', plugin_type: 'skin',
      description: '只提供背景图，不改动宿主默认界面（独立于任何皮肤）。由 build_background.py 生成。',
      repo: 'LIPiston/open-revo-plugins', subpath: 'bg-custom', branch: 'main',
      stars: null, unreviewed: false, capabilities: null,
    },
    {
      id: 'plugin-market', name: '插件市场', version: '1.0.0',
      author: 'LIPiston', plugin_type: 'tab',
      description: '浏览 GitHub 上带 openrevo-plugin topic 的第三方插件，查看能力披露，并给出最短安装路径。',
      repo: 'LIPiston/open-revo-plugins', subpath: 'plugin-market', branch: 'main',
      stars: null, unreviewed: false, capabilities: null,
    },
  ],
};

const TYPE_LABEL = {
  skin: '主窗皮肤', background: '背景壁纸', tab: '面板插槽',
  widget: '桌面挂件', slot: '微插槽', service: '无头服务',
  shell: '完整外壳', driver: '硬件驱动',
};

const CAP_LABEL = {
  network: '联网', 'fs-read': '读取本地文件', 'fs-write': '写入本地文件',
  shell: '启动进程', env: '读取环境变量', credentials: '读取凭据',
  'dynamic-code': '动态执行代码', 'host-runtime': '宿主运行时',
};

/* 危险组合：逐条用扫描器的话写，不给总分、不做安全评分。 */
const CAP_RISK = [
  { need: ['credentials', 'network'], text: '既能读取凭据又有联网能力 —— 凭据理论上可被外发。' },
  { need: ['shell'], text: '可启动本机进程，行为不受宿主约束。' },
  { need: ['fs-write'], text: '可写入本机文件。' },
  { need: ['dynamic-code'], text: '会动态执行代码，静态审阅看不出最终行为。' },
];

/* ------------------------------------------------------------------- icons */
const I = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 2.9 5.9 6.1.9-4.5 4.3 1.1 6.1L12 17.3 6.4 20.2l1.1-6.1L3 9.8l6.1-.9z"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12"/><path d="m7 12 5 5 5-5"/><path d="M5 20h14"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12 5 5L20 6"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 21v-8"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 4 2 20h20z"/><path d="M12 10v4"/><path d="M12 17.5h.01"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.4"/></svg>',
};

/* ------------------------------------------------------------------- state */
const state = {
  catalog: null,
  source: 'seed',        // 'seed' | 'remote' | 'cache'
  generatedAt: null,
  loading: false,
  error: null,
  query: '',
  typeFilter: 'all',     // 'all' | plugin_type | '__installed__' | '__unreviewed__'
  sort: 'stars',         // 'stars' | 'name' | 'updated'
  installed: new Set(),  // 已安装插件 id（来自宿主 get_custom_plugins）
  hostInfo: null,        // { hasBridge: boolean, error: string|null }
  live: null,            // 实时 topic 搜索结果
  liveLoading: false,
  liveError: null,
};

/* ------------------------------------------------------------------- utils */
const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function relTime(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = Math.floor((Date.now() - t) / 86400000);
  if (d <= 0) return '今天';
  if (d === 1) return '昨天';
  if (d < 30) return `${d} 天前`;
  if (d < 365) return `${Math.floor(d / 30)} 个月前`;
  return `${Math.floor(d / 365)} 年前`;
}

let toastTimer = null;
function toast(msg, isErr) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'mkt-toast' + (isErr ? ' err' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/** 复制到剪贴板。srcDoc iframe 里 navigator.clipboard 可能被权限拦，
 *  所以准备三层：异步 API → execCommand → 选中文本让用户手按 Ctrl+C。 */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext !== false) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* 落到下一层 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) return true;
  } catch (_) { /* 落到最后一层 */ }
  return false;
}

/* ------------------------------------------------------------------ bridge */
/** 访问父窗口的 Tauri 桥。tab iframe 与宿主同源，所以这条路走得通；
 *  若宿主哪天改了 sandbox 或跨源策略，这里会安全降级为 hasBridge=false。 */
function hostInvoke(cmd, args) {
  try {
    const p = window.parent;
    if (p && p.__TAURI_INTERNALS__ && typeof p.__TAURI_INTERNALS__.invoke === 'function') {
      return p.__TAURI_INTERNALS__.invoke(cmd, args);
    }
    if (p && p.__OPENREVO_BRIDGE__ && typeof p.__OPENREVO_BRIDGE__.invoke === 'function') {
      return p.__OPENREVO_BRIDGE__.invoke(cmd, args);
    }
  } catch (e) {
    return Promise.reject(e);
  }
  return Promise.reject(new Error('bridge-unavailable'));
}

/** 读已安装插件，用于在卡片上打「已安装」并支持按安装状态筛选。
 *  get_custom_plugins 是只读命令，任何形态的插件都能安全调用。 */
async function refreshInstalled() {
  try {
    const list = await hostInvoke('get_custom_plugins');
    state.installed = new Set((list || []).map((p) => p.id));
    state.hostInfo = { hasBridge: true, error: null, count: (list || []).length };
  } catch (e) {
    state.hostInfo = { hasBridge: false, error: String((e && e.message) || e).slice(0, 120) };
  }
}

/* --------------------------------------------------------------- theme sync */
/** iframe 是独立文档，宿主令牌不继承。读父文档的 data-theme 镜像过来，
 *  这样在 cyber / mono / 未来 light 皮肤下市场观感都跟着走。 */
function syncTheme() {
  try {
    const de = window.parent && window.parent.document && window.parent.document.documentElement;
    const theme = (de && de.getAttribute('data-theme')) || 'cyber';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (_) {
    document.documentElement.setAttribute('data-theme', 'cyber');
  }
}
function watchTheme() {
  syncTheme();
  try {
    const de = window.parent.document.documentElement;
    new MutationObserver(syncTheme).observe(de, { attributes: true, attributeFilter: ['data-theme'] });
  } catch (_) { /* 跨源或不可达时忽略 */ }
}

/* --------------------------------------------------------- catalog loading */
function cacheKey() { return 'openrevo-market-catalog-v1'; }

function readCache() {
  try {
    const raw = localStorage.getItem(cacheKey());
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || !o.plugins) return null;
    return o;
  } catch (_) { return null; }
}

function writeCache(payload) {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify({ ...payload, _cachedAt: Date.now() }));
  } catch (_) { /* 配额满或隐私模式，忽略 */ }
}

function normalizeCatalog(raw, source) {
  const plugins = (raw.plugins || []).map((p) => ({
    id: p.id || (p.repo || '').replace('/', '__'),
    name: p.name || p.id || p.repo,
    version: p.version || '',
    author: p.author || '',
    plugin_type: p.plugin_type || p.type || 'tab',
    description: p.description || '',
    repo: p.repo || '',
    subpath: p.subpath || '',
    branch: p.branch || 'main',
    commit: p.commit || null,
    stars: typeof p.stars === 'number' ? p.stars : null,
    updatedAt: p.updatedAt || null,
    license: p.license || null,
    unreviewed: p.unreviewed !== false,
    capabilities: Array.isArray(p.capabilities) ? p.capabilities : (p.capabilities === null ? null : undefined),
    topics: p.topics || [],
  }));
  return {
    format: raw.format || 1,
    generatedAt: raw.generatedAt || null,
    source,
    plugins,
  };
}

async function fetchCatalog() {
  state.loading = true;
  state.error = null;
  render();

  let lastErr = null;
  for (const url of CONFIG.catalogUrls) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      const raw = await res.json();
      if (!raw || !Array.isArray(raw.plugins)) { lastErr = new Error('目录格式不正确'); continue; }
      state.catalog = normalizeCatalog(raw, 'remote');
      state.source = 'remote';
      state.generatedAt = raw.generatedAt || null;
      state.error = null;
      writeCache(raw);
      state.loading = false;
      render();
      return;
    } catch (e) {
      lastErr = e;
    }
  }

  // 在线目录全都拿不到：保留现有兜底数据，只把失败原因如实写进 meta 行。
  // 绝不把"没连上"伪装成"目录里没有插件"。
  state.loading = false;
  state.error = (lastErr && lastErr.message) || '无法获取在线目录';
  render();
}

/* ------------------------------------------------------------- live search */
/** 直接查 GitHub topic —— 作者打上 topic 后不用等爬虫，市场就能看到。
 *  未认证限额较低，所以按需触发、结果缓存，失败不影响主流程。 */
async function searchTopicLive() {
  if (state.liveLoading) return;
  state.liveLoading = true;
  state.liveError = null;
  render();
  try {
    const q = encodeURIComponent(`topic:${CONFIG.topic}`);
    const res = await fetch(
      `https://api.github.com/search/repositories?q=${q}&per_page=60&sort=updated`,
      { headers: { Accept: 'application/vnd.github+json' } }
    );
    if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
    const data = await res.json();
    const known = new Set((state.catalog ? state.catalog.plugins : []).map((p) => p.repo));
    state.live = (data.items || [])
      .filter((r) => !known.has(r.full_name))
      .map((r) => ({
        id: (r.name || '').toLowerCase(),
        name: r.name,
        version: '',
        author: (r.owner && r.owner.login) || r.full_name.split('/')[0],
        plugin_type: 'tab',
        description: r.description || '',
        repo: r.full_name,
        subpath: '',
        branch: r.default_branch || 'main',
        commit: null,
        stars: r.stargazers_count,
        updatedAt: r.pushed_at || r.updated_at,
        license: r.license && r.license.spdx_id,
        unreviewed: true,
        capabilities: null,   // 实时结果未扫描：三态里的「未扫描」，不能显示成「未检出」
        topics: r.topics || [],
        live: true,
      }));
  } catch (e) {
    state.liveError = String((e && e.message) || e).slice(0, 140);
  } finally {
    state.liveLoading = false;
    render();
  }
}

/* --------------------------------------------------------- install command */
function shellQuote(s) { return `"${String(s).replace(/"/g, '\\"')}"`; }

/** 生成 PowerShell 安装命令。
 *  宿主没有安装 IPC，所以这里只生成「用户在终端里粘一次」的命令；
 *  repo 根目录就是插件时直接 clone 到位，子目录 / monorepo 时 clone 到临时目录再搬。 */
function installCommand(entry) {
  const pluginDir = '%APPDATA%\\OpenRevo\\plugins';
  const dest = `${pluginDir}\\${entry.id}`;
  const url = `https://github.com/${entry.repo}.git`;
  const branch = entry.branch || 'main';

  if (!entry.subpath) {
    return [
      `$d = "$env:APPDATA\\OpenRevo\\plugins\\${entry.id}"`,
      `git clone --depth 1 --branch ${branch} ${url} $d`,
      `Remove-Item -Recurse -Force "$d\\.git" -ErrorAction SilentlyContinue`,
      `Write-Host "已安装 ${entry.id} → $d"`,
    ].join('; ');
  }

  const sub = entry.subpath.replace(/\\/g, '/');
  const leaf = sub.split('/').pop();
  return [
    `$t = Join-Path $env:TEMP ("orv-" + [guid]::NewGuid().ToString("N"))`,
    `git clone --depth 1 --branch ${branch} ${url} $t`,
    `$d = "$env:APPDATA\\OpenRevo\\plugins\\${entry.id}"`,
    `if (Test-Path $d) { Remove-Item -Recurse -Force $d }`,
    `Move-Item (Join-Path $t "${sub.replace(/\//g, '\\')}") $d`,
    `Remove-Item -Recurse -Force $t -ErrorAction SilentlyContinue`,
    `Write-Host "已安装 ${entry.id} → $d"`,
  ].join('; ');
}

function zipUrl(entry) {
  if (!entry.subpath) {
    return `https://codeload.github.com/${entry.repo}/zip/refs/heads/${entry.branch || 'main'}`;
  }
  return `https://github.com/${entry.repo}/tree/${entry.branch || 'main'}/${entry.subpath}`;
}

/* ------------------------------------------------------------------ render */
function currentList() {
  const base = state.catalog ? state.catalog.plugins.slice() : [];
  const live = state.live || [];
  return base.concat(live);
}

function filtered() {
  const q = state.query.trim().toLowerCase();
  let list = currentList();

  if (state.typeFilter === '__installed__') {
    list = list.filter((p) => state.installed.has(p.id));
  } else if (state.typeFilter === '__unreviewed__') {
    list = list.filter((p) => p.unreviewed);
  } else if (state.typeFilter !== 'all') {
    list = list.filter((p) => p.plugin_type === state.typeFilter);
  }

  if (q) {
    list = list.filter((p) => (
      (p.name || '').toLowerCase().includes(q)
      || (p.description || '').toLowerCase().includes(q)
      || (p.repo || '').toLowerCase().includes(q)
      || (p.author || '').toLowerCase().includes(q)
      || (p.id || '').toLowerCase().includes(q)
    ));
  }

  const s = state.sort;
  list.sort((a, b) => {
    if (s === 'name') return String(a.name).localeCompare(String(b.name), 'zh');
    if (s === 'updated') return (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
    // stars：取不到（null）的排最后，绝不当作 0 参与比较
    const av = a.stars === null || a.stars === undefined ? -1 : a.stars;
    const bv = b.stars === null || b.stars === undefined ? -1 : b.stars;
    return bv - av;
  });
  return list;
}

function typeCounts() {
  const list = currentList();
  const c = { all: list.length, __installed__: 0, __unreviewed__: 0 };
  for (const p of list) {
    c[p.plugin_type] = (c[p.plugin_type] || 0) + 1;
    if (state.installed.has(p.id)) c.__installed__ += 1;
    if (p.unreviewed) c.__unreviewed__ += 1;
  }
  return c;
}

function badge(cls, text, icon) {
  return `<span class="mkt-badge ${cls}">${icon || ''}${esc(text)}</span>`;
}

function capabilityBlock(entry) {
  const caps = entry.capabilities;
  let items;

  if (caps === undefined || entry.live) {
    // 三态之一：没扫过。不能渲染成「未检出」。
    items = `<div class="mkt-disc-item info">${I.info}<span><b>未扫描</b> —— 该条目尚未做静态能力扫描，下面的清单不代表实际行为。</span></div>`;
  } else if (caps === null) {
    items = `<div class="mkt-disc-item info">${I.info}<span><b>未扫描</b> —— 尚未做静态能力扫描。</span></div>`;
  } else if (caps.length === 0) {
    items = `<div class="mkt-disc-item">${I.shield}<span><b>未检出</b> —— 静态扫描未发现联网、文件写入等能力。</span></div>`;
  } else {
    const list = caps.map((c) => CAP_LABEL[c] || c).join('、');
    items = `<div class="mkt-disc-item">${I.shield}<span>静态扫描检出：<b>${esc(list)}</b></span></div>`;
  }

  const risks = Array.isArray(caps)
    ? CAP_RISK.filter((r) => r.need.every((n) => caps.includes(n)))
    : [];
  for (const r of risks) {
    items += `<div class="mkt-disc-item warn">${I.alert}<span>${esc(r.text)}</span></div>`;
  }
  return `<div class="mkt-disc">${items}</div>`;
}

function card(entry) {
  const isInst = state.installed.has(entry.id);
  const tname = TYPE_LABEL[entry.plugin_type] || entry.plugin_type;
  const rel = relTime(entry.updatedAt);
  const stars = entry.stars === null || entry.stars === undefined
    ? '' : `<span class="mkt-card-stat">${I.star}${entry.stars}</span>`;

  const badges = [
    badge(`type-${entry.plugin_type}`, tname, I.tag),
    entry.version ? badge('', 'v' + entry.version) : '',
    isInst ? badge('ok', '已安装', I.check) : '',
    entry.unreviewed ? badge('warn', '未审核', I.alert) : badge('info', '已审核', I.shield),
    entry.commit ? badge('', entry.commit.slice(0, 7)) : '',
  ].filter(Boolean).join('');

  const desc = entry.description
    ? `<div class="mkt-card-desc">${esc(entry.description)}</div>`
    : `<div class="mkt-card-desc empty">作者未填写描述。安装前请自行阅读源码。</div>`;

  return `
    <div class="mkt-card${isInst ? ' installed' : ''}" data-id="${esc(entry.id)}">
      <div class="mkt-card-head">
        <div class="mkt-avatar" style="display:flex;align-items:center;justify-content:center;color:var(--text-dim)">${I.box}</div>
        <div class="mkt-card-titles">
          <div class="mkt-card-name">${esc(entry.name)}</div>
          <div class="mkt-card-id">${esc(entry.repo || entry.id)}${entry.subpath ? '/' + esc(entry.subpath) : ''}</div>
        </div>
      </div>
      <div class="mkt-badges">${badges}</div>
      ${desc}
      ${capabilityBlock(entry)}
      <div class="mkt-card-foot">
        ${stars}
        <span class="mkt-card-stat">${esc(entry.author || '未知作者')}</span>
        ${rel ? `<span class="mkt-card-stat">· ${esc(rel)}</span>` : ''}
        <span class="spacer"></span>
        <button class="mkt-btn sm ${isInst ? '' : 'primary'}" data-act="install" data-id="${esc(entry.id)}">
          ${isInst ? I.check + '重装' : I.down + '安装'}
        </button>
      </div>
    </div>`;
}

function toolbar() {
  const counts = typeCounts();
  const filters = [
    ['all', '全部', counts.all],
    ['skin', TYPE_LABEL.skin, counts.skin || 0],
    ['background', TYPE_LABEL.background, counts.background || 0],
    ['tab', TYPE_LABEL.tab, counts.tab || 0],
    ['widget', TYPE_LABEL.widget, counts.widget || 0],
    ['slot', TYPE_LABEL.slot, counts.slot || 0],
    ['__installed__', '已安装', counts.__installed__],
    ['__unreviewed__', '未审核', counts.__unreviewed__],
  ].filter((f) => f[0] === 'all' || f[0] === '__installed__' || f[0] === '__unreviewed__' || f[2] > 0);

  return `
    <div class="mkt-bar">
      <div class="mkt-search">${I.search}
        <input id="q" type="search" placeholder="搜索插件名称、作者、仓库或描述…" value="${esc(state.query)}" spellcheck="false" />
      </div>
      <button class="mkt-btn" data-act="refresh" title="重新获取目录">${I.refresh}刷新</button>
      <button class="mkt-btn" data-act="open-dir" title="在资源管理器中打开插件目录">${I.folder}插件目录</button>
      <button class="mkt-btn" data-act="live" title="直接查询 GitHub topic，发现尚未被收录的新插件">${I.tag}实时发现</button>
    </div>
    <div class="mkt-sources">
      ${filters.map(([k, label, n]) =>
        `<button class="mkt-src${state.typeFilter === k ? ' active' : ''}" data-filter="${k}">${esc(label)}<span class="n">${n}</span></button>`
      ).join('')}
    </div>`;
}

function metaLine() {
  const n = filtered().length;
  const cat = state.catalog;
  const srcLabel = {
    remote: '在线目录', cache: '本地缓存', seed: '内置目录',
  }[state.source] || state.source;

  let dot = 'ok';
  let note = `${srcLabel} · ${cat ? cat.plugins.length : 0} 条`;
  if (state.loading) { note = '正在获取目录…'; }
  else if (state.error) {
    dot = 'warn';
    note += `（未连上在线目录：${state.error}）`;
  } else if (state.source === 'seed') { dot = 'warn'; note += '（内置快照）'; }
  else if (state.source === 'cache') { dot = 'warn'; note += '（上次成功的缓存）'; }

  const gen = relTime(state.generatedAt);
  const bridge = state.hostInfo && state.hostInfo.hasBridge
    ? `宿主桥已连接 · 已装 ${state.installed.size} 个`
    : '宿主桥不可用（无法识别已安装）';

  return `
    <div class="mkt-meta">
      <span class="dot ${dot}"></span>
      <span>${esc(note)}</span>
      ${gen ? `<span>· 目录更新于 ${esc(gen)}</span>` : ''}
      <span>· ${esc(bridge)}</span>
      <span class="spacer"></span>
      <code>topic:${esc(CONFIG.topic)}</code>
    </div>`;
}

function emptyBlock() {
  const q = state.query.trim();
  if (q) {
    return `<div class="mkt-empty">${I.search}<div class="t">没有匹配「${esc(q)}」的插件</div>
      <div class="d">换个关键词，或点「实时发现」直接去 GitHub 上找带 <code>${esc(CONFIG.topic)}</code> topic 的仓库。</div></div>`;
  }
  if (state.typeFilter === '__installed__') {
    return `<div class="mkt-empty">${I.box}<div class="t">还没有安装任何第三方插件</div>
      <div class="d">切到「全部」，挑一个装上。装完回到宿主「插件」页点一次刷新即可生效。</div></div>`;
  }
  return `<div class="mkt-empty">${I.box}<div class="t">市场里还没有插件</div>
    <div class="d">给插件仓库打上 <code>${esc(CONFIG.topic)}</code> topic，它就会在下次爬取后自动出现在这里；
    也可以点「实时发现」立刻查看。</div></div>`;
}

function liveBanner() {
  if (state.liveLoading) {
    return `<div class="mkt-note plain">${I.refresh}<span>正在查询 GitHub topic <code>${esc(CONFIG.topic)}</code>…</span></div>`;
  }
  if (state.liveError) {
    return `<div class="mkt-note">${I.alert}<span>实时发现失败：${esc(state.liveError)}<br/>
      未认证的 GitHub 搜索接口限速较紧（约 10 次/分钟），稍后再试。</span></div>`;
  }
  if (state.live && state.live.length) {
    return `<div class="mkt-note plain">${I.info}<span>实时发现到 <b>${state.live.length}</b> 个尚未收录的仓库。
      它们没有经过任何检查，也未读取 manifest，安装前请自行阅读源码。</span></div>`;
  }
  if (state.live && state.live.length === 0) {
    return `<div class="mkt-note plain">${I.info}<span>GitHub 上暂时没有新的 <code>${esc(CONFIG.topic)}</code> 仓库。</span></div>`;
  }
  return '';
}

function render() {
  const list = filtered();
  const groups = {};
  for (const p of list) (groups[p.unreviewed ? 'unreviewed' : 'reviewed'] = groups[p.unreviewed ? 'unreviewed' : 'reviewed'] || []).push(p);

  let body = '';
  if (state.loading && !list.length) {
    body = `<div class="mkt-grid">${'<div class="mkt-skel"></div>'.repeat(6)}</div>`;
  } else if (!list.length) {
    body = emptyBlock();
  } else {
    if (groups.reviewed && groups.reviewed.length) {
      body += `<div class="mkt-section-title">已审核 · ${groups.reviewed.length}</div>
        <div class="mkt-grid">${groups.reviewed.map(card).join('')}</div>`;
    }
    if (groups.unreviewed && groups.unreviewed.length) {
      body += `<div class="mkt-section-title">未审核（topic 自动收录）· ${groups.unreviewed.length}</div>
        <div class="mkt-grid">${groups.unreviewed.map(card).join('')}</div>`;
    }
  }

  $('#app').innerHTML = `
    <div class="mkt">
      ${toolbar()}
      ${metaLine()}
      <div class="mkt-body">${liveBanner()}${body}</div>
      <div class="mkt-footer">
        <b>插件是第三方代码，以你的权限运行。</b>本市场只做来源绑定与静态披露，不构成安全审计。
        安装即把代码写入插件目录，卸载即删除对应文件夹 —— 请只安装你信任的来源。
      </div>
    </div>
    <div id="toast" class="mkt-toast" hidden></div>`;

  bind();
}

function bind() {
  const q = $('#q');
  if (q) {
    // 保持输入焦点与光标位置，避免每次 render 打断输入
    q.addEventListener('input', (e) => {
      state.query = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const nq = $('#q');
      if (nq) { nq.focus(); nq.setSelectionRange(pos, pos); }
    });
  }

  document.querySelectorAll('[data-filter]').forEach((el) => {
    el.addEventListener('click', () => {
      state.typeFilter = el.getAttribute('data-filter');
      state.live = null;
      render();
    });
  });

  document.querySelectorAll('[data-act]').forEach((el) => {
    el.addEventListener('click', () => {
      const act = el.getAttribute('data-act');
      const id = el.getAttribute('data-id');
      if (act === 'refresh') fetchCatalog();
      else if (act === 'open-dir') openPluginsDir();
      else if (act === 'live') searchTopicLive();
      else if (act === 'install') {
        const entry = currentList().find((p) => p.id === id);
        if (entry) openInstallModal(entry);
      }
    });
  });
}

async function openPluginsDir() {
  try {
    await hostInvoke('open_plugins_dir');
    toast('已打开插件目录');
  } catch (e) {
    toast('无法打开插件目录：宿主桥不可用', true);
  }
}

/* ------------------------------------------------------------------- modal */
function openInstallModal(entry) {
  const cmd = installCommand(entry);
  const isInst = state.installed.has(entry.id);
  const tname = TYPE_LABEL[entry.plugin_type] || entry.plugin_type;
  const branch = entry.branch || 'main';

  const scrim = document.createElement('div');
  scrim.className = 'mkt-scrim';
  scrim.innerHTML = `
    <div class="mkt-modal" role="dialog" aria-label="安装插件">
      <div class="mkt-modal-head">
        <div class="mkt-avatar" style="display:flex;align-items:center;justify-content:center;color:var(--text-dim)">${I.box}</div>
        <div style="flex:1;min-width:0">
          <div class="t">${isInst ? '重新安装' : '安装'}「${esc(entry.name)}」</div>
          <div class="s">${esc(entry.repo)}${entry.subpath ? ' / ' + esc(entry.subpath) : ''} @ ${esc(branch)}</div>
        </div>
        <button class="mkt-btn sm" data-close="1" title="关闭">${I.x}</button>
      </div>

      <div class="mkt-modal-body">
        <div class="mkt-badges">
          ${badge(`type-${entry.plugin_type}`, tname, I.tag)}
          ${entry.version ? badge('', 'v' + entry.version) : ''}
          ${entry.license ? badge('', entry.license) : ''}
          ${entry.commit ? badge('info', 'commit ' + entry.commit.slice(0, 10)) : badge('', branch)}
          ${entry.unreviewed ? badge('warn', '未审核', I.alert) : badge('info', '已审核', I.shield)}
          ${isInst ? badge('ok', '已安装 · 将被覆盖', I.check) : ''}
        </div>

        <div class="mkt-note">
          ${I.alert}
          <span><b>本版宿主（v0.9.1）没有开放安装接口</b>，插件目录也没有文件写入 IPC，
          因此市场不能替你完成下载。下面的命令是市场能给出的最短路径：复制它、在终端粘一次即可。</span>
        </div>

        <div class="mkt-block">
          <div class="h">安装步骤</div>
          <div class="mkt-steps">
            <div class="mkt-step"><div class="tx">点下面的 <b>复制安装命令</b>。<br/>
              它会把 <code>${esc(entry.repo)}</code> 的 ${entry.subpath ? `子目录 <code>${esc(entry.subpath)}</code>` : '仓库内容'}
              放到 <code>%APPDATA%\\OpenRevo\\plugins\\${esc(entry.id)}\\</code>。</div></div>
            <div class="mkt-step"><div class="tx">在 <b>PowerShell</b> 里粘贴并回车（需要本机已装 <code>git</code>）。</div></div>
            <div class="mkt-step"><div class="tx">回到宿主侧边栏的 <b>插件</b> 页，点右上角 <b>刷新</b>。
              ${entry.plugin_type === 'skin' ? '皮肤还需在卡片上拨一次开关才会启用。' : '装好后即出现在列表里。'}</div></div>
            <div class="mkt-step"><div class="tx">想卸载：删掉 <code>plugins\\${esc(entry.id)}</code> 文件夹，再回插件页刷新。</div></div>
          </div>
        </div>

        <div class="mkt-block">
          <div class="h">安装命令（PowerShell）</div>
          <div class="mkt-cmd">${I.copy}<code id="cmd">${esc(cmd)}</code></div>
        </div>

        <div class="mkt-block">
          <div class="h">能力披露</div>
          ${capabilityBlock(entry)}
        </div>

        <div class="mkt-note plain">
          ${I.info}
          <span>手动下载也行：把下面的地址贴进浏览器，解压后把${
            entry.subpath ? `其中的 <code>${esc(entry.subpath)}</code> 目录` : '全部内容'
          }放进 <code>plugins\\${esc(entry.id)}</code>。
          <br/><code style="word-break:break-all">${esc(zipUrl(entry))}</code></span>
        </div>
      </div>

      <div class="mkt-modal-foot">
        <button class="mkt-btn" data-close="1">关闭</button>
        <button class="mkt-btn" data-act2="copy-url">复制下载地址</button>
        <span class="spacer"></span>
        <button class="mkt-btn" data-act2="open-dir">${I.folder}打开插件目录</button>
        <button class="mkt-btn primary" data-act2="copy-cmd">${I.copy}复制安装命令</button>
      </div>
    </div>`;

  document.body.appendChild(scrim);

  const close = () => scrim.remove();
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  scrim.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));

  scrim.querySelectorAll('[data-act2]').forEach((el) => {
    el.addEventListener('click', async () => {
      const a = el.getAttribute('data-act2');
      if (a === 'copy-cmd') {
        const ok = await copyText(cmd);
        toast(ok ? '安装命令已复制' : '复制被拦，请手动选中命令后按 Ctrl+C', !ok);
      } else if (a === 'copy-url') {
        const ok = await copyText(zipUrl(entry));
        toast(ok ? '下载地址已复制' : '复制被拦，请手动抄写地址', !ok);
      } else if (a === 'open-dir') {
        try { await hostInvoke('open_plugins_dir'); toast('已打开插件目录'); }
        catch (_) { toast('无法打开插件目录：宿主桥不可用', true); }
      }
    });
  });

  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

/* -------------------------------------------------------------------- init */
async function init() {
  watchTheme();

  // 先用上次成功的缓存，其次内置目录 —— 打开即有内容，网络在后台补。
  const cached = readCache();
  if (cached) {
    state.catalog = normalizeCatalog(cached, 'cache');
    state.source = 'cache';
    state.generatedAt = cached.generatedAt || null;
  } else {
    state.catalog = normalizeCatalog(SEED, 'seed');
    state.source = 'seed';
  }
  render();

  await refreshInstalled();
  render();

  fetchCatalog();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
