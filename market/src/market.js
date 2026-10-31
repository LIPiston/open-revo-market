/* ============================================================================
 * OpenRevo 插件市场 · 应用逻辑
 * 由 build_market.py 内联进 plugin-market/index.html。
 *
 * 宿主约束（详见 docs/host-and-plugins.md）：
 *  1. `tab` 插件跑在 `srcDoc` iframe（sandbox=allow-scripts allow-forms allow-same-origin），
 *     与宿主**同源** → 可访问 window.parent.__TAURI_INTERNALS__.invoke 与父文档 DOM。
 *  2. 该 iframe **没有** allow-downloads / allow-popups → 下载与 window.open 全部被拦，
 *     所以**下载、解压、落盘全部交给宿主**，市场只发一条 IPC。
 *  3. 宿主能力**按运行时探测**，不按版本号猜：
 *       get_plugin_host_capabilities -> { host_version, can_install, can_uninstall,
 *                                         can_reload, can_open_url, can_write_clipboard,
 *                                         can_read_manifest, can_manage_service }
 *     该命令在旧宿主上不存在 → 自动降级为「复制命令」的交接模式。
 *  4. iframe 是独立文档，宿主 :root 令牌**不继承** → 主题靠读父文档 data-theme 手动镜像。
 *
 * 已核实的 IPC 签名（参数名逐字取自 exe 命令注册表，勿按文档臆改）：
 *   install_plugin_from_url { id, url, subpath?, sha256? }  // id 必需，决定安装目录名
 *   uninstall_plugin        { id }                     // 同 install：字段叫 id，不是 pluginId
 *   reload_plugins          ()                          // 重扫目录，返回插件列表
 *   get_plugin_manifest     { id }                     // 同族命令统一用 id（未单独实测，见下）
 *   set_plugin_enabled_unified { id, enabled }         // 未实测：本市场当前不调用
 *   open_external_url       { url }                     // 仅 http/https
 *   write_clipboard         { text }
 * ========================================================================== */

'use strict';

/* ------------------------------------------------------------------ config */
const CONFIG = {
  // gh-proxy.com 加速前缀：拼在完整 GitHub URL 前面（它按路径代理 github 系域名）。
  // 国内直连 raw.githubusercontent / api.github.com 常常超时，所以每个 GitHub 请求都留了
  // 「直连 → 加速」两条链路：直连失败自动换加速，两条都不行才算失败。
  proxyPrefix: 'https://gh-proxy.com/',
  // 目录（catalog.json）来源，按顺序尝试，第一个成功即用。
  catalogUrls: [
    'https://raw.githubusercontent.com/LIPiston/open-revo-market/main/market/catalog.json',
    'https://gh-proxy.com/https://raw.githubusercontent.com/LIPiston/open-revo-market/main/market/catalog.json',
    'https://cdn.jsdelivr.net/gh/LIPiston/open-revo-market@main/market/catalog.json',
  ],
  searchUrl: 'https://api.github.com/search/repositories',
  // 收录用的 GitHub topic。作者给自己的插件仓库打上它就自动进市场。
  topic: 'openrevo-plugin',
  // 无第三方 API key 时 GitHub 搜索限额 10 次/分钟，做防抖与结果缓存。
  searchDebounceMs: 450,
  catalogTtlMs: 10 * 60 * 1000,
  // 单次请求超时。没有它，被墙的直连会挂到浏览器默认超时，界面看起来就是「卡住」。
  requestTimeoutMs: 8000,
};

/* 内置种子：目录拉不到时（离线 / 还没跑爬虫）也保证市场不是空的。
 * 取决于本仓库当前自带的插件，字段与 catalog.json 条目同构。
 * 注意：构建时 build_market.py 会用 market/catalog.json 整块替换这个常量，
 * 所以这里只是「catalog.json 缺失」时的兜底，两处应保持一致。 */
const SEED = {
  format: 1,
  generatedAt: null,
  source: 'builtin-seed',
  count: 1,
  plugins: [
    {
      id: 'plugin-market', name: '插件市场', version: '1.1.0',
      author: 'LIPiston', plugin_type: 'tab',
      description: '浏览 GitHub 上带 openrevo-plugin topic 的第三方插件，查看能力披露，并给出最短安装路径。',
      repo: 'LIPiston/open-revo-market', subpath: 'plugin-market', branch: 'main',
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
  page: 1,               // 当前页码（1 起）。改筛选/搜索/排序一律回到第 1 页。
  installed: new Set(),  // 已安装插件 id（来自宿主 get_custom_plugins）
  installedMeta: {},     // id -> { plugin_type, enabled }
  hostInfo: null,        // { hasBridge: boolean, error: string|null }
  // 宿主能力位。null = 还没探测到（宿主没有这个命令，或桥断了）。
  // 只有显式为 true 的能力才允许在 UI 上承诺，绝不按版本号猜。
  caps: null,
  busy: null,            // 正在安装/卸载的 entry.id，用于禁用按钮
  // 伴随服务的**查询结果**。宿主不返回「开关态」，只返回 pid/detail，
  // 所以这里存的是「查到了什么」，不是「插件是开还是关」。
  serviceStatus: {},     // id -> { running, pid, detail, error? }
  servicePending: {},    // id -> true：查询在途，防止每帧重发
  // 一键安装是否走 gh-proxy。默认关：宿主是否接受非 github.com 域名未实测，
  // 但国内直连 codeload 常常失败，所以给用户一个显式开关。
  useProxy: false,
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

/** 复制到剪贴板。优先走宿主 IPC（沙盒 iframe 里 navigator.clipboard 常被拦），
 *  再退回 Web API → execCommand。三层都不是冗余：每层都可能单独失效。 */
async function copyText(text) {
  if (state.caps && state.caps.can_write_clipboard === true) {
    try {
      await hostInvoke('write_clipboard', { text });
      return true;
    } catch (_) { /* 掉到下面几层 */ }
  }
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

/** 在系统浏览器里打开链接。沙盒 iframe 没有 allow-popups，window.open 一定返回 null，
 *  所以有宿主 IPC 就用 IPC；没有就退回「复制链接」而不是静默失败。 */
async function openExternal(url) {
  if (state.caps && state.caps.can_open_url === true) {
    try {
      await hostInvoke('open_external_url', { url });
      return true;
    } catch (_) { /* 落到复制 */ }
  }
  const ok = await copyText(url);
  toast(ok ? '已复制链接（本版宿主不能直接打开浏览器）' : '请手动复制链接', !ok);
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
    state.installedMeta = {};
    for (const p of list || []) {
      state.installedMeta[p.id] = { plugin_type: p.plugin_type, enabled: p.enabled };
    }
    state.hostInfo = { hasBridge: true, error: null, count: (list || []).length };
  } catch (e) {
    state.hostInfo = { hasBridge: false, error: String((e && e.message) || e).slice(0, 120) };
  }
}

/** 探测宿主能力位。命令不存在 ⇒ caps 保持 null ⇒ UI 退回「复制命令」交接模式。
 *  这里的关键是**不按版本号猜**：有没有安装接口，不能从版本号字符串看出来。 */
async function probeCapabilities() {
  try {
    const raw = await hostInvoke('get_plugin_host_capabilities');
    if (!raw || typeof raw !== 'object') { state.caps = null; return; }
    state.caps = {
      host_version: raw.host_version || raw.version || null,
      can_install: raw.can_install === true,
      can_uninstall: raw.can_uninstall === true,
      can_reload: raw.can_reload === true,
      can_open_url: raw.can_open_url === true,
      can_write_clipboard: raw.can_write_clipboard === true,
      can_read_manifest: raw.can_read_manifest === true,
      can_manage_service: raw.can_manage_service === true,
    };
  } catch (_) {
    // 宿主没有这条命令（或桥断了）—— 两种都是「不能一键装」，UI 表现一致
    state.caps = null;
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

/** 非空字符串，否则 null。目录里的形态字段只有「写对了」和「没写」两种状态。 */
function strOrNull(v) {
  return typeof v === 'string' && v.trim() ? v : null;
}

/** 正整数（bool 是 int 的子类，得单独挡掉）。 */
function posIntOrNull(v) {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
}

/** 清单里带 id 的对象数组：缺 id 的元素直接丢弃，不猜。 */
function idRowsOrNull(v) {
  if (!Array.isArray(v)) return null;
  const out = v.filter((it) => it && typeof it === 'object' && strOrNull(it.id));
  return out.length ? out : null;
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
    // 可选：可验证安装的完整性指纹。有就透传给宿主，没有就不传 —— 绝不编造。
    sha256: /^[0-9a-f]{64}$/.test(p.sha256 || '') ? p.sha256 : null,
    unreviewed: p.unreviewed !== false,
    capabilities: Array.isArray(p.capabilities) ? p.capabilities : (p.capabilities === null ? null : undefined),
    topics: p.topics || [],
    // 形态专属清单字段：缺失与形状非法都收敛为 null，UI 据此「没声明就不展示」。
    entry: strOrNull(p.entry),
    target_slot: strOrNull(p.target_slot),
    slot_height: strOrNull(p.slot_height),
    min_host_version: strOrNull(p.min_host_version),
    theme_css: strOrNull(p.theme_css),
    background_css: strOrNull(p.background_css),
    image: strOrNull(p.image),
    permissions: Array.isArray(p.permissions)
      ? (p.permissions.filter((x) => strOrNull(x)).length ? p.permissions.filter((x) => strOrNull(x)) : [])
      : null,
    service: (function (s) {
      if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
      const exe = strOrNull(s.executable);
      if (!exe) return null;
      return {
        executable: exe,
        elevated: typeof s.elevated === 'boolean' ? s.elevated : null,
        auto_start: typeof s.auto_start === 'boolean' ? s.auto_start : null,
        auto_stop: typeof s.auto_stop === 'boolean' ? s.auto_stop : null,
        health_url: strOrNull(s.health_url),
        port: posIntOrNull(s.port),
        description: strOrNull(s.description),
      };
    })(p.service),
    shortcuts: idRowsOrNull(p.shortcuts),
    watchers: idRowsOrNull(p.watchers),
    window: (p.window && typeof p.window === 'object' && !Array.isArray(p.window)) ? p.window : null,
    telemetry: (p.telemetry && typeof p.telemetry === 'object' && !Array.isArray(p.telemetry)) ? p.telemetry : null,
  }));
  return {
    format: raw.format || 1,
    generatedAt: raw.generatedAt || null,
    source,
    plugins,
  };
}

/** 带超时的 fetch。被墙的地址不会自己及时失败，没有超时整页就卡在 loading。 */
async function fetchWithTimeout(url, opts) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), CONFIG.requestTimeoutMs) : null;
  try {
    const o = Object.assign({}, opts || {});
    if (ctl) o.signal = ctl.signal;
    return await fetch(url, o);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 把完整 GitHub URL 换成加速地址。非 GitHub 或已带前缀的原样返回。 */
function viaProxy(url) {
  const u = String(url || '');
  if (!CONFIG.proxyPrefix || u.startsWith(CONFIG.proxyPrefix)) return u;
  if (!/^https:\/\/(raw\.githubusercontent\.com|api\.github\.com|codeload\.github\.com|github\.com)\//.test(u)) {
    return u;
  }
  return CONFIG.proxyPrefix + u;
}

async function fetchCatalog() {
  state.loading = true;
  state.error = null;
  render();

  let lastErr = null;
  for (const url of CONFIG.catalogUrls) {
    try {
      const res = await fetchWithTimeout(url, { cache: 'no-cache' });
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
    const direct = `${CONFIG.searchUrl}?q=${q}&per_page=60&sort=updated`;
    // 直连 → 加速：加速地址由 viaProxy() 统一拼前缀，避免把前缀散落到调用点。
    let data = null;
    let lastErr = null;
    for (const url of [direct, viaProxy(direct)]) {
      try {
        const res = await fetchWithTimeout(url, { headers: { Accept: 'application/vnd.github+json' } });
        if (!res.ok) { lastErr = new Error(`GitHub HTTP ${res.status}`); continue; }
        data = await res.json();
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!data) throw lastErr || new Error('GitHub 搜索失败');
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

/* ----------------------------------------------------------------- install */

/** 生成 PowerShell 安装命令 —— 仅在宿主没有安装 IPC 时使用（降级交接路径）。
 *  repo 根目录就是插件时直接 clone 到位，子目录 / monorepo 时 clone 到临时目录再搬。
 *  走 gh-proxy 加速；加速地址不通时，命令里给的直连地址可手动替换（见安装弹窗说明）。 */
function installCommand(entry) {
  const pluginDir = '%APPDATA%\\OpenRevo\\plugins';
  const dest = `${pluginDir}\\${entry.id}`;
  const url = viaProxy(`https://github.com/${entry.repo}.git`);
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

/** 宿主安装器吃的归档地址。必须是 https —— 宿主硬性拒绝 http 与 file。
 *  `useProxy` 时走 gh-proxy：实测它代理的 zip 仍保留 `<repo>-<branch>/` 根目录，
 *  所以 subpath 语义不变；但宿主是否接受非 github.com 域名**未实测**，
 *  因此默认不加速，由用户在安装弹窗里显式勾选。 */
function archiveUrl(entry, useProxy) {
  const branch = entry.branch || 'main';
  const direct = `https://codeload.github.com/${entry.repo}/zip/refs/heads/${encodeURIComponent(branch)}`;
  return useProxy ? viaProxy(direct) : direct;
}

/** GitHub codeload 归档的根目录名：`<repo>-<branch>`（分支里的 `/` 换成 `-`）。
 *  宿主**不会**替你剥掉这一层 —— 它把 `subpath` 直接拼在 `extracted/` 后面去找
 *  `manifest.json`，拼出来的目录不存在就报
 *  `manifest.json not found in resolved content directory: ...\extracted\<subpath>`。 */
function archiveRoot(entry) {
  const branch = entry.branch || 'main';
  const name = (entry.repo || '').split('/').pop() || entry.id;
  return `${name}-${branch.replace(/\//g, '-')}`;
}

/** 真正传给宿主的 `subpath` —— 它是**归档内**路径，不是仓库内路径，
 *  所以必须以归档根目录开头。仓库内 `subpath` 为空（插件就在仓库根）时，
 *  这里传的也是归档根目录那一段。 */
function archiveSubpath(entry) {
  const root = archiveRoot(entry);
  const sub = (entry.subpath || '').replace(/^[\\/]+|[\\/]+$/g, '');
  return sub ? `${root}/${sub}` : root;
}

/** 人看的源码/子目录地址（用于「在浏览器打开」）。 */
function repoUrl(entry) {
  const branch = entry.branch || 'main';
  if (!entry.subpath) return `https://github.com/${entry.repo}`;
  return `https://github.com/${entry.repo}/tree/${branch}/${entry.subpath}`;
}

function canOneClick() {
  return !!(state.caps && state.caps.can_install === true);
}

/** 一键安装：把下载/校验/解压/落盘/热重载全部交给宿主，市场只发一条 IPC。
 *  这是宿主自己实现的安装器（强制 https、可选 sha256、防 Zip Slip、AppData 边界断言）。
 *
 *  参数表逐字取自 exe 命令注册表：{ id, url, subpath?, sha256? }
 *  **`id` 是必需项**（宿主的 serde 缺它直接报
 *  `command install_plugin_from_url missing required key id`），它决定安装后的目录名。
 *  exe 明文里 `id` / `url` 因被其它命令复用而被编译器去重，只有 `subpath` / `sha256`
 *  紧跟在命令名后面 —— 别只照着那个窗口抄。 */
async function installEntry(entry) {
  if (!canOneClick()) throw new Error('本版宿主没有开放安装接口');
  if (state.busy) throw new Error('已有安装任务在进行');
  // id 会成为插件目录名：宿主会拒绝含路径分隔符/上传目录的取值，
  // 这里先按同一口径挡一次，省得把宿主的报错原样甩给用户。
  if (!entry.id || /[\\/\u0000]|\.\./.test(entry.id)) {
    throw new Error(`插件 id 非法，无法安装：${entry.id}`);
  }

  state.busy = entry.id;
  render();

  try {
    const args = { id: entry.id, url: archiveUrl(entry, state.useProxy), subpath: archiveSubpath(entry) };
    if (entry.sha256) args.sha256 = entry.sha256;

    const result = await hostInvoke('install_plugin_from_url', args);

    // 装完立刻重扫，让「已安装」状态与宿主真实目录一致
    await reloadPlugins(true);
    await refreshInstalled();

    const name = (result && (result.id || result.name)) || entry.id;
    toast(`已安装 ${name}`);
    return result;
  } finally {
    state.busy = null;
    render();
  }
}

/** 发一条「以插件 id 为键」的 IPC。
 *
 *  `install_plugin_from_url` 与 `uninstall_plugin` 都经真机 serde 报错确认字段名是 **`id`**
 *  （`command uninstall_plugin missing required key id`）；`pluginId` 在 exe 里只出现一次，
 *  紧跟在 `open_custom_widget` 后面 —— 那是那条命令的字段，不是这一族的。
 *  `get_plugin_manifest` 没单独实测过，所以失败时再试一次 `pluginId`：
 *  serde 校验失败时宿主什么都没做，重试是安全的。
 *  绝不同时传两个键 —— serde 会以 `unknown field` 拒收。 */
async function invokeByPluginId(cmd, id) {
  try {
    return await hostInvoke(cmd, { id });
  } catch (e) {
    if (!/missing required key|invalid args/i.test(String((e && e.message) || e))) throw e;
    return hostInvoke(cmd, { pluginId: id });
  }
}

async function uninstallEntry(entry) {
  if (!(state.caps && state.caps.can_uninstall === true)) {
    throw new Error('本版宿主没有开放卸载接口');
  }
  state.busy = entry.id;
  render();
  try {
    await invokeByPluginId('uninstall_plugin', entry.id);
    await reloadPlugins(true);
    await refreshInstalled();
    toast(`已卸载 ${entry.id}（已移入回收站，可恢复）`);
  } finally {
    state.busy = null;
    render();
  }
}

/** 启用 / 停用。`get_custom_plugins` 不返回 `enabled`，所以市场**不知道**当前态，
 *  只提供两个幂等动作，成功后 toast 也只说「已发送」，不断言当前状态。
 *  exe 里两条命令并存：`set_plugin_enabled_unified`（字段 `id`）与
 *  `set_custom_plugin_enabled`（字段 `pluginId`），前者优先、失败再回退后者。 */
async function setEnabled(entry, enabled) {
  state.busy = entry.id;
  render();
  try {
    const payload = { id: entry.id, enabled };
    try {
      await hostInvoke('set_plugin_enabled_unified', payload);
    } catch (e) {
      if (!/missing required key|invalid args/i.test(String((e && e.message) || e))) throw e;
      await hostInvoke('set_custom_plugin_enabled', { pluginId: entry.id, enabled });
    }
    await reloadPlugins(true);
    await refreshInstalled();
    toast(`已发送${enabled ? '启用' : '停用'}请求：${entry.id}`);
  } finally {
    state.busy = null;
    render();
  }
}

/** 伴随服务状态。只读 `pid` 与 `detail` —— 其余字段未在 exe 里逐字确认，
 *  读了就是在编造宿主行为。`pid` 存在且非空即认为在跑。 */
async function serviceStatus(entry) {
  try {
    const s = await hostInvoke('get_plugin_service_status', { id: entry.id });
    const pid = s && s.pid;
    const running = pid !== null && pid !== undefined && pid !== '';
    const detail = s && typeof s.detail === 'string' ? s.detail : '';
    return { running, pid: running ? pid : null, detail };
  } catch (e) {
    return { running: false, pid: null, detail: '', error: shortErr(e) };
  }
}

/** 服务的启动 / 停止。重启只能 stop + start —— exe 里没有 `restart_plugin_service`。 */
async function controlService(entry, action) {
  if (!canManageService()) throw new Error('本版宿主没有开放服务管理接口');
  state.busy = entry.id;
  render();
  try {
    await hostInvoke(action === 'start' ? 'start_plugin_service' : 'stop_plugin_service', { id: entry.id });
    const st = await serviceStatus(entry);
    state.serviceStatus = state.serviceStatus || {};
    state.serviceStatus[entry.id] = st;
    toast(st.running ? `服务运行中${st.pid ? `（PID ${st.pid}）` : ''}` : '服务已停止');
    render();
  } finally {
    state.busy = null;
    render();
  }
}

/** 生命周期按钮由 render 重建，点击处的 promise 不该飘成未捕获拒绝 ——
 *  失败只弹 toast（卸载弹窗里是同样的写法，这里因为无确认框才需要一个统一出口）。 */
function runLifecycle(p) {
  Promise.resolve(p).catch((e) => toast('操作失败：' + shortErr(e), true));
}

/** 重扫插件目录。宿主支持就发 IPC；不支持则退回 get_custom_plugins（只读枚举）。 */
async function reloadPlugins(silent) {
  if (state.caps && state.caps.can_reload === true) {
    try {
      const list = await hostInvoke('reload_plugins');
      if (Array.isArray(list)) return list;
    } catch (e) {
      if (!silent) toast('重载失败：' + shortErr(e), true);
    }
  }
  try {
    return await hostInvoke('get_custom_plugins');
  } catch (_) {
    return null;
  }
}

function shortErr(e) {
  const s = String((e && (e.message || e)) || e);
  return s.replace(/^Error:\s*/, '').slice(0, 160);
}

/** 读已安装插件的 manifest 原文，与目录里的版本比对，标出「可更新」。
 *  只在宿主声明 can_read_manifest 时做，避免发出宿主不支持的 IPC。 */
async function readInstalledVersions() {
  if (!(state.caps && state.caps.can_read_manifest === true)) return;
  const ids = Array.from(state.installed);
  const updates = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const m = await invokeByPluginId('get_plugin_manifest', id);
      if (m && typeof m === 'object' && m.version) updates[id] = m.version;
    } catch (_) { /* 单个插件读失败不影响其它 */ }
  }));
  state.installedMeta = state.installedMeta || {};
  for (const [id, v] of Object.entries(updates)) {
    state.installedMeta[id] = { ...(state.installedMeta[id] || {}), version: v };
  }
  render();
}

/** 判断已装版本落后于目录版本。版本号比不出来就返回 false —— 不猜。 */
function hasUpdate(entry) {
  const meta = state.installedMeta && state.installedMeta[entry.id];
  if (!meta || !meta.version || !entry.version) return false;
  const a = String(meta.version).split('.').map((x) => parseInt(x, 10) || 0);
  const b = String(entry.version).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return y > x;
  }
  return false;
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

/** 三段数字 SemVer 比较。任一侧解析不出就返回 null —— 调用方据此不渲染徽章，
 *  而不是猜一个版本关系出来。只比 major.minor.patch，预发布标签不收。 */
function cmpSemver(a, b) {
  const pa = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(a || '').trim());
  const pb = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(b || '').trim());
  if (!pa || !pb) return null;
  for (let i = 1; i <= 3; i += 1) {
    const x = Number(pa[i]);
    const y = Number(pb[i]);
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** 兼容性徽章：两侧版本都可解析时才渲染。比不出来就不显示 —— 沉默好过猜。 */
function compatBadge(entry) {
  const need = entry.min_host_version;
  if (!need) return '';
  const have = state.caps && state.caps.host_version;
  const r = cmpSemver(have, need);
  if (r === null) return '';
  if (r < 0) {
    return badge('warn', `需宿主 ≥ ${need} · 当前过低`, I.alert);
  }
  return badge('', `需宿主 ≥ ${need}`, I.shield);
}

/** 清单声明的披露行。只列目录里真的有的字段，缺什么就不提什么。
 *  `permissions` 一律写明「宿主不据此授权」—— 它只是清单自述。 */
function manifestDisclosure(entry) {
  const rows = [];
  const t = entry.plugin_type;

  if (entry.permissions && entry.permissions.length) {
    rows.push({
      label: '清单声明权限',
      text: `${entry.permissions.join('、')}（清单自述，宿主不据此授权）`,
    });
  } else if (entry.permissions && entry.permissions.length === 0) {
    rows.push({ label: '清单声明权限', text: '声明为空（清单自述，宿主不据此授权）' });
  }

  if (entry.shortcuts && entry.shortcuts.length) {
    const combos = entry.shortcuts
      .map((s) => `${s.name || s.id}${s.combo ? `（${s.combo}）` : ''}`)
      .join('、');
    rows.push({ label: `快捷键 ×${entry.shortcuts.length}`, text: combos });
  }

  if (entry.watchers && entry.watchers.length) {
    rows.push({
      label: `监听规则 ×${entry.watchers.length}`,
      text: '由宿主内核调度，不需要插件自己轮询',
    });
  }

  if (t === 'slot') {
    if (entry.target_slot) rows.push({ label: '挂载插槽', text: entry.target_slot });
    if (entry.slot_height) rows.push({ label: '插槽高度', text: entry.slot_height });
  }

  if (t === 'skin' && entry.theme_css) {
    rows.push({ label: '样式表', text: entry.theme_css });
  }

  if (t === 'background') {
    if (entry.background_css) rows.push({ label: '背景样式表', text: entry.background_css });
    if (entry.image) rows.push({ label: '零代码壁纸', text: entry.image });
  }

  if ((t === 'widget' || t === 'tab' || t === 'shell' || t === 'slot') && entry.entry) {
    rows.push({ label: '入口文件', text: entry.entry });
  }

  const win = entry.window;
  if (win && (t === 'widget' || t === 'tab' || t === 'shell' || t === 'skin')) {
    const geo = [];
    if (win.width && win.height) geo.push(`${win.width}×${win.height}`);
    if (win.transparent === true) geo.push('透明');
    if (win.always_on_top === true) geo.push('置顶');
    if (win.skip_taskbar === true) geo.push('跳过任务栏');
    if (win.decorations === true) geo.push('原生标题栏');
    if (win.resizable === true) geo.push('可缩放');
    if (geo.length) rows.push({ label: '视窗', text: geo.join(' · ') });
  }

  const svc = entry.service;
  if (svc) {
    const bits = [svc.executable];
    if (svc.elevated === true) bits.push('管理员提权');
    else if (svc.elevated === false) bits.push('不提权');
    if (svc.port) bits.push(`端口 ${svc.port}`);
    if (svc.health_url) bits.push(`探活 ${svc.health_url}`);
    if (svc.auto_start === true) bits.push('打开即启动');
    if (svc.auto_stop === true) bits.push('关闭即停止');
    rows.push({ label: '伴随服务', text: bits.join(' · ') });
  }

  const tel = entry.telemetry;
  if (tel) {
    if (tel.enabled === false) {
      rows.push({ label: '遥测', text: '清单声明不启用遥测' });
    } else if (Array.isArray(tel.sensors) && tel.sensors.length) {
      rows.push({ label: '遥测传感器', text: tel.sensors.join('、') });
    }
  }

  return rows;
}

/** 披露块：卡片与安装弹窗共用。没有任何可披露项时整块不渲染。 */
function disclosureBlock(entry) {
  const rows = manifestDisclosure(entry);
  if (!rows.length) return '';
  const items = rows
    .map((r) => `<div class="mkt-disc-item info">${I.info}<span><b>${esc(r.label)}</b>：${esc(r.text)}</span></div>`)
    .join('');
  return `<div class="mkt-disc">${items}</div>`;
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

/** 宿主是否声明了服务管理能力。缺这条能力时**不发任何服务类 IPC** ——
 *  旧宿主上 `get_plugin_service_status` 本身就会报错，那行字会变成
 *  「无法查询：command not found」，把「宿主没这个功能」说成「查询失败」。 */
function canManageService() {
  return !!(state.caps && state.caps.can_manage_service === true);
}

/** 服务状态文字。**只写查到的**：没查过就说「未查询」，不猜。
 *  查询是异步的，所以先渲染占位，结果回来只改那一行文字，不整页重渲染
 *  （整页重渲染会打断正在输入搜索框的用户）。 */
function serviceStatusText(entry) {
  if (!canManageService()) return '宿主未开放服务管理';
  const st = state.serviceStatus && state.serviceStatus[entry.id];
  if (!st) return '状态未查询';
  if (st.error) return `无法查询：${st.error}`;
  const bits = [st.running ? '运行中' : '未运行'];
  if (st.running && st.pid) bits.push(`PID ${st.pid}`);
  if (st.detail) bits.push(st.detail);
  return bits.join(' · ');
}

/** 懒查询一次服务状态：同一 id 只发一次，结果更新到已渲染的那一行。 */
function ensureServiceStatus(entry) {
  if (!canManageService()) return;
  state.serviceStatus = state.serviceStatus || {};
  state.servicePending = state.servicePending || {};
  if (state.serviceStatus[entry.id] || state.servicePending[entry.id]) return;
  state.servicePending[entry.id] = true;
  serviceStatus(entry).then((st) => {
    state.serviceStatus[entry.id] = st;
    delete state.servicePending[entry.id];
    const txt = serviceStatusText(entry);
    document.querySelectorAll('[data-svc-status]').forEach((el) => {
      if (el.getAttribute('data-svc-status') === entry.id) el.textContent = txt;
    });
  });
}

/** 生命周期块：只给已装插件。
 *  启用/停用是**两个幂等动作**，不是开关 —— `get_custom_plugins` 不返回 `enabled`，
 *  市场不知道当前态，画成 toggle 就是在撒谎。
 *  服务块只在清单声明了 `service` 时出现；宿主没开放服务管理能力时按钮 disabled，
 *  与「卸载」同一口径：能力缺失要看得见，不是把按钮藏起来。 */
function lifecycleBlock(entry) {
  const dis = state.busy ? 'disabled' : '';
  const id = esc(entry.id);
  let html = `
    <div class="mkt-lifecycle">
      <button class="mkt-btn sm" data-act="enable" data-id="${id}" ${dis}
        title="让宿主重新加载该插件">${I.check}启用</button>
      <button class="mkt-btn sm" data-act="disable" data-id="${id}" ${dis}
        title="停用后插件不再被加载，文件保留">${I.x}停用</button>`;

  if (entry.service) {
    const can = canManageService();
    const sdis = state.busy || !can ? 'disabled' : '';
    const capTitle = can ? '' : '本版宿主没有开放服务管理接口';
    ensureServiceStatus(entry);
    html += `
      <span class="spacer"></span>
      <span class="mkt-lifecycle-svc">
        <span class="dot${can ? '' : ' err'}"></span>
        <span data-svc-status="${id}" title="${capTitle}">${esc(serviceStatusText(entry))}</span>
        <button class="mkt-btn sm" data-act="service-start" data-id="${id}" ${sdis}
          title="${capTitle || '启动伴随服务'}">启动服务</button>
        <button class="mkt-btn sm" data-act="service-stop" data-id="${id}" ${sdis}
          title="${capTitle || '停止伴随服务'}">停止服务</button>
      </span>`;
  }

  return `${html}</div>`;
}

function card(entry) {
  const isInst = state.installed.has(entry.id);
  const isBusy = state.busy === entry.id;
  const upd = hasUpdate(entry);
  const tname = TYPE_LABEL[entry.plugin_type] || entry.plugin_type;
  const rel = relTime(entry.updatedAt);
  const stars = entry.stars === null || entry.stars === undefined
    ? '' : `<span class="mkt-card-stat">${I.star}${entry.stars}</span>`;

  const badges = [
    badge(`type-${entry.plugin_type}`, tname, I.tag),
    entry.version ? badge('', 'v' + entry.version) : '',
    isInst ? badge('ok', '已安装', I.check) : '',
    upd ? badge('warn', '可更新', I.refresh) : '',
    entry.unreviewed ? badge('warn', '未审核', I.alert) : badge('info', '已审核', I.shield),
    entry.commit ? badge('', entry.commit.slice(0, 7)) : '',
  ];
  // 兼容性徽章只在两侧版本都能解析时出现；比不出来就不占位。
  const compat = compatBadge(entry);
  if (compat) badges.push(compat);
  const badgeHtml = badges.filter(Boolean).join('');

  const desc = entry.description
    ? `<div class="mkt-card-desc">${esc(entry.description)}</div>`
    : `<div class="mkt-card-desc empty">作者未填写描述。安装前请自行阅读源码。</div>`;

  const oneClick = canOneClick();
  const mainLabel = isBusy
    ? `${I.refresh}处理中…`
    : (upd ? `${I.refresh}更新` : (isInst ? `${I.check}重装` : `${I.down}安装`));
  const mainCls = isBusy ? '' : (isInst && !upd ? '' : 'primary');

  return `
    <div class="mkt-card${isInst ? ' installed' : ''}${isBusy ? ' busy' : ''}" data-id="${esc(entry.id)}">
      <div class="mkt-card-head">
        <div class="mkt-avatar" style="display:flex;align-items:center;justify-content:center;color:var(--text-dim)">${I.box}</div>
        <div class="mkt-card-titles">
          <div class="mkt-card-name">${esc(entry.name)}</div>
          <div class="mkt-card-id">${esc(entry.repo || entry.id)}${entry.subpath ? '/' + esc(entry.subpath) : ''}</div>
        </div>
      </div>
      <div class="mkt-badges">${badgeHtml}</div>
      ${desc}
      ${disclosureBlock(entry)}
      ${capabilityBlock(entry)}
      ${isInst ? lifecycleBlock(entry) : ''}
      <div class="mkt-card-foot">
        ${stars}
        <span class="mkt-card-stat">${esc(entry.author || '未知作者')}</span>
        ${rel ? `<span class="mkt-card-stat">· ${esc(rel)}</span>` : ''}
        <span class="spacer"></span>
        ${isInst ? `<button class="mkt-btn sm danger" data-act="uninstall" data-id="${esc(entry.id)}"
          ${state.busy || !state.caps || !state.caps.can_uninstall ? 'disabled' : ''}
          title="${state.caps && state.caps.can_uninstall ? '移入回收站并清理配置' : '本版宿主没有开放卸载接口'}">${I.x}卸载</button>` : ''}
        <button class="mkt-btn sm ${mainCls}" data-act="install" data-id="${esc(entry.id)}" ${state.busy ? 'disabled' : ''}>
          ${mainLabel}
        </button>
      </div>
      ${oneClick ? '' : `<div class="mkt-card-hint">${I.info}本版宿主没有安装接口 —— 点【安装】会给出可粘贴的命令。</div>`}
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
    ['service', TYPE_LABEL.service, counts.service || 0],
    ['shell', TYPE_LABEL.shell, counts.shell || 0],
    ['driver', TYPE_LABEL.driver, counts.driver || 0],
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
  // 能力行如实反映探测结果：没探测到就是「未开放」，不按版本号编造
  const capsLine = canOneClick()
    ? `宿主 ${state.caps.host_version || ''} · 支持一键安装`.replace(/\s+/g, ' ').trim()
    : `宿主 ${(state.caps && state.caps.host_version) || ''} 未开放安装接口 · 仅给命令`.replace(/\s+/g, ' ').trim();

  return `
    <div class="mkt-meta">
      <span class="dot ${dot}"></span>
      <span>${esc(note)}</span>
      ${gen ? `<span>· 目录更新于 ${esc(gen)}</span>` : ''}
      <span>· ${esc(bridge)}</span>
      <span>· ${esc(capsLine)}</span>
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
      <div class="d">切到「全部」，挑一个装上。${canOneClick() ? '装完由宿主自动重载，无需重启。' : '装完回到宿主「插件」页点一次刷新即可生效。'}</div></div>`;
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
  const all = filtered();
  const { list, pages, page } = paginate(all);
  const groups = {};
  for (const p of list) (groups[p.unreviewed ? 'unreviewed' : 'reviewed'] = groups[p.unreviewed ? 'unreviewed' : 'reviewed'] || []).push(p);

  let body = '';
  if (state.loading && !all.length) {
    body = `<div class="mkt-grid">${'<div class="mkt-skel"></div>'.repeat(6)}</div>`;
  } else if (!all.length) {
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
      ${pager(pages, page, all.length)}
      <div class="mkt-footer">
        <b>插件是第三方代码，以你的权限运行。</b>本市场只做来源绑定与静态披露，不构成安全审计。
        安装即把代码写入插件目录，卸载即删除对应文件夹 —— 请只安装你信任的来源。
      </div>
    </div>
    <div id="toast" class="mkt-toast" hidden></div>`;

  bind();
}

/* --------------------------------------------------------------- paginate */
const PAGE_SIZE = 12;

/** 把筛选后的列表切成当前页。页码越界（改筛选后条目变少）时夹回最后一页 ——
 *  否则用户会停在一个空页面上，以为市场坏了。 */
function paginate(list) {
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, state.page), pages);
  if (page !== state.page) state.page = page;
  const start = (page - 1) * PAGE_SIZE;
  return { list: list.slice(start, start + PAGE_SIZE), pages, page };
}

/** 页码按钮：首页、末页、当前页 ±1，中间用省略号。
 *  目录真的只有一页时不渲染翻页条（避免给「没内容可翻」的情况加噪音）。 */
function pager(pages, page, total) {
  if (pages <= 1) return '';
  const nums = new Set([1, pages, page - 1, page, page + 1]);
  const shown = [...nums].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const btns = [];
  let prev = 0;
  for (const n of shown) {
    if (prev && n - prev > 1) btns.push('<span class="pg-gap">…</span>');
    btns.push(`<button class="pg${n === page ? ' active' : ''}" data-page="${n}"
      ${n === page ? 'aria-current="page"' : ''}>${n}</button>`);
    prev = n;
  }
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  return `
    <div class="mkt-pager">
      <button class="pg" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} title="上一页">‹</button>
      ${btns.join('')}
      <button class="pg" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} title="下一页">›</button>
      <span class="spacer"></span>
      <span class="pg-info">第 ${from}–${to} 条，共 ${total} 条 · 每页 ${PAGE_SIZE}</span>
    </div>`;
}

function bind() {
  const q = $('#q');
  if (q) {
    // 保持输入焦点与光标位置，避免每次 render 打断输入
    q.addEventListener('input', (e) => {
      state.query = e.target.value;
      state.page = 1;
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
      state.page = 1;   // 换了筛选，页码没有意义了
      render();
    });
  });

  // 翻页：只改页码，然后滚回顶部 —— 否则用户翻到第 2 页还停在上一页的底部
  document.querySelectorAll('[data-page]').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.disabled) return;
      const n = Number(el.getAttribute('data-page'));
      if (!Number.isFinite(n) || n === state.page) return;
      state.page = n;
      render();
      const body = $('.mkt-body');
      if (body) body.scrollTop = 0;
    });
  });

  document.querySelectorAll('[data-act]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const act = el.getAttribute('data-act');
      const id = el.getAttribute('data-id');
      if (act === 'refresh') { refreshAll(); return; }
      if (act === 'open-dir') { openPluginsDir(); return; }
      if (act === 'live') { searchTopicLive(); return; }

      const entry = id ? currentList().find((p) => p.id === id) : null;
      if (!entry) return;

      // 安装一律走弹窗：它本身就是一个确认步骤，而且不依赖 window.confirm。
      // tab iframe 的 sandbox 没有 allow-modals，confirm() 会被静默拦掉并返回 false，
      // 用原生确认框装 = 点了没反应。
      if (act === 'install') openInstallModal(entry);
      else if (act === 'uninstall') openUninstallModal(entry);
      else if (act === 'enable') runLifecycle(setEnabled(entry, true));
      else if (act === 'disable') runLifecycle(setEnabled(entry, false));
      else if (act === 'service-start') runLifecycle(controlService(entry, 'start'));
      else if (act === 'service-stop') runLifecycle(controlService(entry, 'stop'));
    });
  });
}

/** 卸载确认。同样不用 window.confirm（沙盒里没有 allow-modals）。 */
function openUninstallModal(entry) {
  const scrim = document.createElement('div');
  scrim.className = 'mkt-scrim';
  scrim.innerHTML = `
    <div class="mkt-modal" role="dialog" aria-label="卸载插件">
      <div class="mkt-modal-head">
        <div class="mkt-avatar" style="display:flex;align-items:center;justify-content:center;color:var(--text-dim)">${I.box}</div>
        <div style="flex:1;min-width:0">
          <div class="t">卸载「${esc(entry.name && entry.name !== entry.id ? entry.name : entry.id)}」</div>
          <div class="s">${esc(entry.id)}</div>
        </div>
        <button class="mkt-btn sm" data-close="1" title="关闭">${I.x}</button>
      </div>
      <div class="mkt-modal-body">
        <div class="mkt-note">
          ${I.alert}
          <span>插件目录会被<b>移入系统回收站</b>（可恢复），同时从配置中清理它的开关与激活状态。
          正在运行的伴随服务会先被停止。</span>
        </div>
      </div>
      <div class="mkt-modal-foot">
        <button class="mkt-btn" data-close="1">取消</button>
        <span class="spacer"></span>
        <button class="mkt-btn danger" data-act2="uninstall-now">${I.x}确认卸载</button>
      </div>
    </div>`;
  document.body.appendChild(scrim);

  const close = () => scrim.remove();
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  scrim.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));
  scrim.querySelectorAll('[data-act2="uninstall-now"]').forEach((el) => {
    el.addEventListener('click', async () => {
      el.disabled = true;
      try {
        await uninstallEntry(entry);
        close();
      } catch (e) {
        toast('卸载失败：' + shortErr(e), true);
        el.disabled = false;
      }
    });
  });
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

/** 手动刷新：目录 + 已安装 + 能力位一起重取。 */
async function refreshAll() {
  await probeCapabilities();
  await refreshInstalled();
  render();
  await fetchCatalog();
  readInstalledVersions();
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
/** 安装弹窗。宿主支持一键装时走「确认 + 直接装」；否则走「复制命令」的交接模式。
 *  两条路径共用同一张卡片，靠 canOneClick() 切换，不给用户两套心智模型。 */
function openInstallModal(entry) {
  const cmd = installCommand(entry);
  const isInst = state.installed.has(entry.id);
  const tname = TYPE_LABEL[entry.plugin_type] || entry.plugin_type;
  const branch = entry.branch || 'main';
  const oneClick = canOneClick();

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
          ${compatBadge(entry)}
        </div>

        ${manifestDisclosure(entry).length ? `
        <div class="mkt-block">
          <div class="h">清单声明</div>
          ${disclosureBlock(entry)}
        </div>` : ''}

        ${oneClick ? `
        <div class="mkt-note plain">
          ${I.shield}
          <span>宿主会自己完成下载与落盘：<b>强制 HTTPS</b>、解压时校验路径边界（防 Zip Slip）、
          安装目录限制在 OpenRevo 的 AppData 下，装完自动重扫。
          插件是第三方代码，会以你的权限运行 —— 请只安装你信任的来源。</span>
        </div>
        <div class="mkt-block">
          <div class="h">安全提示</div>
          <div class="mkt-steps">
            <div class="mkt-step"><div class="tx">本操作会把 <code>${esc(entry.repo)}</code>${
              entry.subpath ? ` 的 <code>${esc(entry.subpath)}</code> 子目录` : ' 的仓库根'
            }写入 <code>%APPDATA%\\OpenRevo\\plugins\\${esc(entry.id)}\\</code>，同名目录会被覆盖。</div></div>
            <div class="mkt-step"><div class="tx">${entry.sha256
              ? '目录里提供了 <b>sha256</b>，宿主会在安装前校验归档指纹 —— 内容被替换会被拒绝。'
              : '目录条目<b>没有提供 sha256</b>，宿主只能校验传输完整性，不能证明内容未被篡改。'}</div></div>
          </div>
        </div>
        <div class="mkt-block">
          <div class="h">下载链路</div>
          <label class="mkt-check">
            <input type="checkbox" data-opt="proxy" ${state.useProxy ? 'checked' : ''}>
            <span>走 <b>gh-proxy.com</b> 加速（国内直连 codeload 常常超时）</span>
          </label>
          <div class="mkt-note plain" style="margin-top:8px">
            ${I.info}
            <span>加速只改下载地址，不改校验与落盘：宿主仍会强制 HTTPS、校验 sha256、按 subpath 定位插件。
            实测加速后的归档仍保留 <code>${esc(archiveRoot(entry))}/</code> 根目录，因此 <code>subpath</code> 不变。<br/>
            但<b>宿主会不会接受非 github.com 的下载域名尚未实测</b>—— 若开启后报安全策略错误，
            关掉这个开关用直连重试。</span>
          </div>
        </div>` : `
        <div class="mkt-note">
          ${I.alert}
          <span><b>本版宿主没有开放安装接口</b>（<code>get_plugin_host_capabilities</code> 不可用或 <code>can_install=false</code>），
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
        </div>`}

        <div class="mkt-block">
          <div class="h">能力披露</div>
          ${capabilityBlock(entry)}
        </div>

        ${oneClick ? `
        <details class="mkt-fallback">
          <summary>${I.info}一键安装失败？手动安装（备用）</summary>
          <div class="mkt-block">
            <div class="mkt-cmd">${I.copy}<code id="cmd">${esc(cmd)}</code></div>
          </div>
          <div class="mkt-note plain">
            ${I.info}
            <span>也可以直接下载归档，解压后把${
              entry.subpath ? `其中的 <code>${esc(entry.subpath)}</code> 目录` : '全部内容'
            }放进 <code>plugins\\${esc(entry.id)}</code>。<br/>
            <code style="word-break:break-all">${esc(repoUrl(entry))}</code>
            <br/>该地址直连不通时，可在前面加 <code>https://gh-proxy.com/</code> 走加速。</span>
          </div>
        </details>` : `
        <div class="mkt-block">
          <div class="h">安装命令（PowerShell）</div>
          <div class="mkt-cmd">${I.copy}<code id="cmd">${esc(cmd)}</code></div>
        </div>

        <div class="mkt-note plain">
          ${I.info}
          <span>也可以手动下载：把下面的地址贴进浏览器，解压后把${
            entry.subpath ? `其中的 <code>${esc(entry.subpath)}</code> 目录` : '全部内容'
          }放进 <code>plugins\\${esc(entry.id)}</code>。
          <br/><code style="word-break:break-all">${esc(viaProxy(repoUrl(entry)))}</code>
          <br/>直连不通时用上面的加速地址；都不行可去掉 <code>https://gh-proxy.com/</code> 前缀改回直连。</span>
        </div>`}
      </div>

      <div class="mkt-modal-foot">
        <button class="mkt-btn" data-close="1">关闭</button>
        <button class="mkt-btn" data-act2="open-repo">${I.tag}打开源码</button>
        <button class="mkt-btn" data-act2="copy-cmd">${I.copy}复制命令</button>
        <span class="spacer"></span>
        <button class="mkt-btn" data-act2="open-dir">${I.folder}打开插件目录</button>
        ${oneClick
          ? `<button class="mkt-btn primary" data-act2="install-now">${I.down}${isInst ? '重新安装' : '立即安装'}</button>`
          : ''}
      </div>
    </div>`;

  document.body.appendChild(scrim);

  const close = () => scrim.remove();
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  scrim.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));

  // 加速开关：只影响「下载地址」，随时可切；状态存在 state 里，下次打开弹窗沿用。
  const optProxy = scrim.querySelector('[data-opt="proxy"]');
  if (optProxy) {
    optProxy.addEventListener('change', () => { state.useProxy = optProxy.checked; });
  }

  scrim.querySelectorAll('[data-act2]').forEach((el) => {
    el.addEventListener('click', async () => {
      const a = el.getAttribute('data-act2');
      if (a === 'copy-cmd') {
        const ok = await copyText(cmd);
        toast(ok ? '安装命令已复制' : '复制被拦，请手动选中命令后按 Ctrl+C', !ok);
      } else if (a === 'open-repo') {
        openExternal(repoUrl(entry));
      } else if (a === 'open-dir') {
        try { await hostInvoke('open_plugins_dir'); toast('已打开插件目录'); }
        catch (_) { toast('无法打开插件目录：宿主桥不可用', true); }
      } else if (a === 'install-now') {
        el.disabled = true;
        try {
          await installEntry(entry);
          close();
        } catch (e) {
          toast('安装失败：' + shortErr(e), true);
          el.disabled = false;
        }
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

  // 先探测能力再画按钮：能力位决定卡片上是「安装」还是「复制命令」。
  await probeCapabilities();
  await refreshInstalled();
  render();

  fetchCatalog().then(() => readInstalledVersions());
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
