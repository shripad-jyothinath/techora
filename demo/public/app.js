/* ==========================================================================
   Techcora ERP Console — frontend
   Vanilla ES modules. No build step, so a reviewer can read everything.
   Design: light theme, Techcora orange, Funnel Sans + Orbitron numerals.
   ========================================================================== */

/* ------------------------------------------------------------------ helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const moneyFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (n) => moneyFmt.format(Number(n) || 0);
const fmtMoneyCompact = (n) => {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return moneyFmt.format(v);
};
const fmtQty = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(String(iso).length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const fmtDateTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return `${fmtDate(iso)}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
const shortId = (id, n = 8) => (id ? `${String(id).slice(0, n)}…` : '—');
const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

const toast = (title, body = '', kind = 'ok', ms = 4200) => {
  const host = $('#toasts');
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.innerHTML = `<div><div class="t-title">${esc(title)}</div>${body ? `<div class="t-body">${body}</div>` : ''}</div>
    <span class="t-progress" style="animation-duration:${ms}ms"></span>`;
  host.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .3s';
    setTimeout(() => node.remove(), 320);
  }, ms);
};

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Count-up animation for KPI values (skipped when hidden / reduced motion). */
function animateMoney(el, value, compact = true) {
  if (!el) return;
  const fmt = (v) => `$${compact ? fmtMoneyCompact(v) : fmtMoney(v)}`;
  const final = Number(value) || 0;
  if (prefersReducedMotion || document.hidden || final === 0) {
    el.textContent = fmt(final);
    return;
  }
  const t0 = performance.now();
  const dur = 420;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const eased = 1 - (1 - p) ** 3;
    el.textContent = fmt(final * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  // rAF is throttled/paused in background tabs — make sure the number lands anyway
  setTimeout(() => {
    if (el.isConnected && el.textContent !== fmt(final)) el.textContent = fmt(final);
  }, dur + 250);
}

/** Themed confirm dialog (replaces window.confirm). */
function confirmDialog({ title, body = '', confirmText = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const host = $('#modal');
    host.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal card" role="dialog" aria-modal="true">
          <h2>${esc(title)}</h2>
          ${body ? `<p class="muted">${esc(body)}</p>` : ''}
          <div class="modal-actions">
            <button class="btn" type="button" data-act="cancel">Cancel</button>
            <button class="btn ${danger ? 'danger-solid' : 'primary'}" type="button" data-act="ok">${esc(confirmText)}</button>
          </div>
        </div>
      </div>`;
    host.hidden = false;
    const close = (value) => {
      host.hidden = true;
      host.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };
    host.querySelector('[data-act="ok"]').addEventListener('click', () => close(true));
    host.querySelector('[data-act="cancel"]').addEventListener('click', () => close(false));
    host.querySelector('.modal-backdrop').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) close(false);
    });
    document.addEventListener('keydown', onKey);
    host.querySelector('[data-act="ok"]').focus();
  });
}

/* ------------------------------------------------- metrics (shown in header) */

const metrics = { requests: 0, longTaskMax: 0, lastMs: 0 };
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) metrics.longTaskMax = Math.max(metrics.longTaskMax, e.duration);
    renderMetrics();
  }).observe({ type: 'longtask', buffered: true });
} catch {
  /* longtask not supported — the chip shows what it can */
}
function renderMetrics() {
  const bytes = performance
    .getEntriesByType('resource')
    .filter((e) => e.name.includes('/api/'))
    .reduce((s, e) => s + (e.transferSize || 0), 0);
  const chip = $('#metrics-chip');
  if (chip) chip.textContent = `task ${Math.round(metrics.longTaskMax)} ms · ${metrics.requests} req · ${(bytes / 1024).toFixed(1)} KB`;
}
setInterval(renderMetrics, 2500);

/* ---------------------------------------------------------------- API layer */

let currentUser = null;

async function rawApi(method, path, body, countMetric = false) {
  const t0 = performance.now();
  if (countMetric) {
    metrics.requests += 1;
    renderMetrics();
  }
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  metrics.lastMs = Math.round(performance.now() - t0);
  if (!res.ok) {
    const err = new Error(data?.error ?? `HTTP ${res.status}`);
    err.status = res.status;
    err.details = data?.details ?? null;
    throw err;
  }
  return data;
}

async function api(method, path, body) {
  try {
    return await rawApi(method, path, body, true);
  } catch (err) {
    if (err.status === 401) await showAuth('login');
    throw err;
  }
}

const setStatus = (text, meta = '') => {
  $('#status-text').textContent = text;
  $('#status-meta').textContent = meta;
};

async function refreshBuildInfo() {
  try {
    const meta = await api('GET', '/api/meta');
    const docs = meta.tables.documents;
    const built = meta.built_at ? new Date(meta.built_at) : null;
    $('#status-build').textContent = `${docs.toLocaleString()} records${built ? ` · ${built.toLocaleDateString()}` : ''}`;
    return meta;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ SSE / realtime */

const eventListeners = new Set();
const feedItems = [];
let es = null;
let sseStarted = false;
let wasConnected = false;
let sseUp = false;

function onRealtime(fn) {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}

function describeEvent(evt) {
  if (evt.type === 'stock_changed') return `stock update · ${evt.material_ids?.length ?? 0} item(s) · ${evt.source ?? ''}`;
  if (evt.type === 'invoice_saved') return `invoice ${evt.invoice_number} saved · ${evt.by ?? ''}`;
  if (evt.type === 'receipt_posted') return `receipt ${evt.receipt_number} posted · ${evt.material_ids?.length ?? 0} item(s)`;
  if (evt.type === 'data_changed') return `data ${evt.mode ?? 'changed'}`;
  return evt.type;
}

function renderFeeds() {
  $$('[data-feed]').forEach((ul) => {
    ul.innerHTML = feedItems.length
      ? feedItems.map((e) => `<li><span class="t">${e.time}</span><span>${esc(e.text)}</span></li>`).join('')
      : '<li class="muted">No activity yet</li>';
  });
}

function initSSE() {
  if (sseStarted) return;
  sseStarted = true;
  es = new EventSource('/api/events');
  es.addEventListener('hello', () => {
    const reconnected = wasConnected && !sseUp;
    wasConnected = true;
    sseUp = true;
    $('#live-chip').classList.remove('off');
    $('#live-label').textContent = 'live';
    if (reconnected) router(); // converge after a dropped connection
  });
  es.addEventListener('message', (e) => {
    const evt = JSON.parse(e.data);
    feedItems.unshift({ time: new Date(evt.at).toLocaleTimeString(), text: describeEvent(evt) });
    feedItems.splice(8);
    renderFeeds();
    const chip = $('#live-chip');
    chip.classList.remove('pulse');
    void chip.offsetWidth;
    chip.classList.add('pulse');
    if (evt.type === 'data_changed') {
      refreshBuildInfo();
      router();
      return;
    }
    // an invoice changed elsewhere: refresh list / invoice views (the editor handles itself)
    if (evt.type === 'invoice_saved') {
      const h = location.hash || '#/dashboard';
      if (h.startsWith('#/invoices') || (h.startsWith('#/invoice/') && !h.startsWith('#/invoice/new'))) router();
    }
    eventListeners.forEach((fn) => {
      try {
        fn(evt);
      } catch (err) {
        console.error(err);
      }
    });
  });
  es.onerror = () => {
    sseUp = false;
    $('#live-chip').classList.add('off');
    $('#live-label').textContent = 'reconnecting…';
  };
}

function stopSSE() {
  if (es) {
    es.close();
    es = null;
    sseStarted = false;
    wasConnected = false;
    sseUp = false;
  }
}

/* ------------------------------------------------------------- router bits */

let cleanups = [];
const onCleanup = (fn) => cleanups.push(fn);

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  return { parts, query };
}

function setActiveNav(name) {
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
}

/* ==========================================================================
   COMMAND PALETTE (Ctrl/Cmd+K) — jump to screens, invoices, materials
   ========================================================================== */

const palette = { items: [], active: 0, seq: 0 };

function paletteQuickCommands() {
  return [
    { kind: 'go', ico: '▦', title: 'Dashboard', sub: 'Overview and alerts', hash: '#/dashboard' },
    { kind: 'go', ico: '≡', title: 'Invoices', sub: 'Browse, sort and search', hash: '#/invoices' },
    { kind: 'go', ico: '▤', title: 'Stock levels', sub: 'On-hand quantities per material', hash: '#/stock' },
    { kind: 'go', ico: '＋', title: 'New invoice', sub: 'Create an invoice', hash: '#/invoice/new' },
  ];
}

function renderPalette() {
  const host = $('#palette-results');
  if (!palette.items.length) {
    host.innerHTML = '<div class="palette-empty">No matches.</div>';
    return;
  }
  let html = '';
  let lastGroup = '';
  palette.items.forEach((it, i) => {
    if (it.group !== lastGroup) {
      html += `<div class="palette-group">${esc(it.group)}</div>`;
      lastGroup = it.group;
    }
    html += `
      <div class="palette-item ${i === palette.active ? 'active' : ''}" data-i="${i}">
        <span class="pi-ico">${esc(it.ico ?? '•')}</span>
        <div class="pi-main">
          <div class="pi-title">${esc(it.title)}</div>
          <div class="pi-sub">${esc(it.sub ?? '')}</div>
        </div>
        ${it.badge ? `<span class="badge ${esc(it.badgeKind ?? 'ghost')}">${esc(it.badge)}</span>` : ''}
      </div>`;
  });
  host.innerHTML = html;
  host.querySelectorAll('.palette-item').forEach((el) =>
    el.addEventListener('click', () => selectPaletteItem(palette.items[Number(el.dataset.i)]))
  );
  const active = host.querySelector('.palette-item.active');
  active?.scrollIntoView({ block: 'nearest' });
}

function openPalette() {
  const host = $('#palette');
  host.hidden = false;
  const input = $('#palette-input');
  input.value = '';
  palette.items = paletteQuickCommands().map((c) => ({ ...c, group: 'Go to' }));
  palette.active = 0;
  renderPalette();
  input.focus();
}

function closePalette() {
  $('#palette').hidden = true;
}

async function searchPalette(term) {
  const q = term.trim();
  if (!q) {
    palette.items = paletteQuickCommands().map((c) => ({ ...c, group: 'Go to' }));
    palette.active = 0;
    renderPalette();
    return;
  }
  const seq = ++palette.seq;
  const data = await api('GET', `/api/search?q=${encodeURIComponent(q)}`).catch(() => ({ invoices: [], materials: [] }));
  if (seq !== palette.seq || $('#palette').hidden) return;
  palette.items = [
    ...data.invoices.map((r) => ({
      kind: 'invoice', ico: '≡', group: 'Invoices', title: r.invoice_number,
      sub: `${r.customer_name ?? ''} · ${fmtDate(r.date)} · $${fmtMoneyCompact(r.total)}`,
      badge: r.status, badgeKind: r.status, id: r.id,
    })),
    ...data.materials.map((r) => ({
      kind: 'material', ico: '▤', group: 'Materials', title: r.name,
      sub: `${r.model_number ?? ''}${r.default_unit ? ' · ' + r.default_unit : ''}`.trim(),
      badge: `${fmtQty(r.available)} on hand`, badgeKind: r.available > 0 ? 'paid' : 'ghost', id: r.id,
    })),
    {
      kind: 'go', ico: '↗', group: 'Actions',
      title: `All invoices matching “${q}”`, sub: 'open the invoice list with this search',
      hash: `#/invoices?q=${encodeURIComponent(q)}`,
    },
    {
      kind: 'go', ico: '↗', group: 'Actions',
      title: `Stock matching “${q}”`, sub: 'open stock levels with this search',
      hash: `#/stock?q=${encodeURIComponent(q)}`,
    },
  ];
  palette.active = 0;
  renderPalette();
}

function selectPaletteItem(item) {
  if (!item) return;
  closePalette();
  if (item.hash) location.hash = item.hash;
  else if (item.kind === 'invoice') location.hash = `#/invoice/${item.id}`;
  else if (item.kind === 'material') location.hash = `#/stock?q=${encodeURIComponent(item.title)}`;
}

function wirePalette() {
  $('#palette-trigger').addEventListener('click', openPalette);
  $('#palette').addEventListener('click', (e) => {
    if (e.target.classList.contains('palette-backdrop')) closePalette();
  });
  $('#palette-input').addEventListener('input', debounce((e) => searchPalette(e.target.value), 160));
  $('#palette-input').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      palette.active = Math.min(palette.active + 1, palette.items.length - 1);
      renderPalette();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      palette.active = Math.max(palette.active - 1, 0);
      renderPalette();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      selectPaletteItem(palette.items[palette.active]);
    } else if (e.key === 'Escape') {
      closePalette();
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if ($('#palette').hidden) openPalette();
      else closePalette();
    } else if (e.key === 'Escape' && !$('#palette').hidden) {
      closePalette();
    }
  });
}

const skeletons = (rows = 5) =>
  `<div class="card">${Array.from({ length: rows }, () => '<div class="skel line"></div>').join('')}</div>`;

/* ==========================================================================
   AUTH
   ========================================================================== */

async function showAuth(prefer = null) {
  ++routeToken; // invalidate any in-flight view render
  stopSSE();
  currentUser = null;
  $('#nav').hidden = true;
  $('#top-actions').hidden = true;
  $('#demo-toggle').hidden = true;
  $('#demo-panel').hidden = true;
  const view = $('#view');
  let users = 0;
  try {
    users = (await rawApi('GET', '/api/auth/status')).users;
  } catch {
    /* server unreachable — the form will surface it */
  }
  const mode = prefer ?? (users === 0 ? 'signup' : 'login');
  view.innerHTML = `
    <div class="auth-wrap">
      <div class="card auth-card">
        <div class="auth-logo"><span class="brand-badge"><img src="/brand/techcora-logo.svg" alt="Techcora" /></span></div>
        <h1>${users === 0 ? 'Create the first account' : 'Sign in'}</h1>
        <p class="auth-sub">${users === 0 ? 'This install has no accounts yet — the first one becomes the administrator.' : 'Use your ERP account to continue.'}</p>
        <div class="auth-tabs">
          <button type="button" data-mode="login" class="${mode === 'login' ? 'active' : ''}">Log in</button>
          <button type="button" data-mode="signup" class="${mode === 'signup' ? 'active' : ''}">Sign up</button>
        </div>
        <div class="auth-error" id="auth-error" hidden></div>
        <form class="auth-form" id="auth-form">
          <label class="field">Username
            <input class="input" id="auth-username" autocomplete="username" autocapitalize="none" required />
          </label>
          <label class="field" id="auth-name-field" ${mode === 'login' ? 'hidden' : ''}>Full name
            <input class="input" id="auth-name" autocomplete="name" />
          </label>
          <label class="field">Password
            <input class="input" id="auth-password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required />
          </label>
          <button class="btn primary btn-block" type="submit" id="auth-submit">${mode === 'signup' ? 'Create account' : 'Log in'}</button>
        </form>
      </div>
      <div class="auth-foot">Techcora ERP · demo build</div>
    </div>`;

  $$('.auth-tabs button').forEach((b) => b.addEventListener('click', () => showAuth(b.dataset.mode)));

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = $('#auth-error');
    errBox.hidden = true;
    const submit = $('#auth-submit');
    submit.disabled = true;
    try {
      const payload = {
        username: $('#auth-username').value,
        password: $('#auth-password').value,
      };
      if (mode === 'signup') payload.name = $('#auth-name').value;
      const out = await rawApi('POST', mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', payload, true);
      currentUser = out.user;
      toast(mode === 'signup' ? `Account created — welcome, ${out.user.name}` : `Welcome back, ${out.user.name}`);
      await enterApp();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
}

async function enterApp() {
  $('#nav').hidden = false;
  $('#top-actions').hidden = false;
  $('#demo-toggle').hidden = false;
  updateUserChip();
  initSSE();
  await refreshBuildInfo();
  await router();
}

function updateUserChip() {
  if (!currentUser) return;
  $('#user-avatar').textContent = (currentUser.name || currentUser.username || '?').trim().charAt(0).toUpperCase();
  $('#user-name').textContent = currentUser.name || currentUser.username;
  $('#user-role').textContent = currentUser.role;
}

/* ==========================================================================
   VIEWS
   ========================================================================== */

/* --------------------------------------------------------------- dashboard */

async function viewDashboard(token = routeToken) {
  setActiveNav('dashboard');
  setStatus('Loading dashboard…');
  const view = $('#view');
  view.innerHTML = skeletons(6);
  const [d, meta] = await Promise.all([api('GET', '/api/dashboard'), api('GET', '/api/meta')]);
  if (token !== routeToken) return;

  if (meta.tables.documents === 0) {
    view.innerHTML = `
      <div class="card welcome">
        <h1>No business data yet</h1>
        <p>This install starts empty. Load the masked dataset or generate sample data to explore.</p>
        <div class="actions">
          <button class="btn primary" id="w-generate">Generate sample data</button>
          <button class="btn" id="w-load">Load masked dataset</button>
        </div>
      </div>`;
    $('#w-generate').addEventListener('click', () => generateSampleData($('#fake-size')?.value ?? 'small'));
    $('#w-load').addEventListener('click', () => loadMaskedDataset());
    setStatus('No data', 'load the dataset or generate sample data from Demo tools');
    return;
  }

  const bars = d.salesByMonth;
  const max = Math.max(...bars.map((b) => b.total), 1);
  const w = 100;
  const barW = w / (bars.length * 1.45);
  const svg = `
    <svg class="chart" viewBox="0 0 ${w} ${w / 2}" preserveAspectRatio="none" role="img" aria-label="Sales by month">
      ${bars
        .map((b, i) => {
          const h = (b.total / max) * 34;
          const x = 4 + i * (barW * 1.45);
          const y = 42 - h;
          return `
            <rect class="bar" style="animation-delay:${i * 55}ms" x="${x}" y="${y}" width="${barW}" height="${Math.max(h, 0.6)}" rx="1.2" fill="url(#g)"></rect>
            <text x="${x + barW / 2}" y="46.6" text-anchor="middle" font-size="2.6" fill="#8d857d">${MONTHS[Number(b.month.slice(5)) - 1]}</text>`;
        })
        .join('')}
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f85419" stop-opacity="0.95"></stop>
          <stop offset="1" stop-color="#f85419" stop-opacity="0.55"></stop>
        </linearGradient>
      </defs>
    </svg>`;

  const q = d.dataQuality;
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Dashboard</h1></div>
      <div class="spacer"></div>
      <span class="pill-count">month ${esc(d.month)}</span>
    </div>

    <div class="grid grid-stats">
      <div class="card stat accent">
        <div class="label">Outstanding</div>
        <div class="value" id="stat-out" title="$${fmtMoney(d.outstanding.amount)}">$0.00</div>
        <div class="note">${d.outstanding.count} invoices with a balance</div>
      </div>
      <div class="card stat">
        <div class="label">Sales · this month</div>
        <div class="value" id="stat-sales" title="$${fmtMoney(d.monthSales)}">$0.00</div>
        <div class="note">invoiced total</div>
      </div>
      <div class="card stat">
        <div class="label">Purchases · this month</div>
        <div class="value" id="stat-purchases" title="$${fmtMoney(d.monthPurchases)}">$0.00</div>
        <div class="note">goods received</div>
      </div>
      <div class="card stat">
        <div class="label">Gross margin · this month</div>
        <div class="value" id="stat-margin" title="$${fmtMoney(d.monthMargin)}">$0.00</div>
        <div class="note">COGS $${fmtMoneyCompact(d.monthCogs)} · costed ${d.cogsCoverage}%</div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:18px">
      <div class="card">
        <div class="card-head"><h2>Sales · last 6 months</h2></div>
        ${svg}
        <div class="footnote">Peak month: <b>$${fmtMoney(max)}</b></div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Low stock</h2>
          <span class="spacer"></span>
          <span class="pill-count">${d.lowStock.count} low · ${d.lowStock.outOfStock} out</span>
        </div>
        <div class="list-simple">
          ${
            d.lowStock.list.length
              ? d.lowStock.list
                  .map(
                    (m) => `
              <div class="item clickable" data-id="${esc(m.id)}">
                <div class="main">
                  <div class="cell-title">${esc(m.name)}</div>
                  <div class="sub mono">${esc(m.model_number ?? '')}</div>
                </div>
                <span class="badge partial">${fmtQty(m.qty)} ≤ reorder ${fmtQty(m.reorder_point)}</span>
              </div>`
                  )
                  .join('')
              : '<div class="empty">Nothing at or below its reorder point.</div>'
          }
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:18px">
      <div class="card">
        <div class="card-head">
          <h2>Awaiting delivery</h2>
          <span class="spacer"></span>
          <span class="pill-count">${d.awaitingDelivery.count} · $${fmtMoneyCompact(d.awaitingDelivery.amount)}</span>
        </div>
        <div class="list-simple">
          ${
            d.awaitingDelivery.list.length
              ? d.awaitingDelivery.list
                  .map(
                    (p) => `
              <div class="item">
                <div class="main">
                  <div class="cell-title mono">${esc(p.order_number)}</div>
                  <div class="sub">${esc(p.vendor_name ?? '')}${p.expected_date ? ` · expected ${fmtDate(p.expected_date)}` : ''}</div>
                </div>
                <span class="badge ${p.status === 'partially_received' ? 'partial' : 'sent'}">${esc(String(p.status).replace('_', ' '))}</span>
                <span class="num strong">$${fmtMoneyCompact(p.total)}</span>
              </div>`
                  )
                  .join('')
              : '<div class="empty">Nothing waiting for delivery.</div>'
          }
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Data quality</h2></div>
        <div class="list-simple">
          <div class="item">
            <div class="main"><div class="cell-title">Invoice references resolvable</div>
              <div class="sub">${q.invoiceResolvable.toLocaleString()} of ${q.salesMovements.toLocaleString()} sales movements</div></div>
            <span class="badge ${q.invoiceCoverage > 99 ? 'paid' : 'partial'}">${q.invoiceCoverage}%</span>
          </div>
          <div class="item">
            <div class="main"><div class="cell-title">Batch references resolved</div>
              <div class="sub">${q.batchResolved.toLocaleString()} of ${q.batchRefs.toLocaleString()} invoice lines</div></div>
            <span class="badge ${q.batchCoverage > 99 ? 'paid' : 'partial'}">${q.batchCoverage}%</span>
          </div>
          <div class="item">
            <div class="main"><div class="cell-title">Movements with full links</div>
              <div class="sub">written by this system — invoice and batch ids</div></div>
            <span class="badge info">${q.fullyLinked.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <div class="card-head"><h2>Activity</h2></div>
      <ul class="feed" data-feed></ul>
    </div>`;

  renderFeeds();
  animateMoney($('#stat-out'), d.outstanding.amount);
  animateMoney($('#stat-sales'), d.monthSales);
  animateMoney($('#stat-purchases'), d.monthPurchases);
  animateMoney($('#stat-margin'), d.monthMargin);
  $$('.list-simple .item.clickable').forEach((el) =>
    el.addEventListener('click', () => {
      location.hash = `#/movements/${el.dataset.id}`;
    })
  );
  setStatus('Dashboard', `1 request · ${metrics.lastMs} ms`);
}

/* ------------------------------------------------------------ invoice list */

const listState = { q: '', status: '', sort: 'date', dir: 'desc', cursor: null, cursors: [] };

async function viewInvoices(searchQ = undefined, token = routeToken) {
  setActiveNav('invoices');
  if (searchQ !== undefined) {
    listState.q = String(searchQ ?? '');
    listState.status = '';
    listState.cursor = null;
    listState.cursors = [];
  }
  const view = $('#view');

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Invoices</h1></div>
      <div class="spacer"></div>
      <a class="btn primary" href="#/invoice/new">New invoice</a>
    </div>
    <div class="card">
      <div class="toolbar">
        <input class="input search" id="inv-q" type="search" placeholder="Search number or customer…" value="${esc(listState.q)}" />
        <select class="select small" id="inv-status">
          <option value="">All statuses</option>
          ${['sent', 'paid', 'partial', 'draft', 'cancelled'].map((s) => `<option value="${s}" ${listState.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <span class="spacer"></span>
        <span class="muted" id="inv-count"></span>
      </div>
      <div class="table-wrap" id="invoice-table">${skeletons(8)}</div>
      <div class="pager">
        <button class="btn small" id="inv-prev" ${listState.cursors.length ? '' : 'disabled'}>‹ Prev</button>
        <button class="btn small" id="inv-next" disabled>Next ›</button>
        <span class="info" id="inv-page-info"></span>
      </div>
    </div>`;

  const tableHost = $('#invoice-table');

  async function load(reset = false) {
    if (reset) {
      listState.cursor = null;
      listState.cursors = [];
    }
    const params = new URLSearchParams();
    if (listState.q) params.set('q', listState.q);
    if (listState.status) params.set('status', listState.status);
    params.set('sort', listState.sort);
    params.set('dir', listState.dir);
    if (listState.cursor) params.set('cursor', listState.cursor);
    params.set('limit', '25');

    const t0 = performance.now();
    const data = await api('GET', `/api/invoices?${params}`);
    if (token !== routeToken) return; // a newer render took over
    const ms = Math.round(performance.now() - t0);

    const arrow = listState.dir === 'asc' ? '▲' : '▼';
    const th = (key, label, cls = '') =>
      `<th class="sortable ${cls}" data-sort="${key}">${label}${listState.sort === key ? `<span class="arrow">${arrow}</span>` : ''}</th>`;

    tableHost.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            ${th('number', 'Number')}
            ${th('customer', 'Customer')}
            ${th('date', 'Date')}
            ${th('due', 'Due')}
            <th>Status</th>
            ${th('total', 'Total', 'num')}
            ${th('balance', 'Balance', 'num')}
          </tr>
        </thead>
        <tbody>
          ${
            data.rows.length
              ? data.rows
                  .map(
                    (r) => `
            <tr class="clickable" data-id="${esc(r.id)}">
              <td class="strong mono">${esc(r.invoice_number)}</td>
              <td>${esc(r.customer_name ?? '—')}</td>
              <td>${fmtDate(r.date)}</td>
              <td>${fmtDate(r.due_date)}</td>
              <td><span class="badge ${esc(r.status)}">${esc(r.status)}</span></td>
              <td class="num">$${fmtMoney(r.total)}</td>
              <td class="num strong">$${fmtMoney(r.balance)}</td>
            </tr>`
                  )
                  .join('')
              : '<tr><td colspan="7"><div class="empty"><div class="big">No invoices match</div>Adjust the search or status filter.</div></td></tr>'
          }
        </tbody>
      </table>`;

    const start = listState.cursors.length * 25 + (data.rows.length ? 1 : 0);
    const end = listState.cursors.length * 25 + data.rows.length;
    $('#inv-count').textContent = `${data.total.toLocaleString()} invoices`;
    $('#inv-next').disabled = !data.next_cursor;
    $('#inv-prev').disabled = !listState.cursors.length;
    $('#inv-page-info').textContent = `rows ${start}–${end} of ${data.total} · ${ms} ms`;
    listState._next = data.next_cursor;

    $$('#invoice-table th.sortable').forEach((el) =>
      el.addEventListener('click', () => {
        const key = el.dataset.sort;
        if (listState.sort === key) listState.dir = listState.dir === 'asc' ? 'desc' : 'asc';
        else {
          listState.sort = key;
          listState.dir = key === 'customer' || key === 'number' ? 'asc' : 'desc';
        }
        load(true);
      })
    );
    $$('#invoice-table tr.clickable').forEach((tr) =>
      tr.addEventListener('click', () => {
        location.hash = `#/invoice/${tr.dataset.id}`;
      })
    );
    setStatus('Invoices', `${data.rows.length} rows · ${ms} ms`);
  }

  $('#inv-q').addEventListener(
    'input',
    debounce((e) => {
      listState.q = e.target.value.trim();
      load(true);
    }, 250)
  );
  $('#inv-status').addEventListener('change', (e) => {
    listState.status = e.target.value;
    load(true);
  });
  $('#inv-next').addEventListener('click', () => {
    if (!listState._next) return;
    listState.cursors.push(listState.cursor);
    listState.cursor = listState._next;
    load();
  });
  $('#inv-prev').addEventListener('click', () => {
    listState.cursor = listState.cursors.pop() ?? null;
    load();
  });

  await load();
}

/* ------------------------------------------------------------------ editor */

function lineTotal(l) {
  return Math.round((l.quantity * l.unit_price - (l.discount || 0) + Number.EPSILON) * 100) / 100;
}

async function viewEditor(invoiceId = null, preselectMaterial = null, token = routeToken) {
  setActiveNav('invoices');
  const view = $('#view');
  const readonly = !!invoiceId;

  view.innerHTML = skeletons(6);

  const [customers, invoiceData] = await Promise.all([
    api('GET', '/api/customers'),
    readonly ? api('GET', `/api/invoices/${invoiceId}`) : Promise.resolve(null),
  ]);
  if (token !== routeToken) return;

  if (readonly) {
    const inv = invoiceData.invoice;
    view.innerHTML = `
      <div class="crumb"><a href="#/invoices">← Invoices</a><span>/</span><span class="mono">${esc(inv.invoiceNumber)}</span></div>
      <div class="page-head">
        <div>
          <h1>Invoice ${esc(inv.invoiceNumber)}</h1>
          <div class="sub">${esc(inv.customer?.name ?? '')} · dated ${fmtDate(inv.date)} · due ${fmtDate(inv.dueDate)}</div>
        </div>
        <div class="spacer"></div>
        <span class="badge ${esc(inv.status)}">${esc(inv.status)}</span>
        ${inv.balance > 0.005 ? `<button class="btn primary" id="inv-pay" type="button">Mark as paid · $${fmtMoney(inv.balance)}</button>` : ''}
        <button class="btn" id="inv-print" type="button">Print</button>
      </div>
      <div class="editor invoice-doc">
        <div>
          <div class="card">
            <div class="card-head"><h2>Lines</h2><span class="spacer"></span><span class="pill-count">${invoiceData.lines.length} line(s)</span></div>
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Item</th><th>Batch</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Discount</th><th class="num">Total</th></tr></thead>
                <tbody>
                  ${invoiceData.lines
                    .map((l) => {
                      const batch = l.batch_id || l.batch_ref;
                      return `
                    <tr>
                      <td><div class="cell-title">${esc(l.material_name ?? l.description ?? '—')}</div><div class="sub mono">${esc(l.model_number ?? l.material_id ?? '')}</div></td>
                      <td class="mono" style="font-size:12px">${batch ? esc(shortId(batch, 14)) : '<span class="muted">no batch recorded</span>'}${l.batch_id ? '' : l.batch_ref ? ' <span class="badge ghost">unresolved</span>' : ''}</td>
                      <td class="num">${fmtQty(l.quantity)} ${esc(l.unit ?? '')}</td>
                      <td class="num">$${fmtMoney(l.unit_price)}</td>
                      <td class="num">$${fmtMoney(l.discount)}</td>
                      <td class="num strong">$${fmtMoney(l.total_price)}</td>
                    </tr>`;
                    })
                    .join('')}
                </tbody>
              </table>
            </div>
          </div>
          ${inv.notes ? `<div class="card"><div class="card-head"><h2>Notes</h2></div><p style="margin:0">${esc(inv.notes)}</p></div>` : ''}
        </div>
        <div class="editor-rail">
          <div class="card">
            <div class="card-head"><h2>Summary</h2></div>
            <div class="totals">
              <div class="row"><span>Subtotal</span><span class="amount">$${fmtMoney(inv.subtotal)}</span></div>
              <div class="row"><span>Discount</span><span class="amount">$${fmtMoney(inv.discountTotal)}</span></div>
              <div class="row grand"><span>Total</span><span class="amount">$${fmtMoney(inv.total)}</span></div>
              <div class="row"><span>Paid</span><span class="amount">$${fmtMoney(inv.paidAmount)}</span></div>
              <div class="row"><span>Balance</span><span class="amount strong">$${fmtMoney(inv.balance)}</span></div>
            </div>
            <div class="footnote">Terms: ${esc(inv.terms ?? '—')} · created ${fmtDateTime(inv.createdAt)}</div>
          </div>
        </div>
      </div>`;
    setStatus(`Invoice ${inv.invoiceNumber}`, `1 request · ${metrics.lastMs} ms`);
    $('#inv-print')?.addEventListener('click', () => window.print());
    $('#inv-pay')?.addEventListener('click', async () => {
      const btn = $('#inv-pay');
      btn.disabled = true;
      try {
        const out = await api('POST', `/api/invoices/${encodeURIComponent(inv.id)}/pay`);
        toast('Invoice settled', `${esc(out.invoice_number)} · $${fmtMoney(out.paid)} paid`);
      } catch (err) {
        toast('Could not settle invoice', esc(err.message), 'bad');
        btn.disabled = false;
      }
    });
    return;
  }

  /* ---------------------------- create mode --------------------------- */
  const draft = {
    customer_id: customers.rows[0]?.id ?? '',
    date: new Date().toISOString().slice(0, 10),
    due_date: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    lines: [],
    selected: null,
    stock: null,
    pickedBatch: null,
    banner: null,
  };

  view.innerHTML = `
    <div class="page-head">
      <div><h1>New invoice</h1></div>
      <div class="spacer"></div>
      <a class="btn ghost" href="#/invoices">← Back</a>
    </div>
    <div id="draft-banner"></div>
    <div class="editor">
      <div>
        <div class="card">
          <div class="card-head"><h2>Details</h2></div>
          <div class="toolbar" style="margin:0">
            <label class="field" style="min-width:280px">Customer
              <select class="select" id="d-customer">
                ${customers.rows.map((c) => `<option value="${esc(c.id)}" ${c.id === draft.customer_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
              </select>
            </label>
            <label class="field">Date<input class="input" type="date" id="d-date" value="${esc(draft.date)}" /></label>
            <label class="field">Due date<input class="input" type="date" id="d-due" value="${esc(draft.due_date)}" /></label>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h2>Line items</h2>
            <span class="spacer"></span>
            <span class="pill-count" id="d-count">0 lines</span>
          </div>
          <div class="table-wrap" id="d-lines"></div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Totals</h2></div>
          <div class="split">
            <div class="totals grow">
              <div class="row"><span>Subtotal</span><span class="amount" id="t-sub">$0.00</span></div>
              <div class="row"><span>Line discounts</span><span class="amount" id="t-disc">$0.00</span></div>
              <div class="row grand"><span>Total</span><span class="amount" id="t-total">$0.00</span></div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;min-width:200px">
              <button class="btn primary" id="d-save">Save invoice</button>
            </div>
          </div>
        </div>
      </div>

      <div class="editor-rail">
        <div class="card">
          <div class="card-head"><h2>Add a line</h2></div>
          <label class="field">Material
            <div class="combo">
              <input class="input" id="m-search" type="search" placeholder="Search name or model…" autocomplete="off" />
              <div class="combo-list hidden" id="m-list"></div>
            </div>
          </label>
          <div id="stock-panel"></div>
          <div class="toolbar" style="margin:12px 0 0">
            <label class="field">Qty<input class="input num" id="m-qty" type="number" min="0.001" step="any" value="1" /></label>
            <label class="field">Unit price<input class="input num wide" id="m-price" type="number" min="0" step="any" placeholder="cost" /></label>
            <label class="field">Discount<input class="input num" id="m-disc" type="number" min="0" step="any" value="0" /></label>
          </div>
          <div style="margin-top:12px">
            <button class="btn primary btn-block" id="m-add" disabled>Add line</button>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Activity</h2></div>
          <ul class="feed" data-feed></ul>
        </div>
      </div>
    </div>`;
  renderFeeds();

  /* ---- draft rendering ---- */
  const renderLines = () => {
    const host = $('#d-lines');
    if (!host) return; // the editor was navigated away — an async handler may still land here
    if (!draft.lines.length) {
      host.innerHTML = `<div class="empty"><div class="big">No lines yet</div>Search for a material to add one.</div>`;
    } else {
      host.innerHTML = `
        <table class="table line-items">
          <thead><tr><th>Item</th><th>Batch</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Disc.</th><th class="num">Total</th><th></th></tr></thead>
          <tbody>
            ${draft.lines
              .map(
                (l, i) => `
              <tr data-i="${i}" class="${l.insufficient ? 'flash' : ''}">
                <td><div class="cell-title">${esc(l.name)}</div><div class="sub mono">${esc(l.model ?? '')}</div>
                  ${l.insufficient ? `<div class="sub" style="color:var(--bad)">Only ${fmtQty(l.remaining_now ?? 0)} left in this batch</div>` : ''}</td>
                <td class="mono" style="font-size:12px" title="${esc(l.batch_id)}">${esc(shortId(l.batch_id, 10))}</td>
                <td class="num"><input class="input num small line-qty" type="number" min="0.001" step="any" value="${l.quantity}" /></td>
                <td class="num"><input class="input num small line-price" type="number" min="0" step="any" value="${l.unit_price}" /></td>
                <td class="num"><input class="input num small line-disc" type="number" min="0" step="any" value="${l.discount}" /></td>
                <td class="num strong line-total">$${fmtMoney(lineTotal(l))}</td>
                <td><button class="icon-btn line-remove" title="Remove">✕</button></td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>`;
    }
    const countEl = $('#d-count');
    if (countEl) countEl.textContent = `${draft.lines.length} line(s)`;
    renderTotals();
  };

  const renderTotals = () => {
    if (!$('#t-sub')) return;
    const sub = draft.lines.reduce((s, l) => s + lineTotal(l), 0);
    const disc = draft.lines.reduce((s, l) => s + (Number(l.discount) || 0), 0);
    $('#t-sub').textContent = `$${fmtMoney(sub)}`;
    $('#t-disc').textContent = `$${fmtMoney(disc)}`;
    $('#t-total').textContent = `$${fmtMoney(sub)}`;
  };

  const renderBanner = () => {
    const host = $('#draft-banner');
    if (!host) return;
    if (!draft.banner) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = `<div class="banner warn"><div>${esc(draft.banner)}</div><button class="btn small" id="banner-dismiss">dismiss</button></div>`;
    $('#banner-dismiss').addEventListener('click', () => {
      draft.banner = null;
      renderBanner();
    });
  };

  const updateAddButton = () => {
    const btn = $('#m-add');
    if (!btn) return;
    const qty = Number($('#m-qty').value) || 0;
    btn.disabled = !(draft.selected && draft.pickedBatch && qty > 0);
  };

  const renderStockPanel = () => {
    const host = $('#stock-panel');
    if (!host) return;
    if (!draft.selected || !draft.stock) {
      host.innerHTML = draft.selected ? '<div class="skel line w70"></div><div class="skel line"></div>' : '';
      updateAddButton();
      return;
    }
    const { material, available, batches } = draft.stock;
    const usable = batches.filter((b) => b.quantity > 0);
    const rows = batches
      .map((b) => {
        const isUsable = b.quantity > 0;
        const selected = draft.pickedBatch === b.batch_id;
        return `
        <label class="batch ${isUsable ? '' : 'disabled'} ${selected ? 'selected' : ''}" data-batch="${esc(b.batch_id)}">
          <input type="radio" name="batch" ${isUsable ? '' : 'disabled'} ${selected ? 'checked' : ''} />
          <div class="b-main">
            <div class="mono b-id">${esc(shortId(b.batch_id, 16))}</div>
            <div class="b-meta">
              <span class="b-qty ${isUsable ? '' : 'zero'}">${fmtQty(b.quantity)} left</span>
              <span>$${fmtMoney(b.unit_cost ?? 0)}/unit</span>
              <span>${b.received_at ? 'recv ' + fmtDate(b.received_at) : ''}</span>
            </div>
          </div>
        </label>`;
      })
      .join('');
    host.innerHTML = `
      <div style="margin:12px 0 4px;display:flex;align-items:center;gap:8px">
        <strong style="font-size:13.5px">${esc(material.name)}</strong>
        <span class="badge ${available > 0 ? 'paid' : 'cancelled'}">${fmtQty(available)} available</span>
      </div>
      <div class="muted" style="font-size:12px">${usable.length} batch(es) with stock · oldest first</div>
      <div class="batch-list">${rows || '<div class="combo-empty">No batches recorded.</div>'}</div>`;

    host.querySelectorAll('.batch').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.batch;
        const batch = draft.stock.batches.find((b) => b.batch_id === id);
        if (!batch || batch.quantity <= 0) return;
        draft.pickedBatch = id;
        renderStockPanel();
      });
    });
    updateAddButton();
  };

  /* ---- material search ---- */
  const list = $('#m-list');
  let comboItems = [];
  let comboActive = -1;

  const renderCombo = (rows) => {
    comboItems = rows;
    comboActive = rows.length ? 0 : -1;
    if (!rows.length) {
      list.innerHTML = '<div class="combo-empty">No matching materials.</div>';
      return;
    }
    list.innerHTML = rows
      .map(
        (r, i) => `
      <div class="combo-item ${i === comboActive ? 'active' : ''}" data-i="${i}">
        <div class="ci-main">
          <div class="ci-name">${esc(r.name)}</div>
          <div class="ci-sub">${esc(r.model_number ?? '')} ${r.default_unit ? '· ' + esc(r.default_unit) : ''}</div>
        </div>
        <span class="badge ${r.available > 0 ? 'paid' : 'ghost'}">${fmtQty(r.available)}</span>
      </div>`
      )
      .join('');
    list.querySelectorAll('.combo-item').forEach((el) =>
      el.addEventListener('click', () => pick(rows[Number(el.dataset.i)]))
    );
  };

  const pick = async (row) => {
    if (!row) return;
    list.classList.add('hidden');
    $('#m-search').value = row.name;
    draft.selected = row;
    draft.stock = null;
    draft.pickedBatch = null;
    renderStockPanel();
    const stock = await api('GET', `/api/materials/${encodeURIComponent(row.id)}/stock`);
    if (!view.isConnected || token !== routeToken || draft.selected?.id !== row.id) return; // moved on / newer render
    draft.stock = stock;
    $('#m-search').value = stock.material.name; // preselect path passes a stub name
    const firstUsable = stock.batches.find((b) => b.quantity > 0);
    if (firstUsable) {
      draft.pickedBatch = firstUsable.batch_id;
      const suggested = stock.lastPrice ?? firstUsable.unit_cost;
      $('#m-price').value = suggested ?? '';
    }
    renderStockPanel();
  };

  const search = debounce(async () => {
    const q = $('#m-search').value.trim();
    if (draft.selected && q !== draft.selected.name) {
      draft.selected = null;
      draft.stock = null;
      draft.pickedBatch = null;
      renderStockPanel();
    }
    try {
      const data = await api('GET', `/api/materials/search?q=${encodeURIComponent(q)}&limit=18`);
      renderCombo(data.rows);
      list.classList.remove('hidden');
    } catch (err) {
      toast('Search failed', esc(err.message), 'bad');
    }
  }, 180);

  $('#m-search').addEventListener('input', search);
  $('#m-search').addEventListener('focus', () => {
    if (!comboItems.length) search();
    else list.classList.remove('hidden');
  });
  $('#m-search').addEventListener('keydown', (e) => {
    if (list.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') {
      comboActive = Math.min(comboActive + 1, comboItems.length - 1);
      renderComboMark();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      comboActive = Math.max(comboActive - 1, 0);
      renderComboMark();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (comboItems[comboActive]) pick(comboItems[comboActive]);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      list.classList.add('hidden');
    }
  });
  const renderComboMark = () => {
    $$('#m-list .combo-item').forEach((el) => el.classList.toggle('active', Number(el.dataset.i) === comboActive));
  };

  $('#m-qty').addEventListener('input', updateAddButton);
  $('#m-add').addEventListener('click', () => {
    if (!draft.selected || !draft.pickedBatch) return;
    const batch = draft.stock.batches.find((b) => b.batch_id === draft.pickedBatch);
    const qty = Number($('#m-qty').value) || 0;
    const price = $('#m-price').value === '' ? Number(batch.unit_cost) || 0 : Number($('#m-price').value);
    const disc = Number($('#m-disc').value) || 0;
    draft.lines.push({
      material_id: draft.selected.id,
      name: draft.selected.name,
      model: draft.selected.model_number,
      unit: draft.selected.default_unit,
      batch_id: draft.pickedBatch,
      batch_cost: Number(batch.unit_cost) || 0,
      quantity: qty,
      unit_price: price,
      discount: disc,
    });
    draft.selected = null;
    draft.stock = null;
    draft.pickedBatch = null;
    $('#m-search').value = '';
    $('#m-qty').value = '1';
    $('#m-price').value = '';
    $('#m-disc').value = '0';
    renderStockPanel();
    renderLines();
    $('#m-search').focus();
  });

  /* ---- line editing (surgical DOM updates keep focus) ---- */
  $('#d-lines').addEventListener('input', (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    const i = Number(tr.dataset.i);
    const line = draft.lines[i];
    if (!line) return;
    if (e.target.classList.contains('line-qty')) line.quantity = Number(e.target.value) || 0;
    if (e.target.classList.contains('line-price')) line.unit_price = Number(e.target.value) || 0;
    if (e.target.classList.contains('line-disc')) line.discount = Number(e.target.value) || 0;
    tr.querySelector('.line-total').textContent = `$${fmtMoney(lineTotal(line))}`;
    renderTotals();
  });
  $('#d-lines').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (!tr || !e.target.classList.contains('line-remove')) return;
    draft.lines.splice(Number(tr.dataset.i), 1);
    renderLines();
  });

  $('#d-customer').addEventListener('change', (e) => (draft.customer_id = e.target.value));
  $('#d-date').addEventListener('change', (e) => (draft.date = e.target.value));
  $('#d-due').addEventListener('change', (e) => (draft.due_date = e.target.value));

  /* ---- realtime reactivity ---- */
  const applyStock = (materialId, stock) => {
    if (draft.selected?.id === materialId) {
      draft.stock = stock;
      if (draft.pickedBatch && !stock.batches.some((b) => b.batch_id === draft.pickedBatch && b.quantity > 0)) {
        const firstUsable = stock.batches.find((b) => b.quantity > 0);
        draft.pickedBatch = firstUsable ? firstUsable.batch_id : null;
      }
      renderStockPanel();
    }
    for (const l of draft.lines) {
      if (l.material_id !== materialId) continue;
      const batch = stock.batches.find((b) => b.batch_id === l.batch_id);
      l.remaining_now = batch ? batch.quantity : 0;
      l.insufficient = !batch || batch.quantity < l.quantity;
    }
  };

  const stop = onRealtime(async (evt) => {
    if (evt.type === 'receipt_posted' && evt.receipt_number) {
      toast('Receipt posted', `${esc(evt.receipt_number)} · ${evt.material_ids?.length ?? 0} batches added`, 'ok', 4200);
    }
    const affected = (evt.material_ids ?? []).filter(
      (id) => draft.selected?.id === id || draft.lines.some((l) => l.material_id === id)
    );
    if (!affected.length) return;
    for (const id of affected) {
      try {
        const stock = await api('GET', `/api/materials/${encodeURIComponent(id)}/stock`);
        applyStock(id, stock);
      } catch {
        /* material may no longer exist */
      }
    }
    if (!view.isConnected || token !== routeToken) return; // editor closed / newer render took over
    draft.banner = `Stock changed (${evt.source ?? evt.type}). Affected batches were refreshed — check quantities before saving.`;
    renderBanner();
    renderLines();
  });
  onCleanup(stop);

  /* ---- save ---- */
  $('#d-save').addEventListener('click', async () => {
    if (!draft.lines.length) {
      toast('Nothing to save', 'Add at least one line first.', 'bad');
      return;
    }
    const btn = $('#d-save');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const payload = {
        customer_id: draft.customer_id,
        date: draft.date,
        due_date: draft.due_date,
        request_id: crypto.randomUUID(),
        lines: draft.lines.map((l) => ({
          material_id: l.material_id,
          batch_id: l.batch_id,
          quantity: l.quantity,
          unit_price: l.unit_price,
          discount: l.discount,
        })),
      };
      const out = await api('POST', '/api/invoices', payload);
      toast('Invoice saved', `${esc(out.invoice_number)} · $${fmtMoney(out.total)} · ${out.movements} movement(s)`, 'ok', 5000);
      location.hash = `#/invoice/${out.invoice_id}`;
    } catch (err) {
      const details = err.details?.available !== undefined ? `Only ${fmtQty(err.details.available)} left in that batch.` : '';
      toast('Could not save invoice', `${esc(err.message)}${details ? ' ' + details : ''}`, 'bad', 6500);
      if (err.details?.material_id) {
        try {
          const stock = await api('GET', `/api/materials/${encodeURIComponent(err.details.material_id)}/stock`);
          applyStock(err.details.material_id, stock);
          renderLines();
        } catch {
          /* ignore */
        }
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save invoice';
    }
  });

  renderLines();
  renderStockPanel();
  if (preselectMaterial) await pick({ id: preselectMaterial, name: '…', model_number: '', default_unit: '' });
  setStatus('New invoice', 'ready');
  $('#m-search').focus();
}

/* ---------------------------------------------------------------- stock view */

const stockState = { q: '', page: 0 };

async function viewStock(searchQ = null, token = routeToken) {
  setActiveNav('stock');
  if (searchQ != null && String(searchQ).trim()) {
    stockState.q = String(searchQ);
    stockState.page = 0;
  }
  const view = $('#view');
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Stock levels</h1></div>
      <div class="spacer"></div>
      <input class="input search" id="st-q" type="search" placeholder="Search material or model…" value="${esc(stockState.q)}" />
    </div>
    <div class="card">
      <div class="table-wrap" id="st-table">${skeletons(8)}</div>
      <div class="pager">
        <button class="btn small" id="st-prev">‹ Prev</button>
        <button class="btn small" id="st-next">Next ›</button>
        <span class="info" id="st-info"></span>
      </div>
    </div>`;

  const host = $('#st-table');
  const detailCache = new Map(); // material id → /stock payload
  const openIds = new Set();

  const detailHtml = (stock, id) => `
    <div style="padding:6px 2px 12px">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Batch</th><th>Received</th><th>Location</th><th class="num">Remaining</th><th class="num">Unit cost</th><th></th></tr></thead>
          <tbody>
            ${stock.batches
              .map(
                (b) => `
              <tr>
                <td class="mono" style="font-size:12px">${esc(shortId(b.batch_id, 18))}</td>
                <td>${fmtDate(b.received_at)}</td>
                <td>${esc(b.location_id ?? '—')}</td>
                <td class="num ${b.quantity > 0 ? 'strong' : 'muted'}">${fmtQty(b.quantity)}</td>
                <td class="num">$${fmtMoney(b.unit_cost ?? 0)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:8px"><a class="btn small ghost" href="#/movements/${encodeURIComponent(id)}">movements →</a></div>
    </div>`;

  const renderDetail = async (id) => {
    const detail = host.querySelector(`tr.batch-detail[data-for="${CSS.escape(id)}"]`);
    if (!detail) return;
    const td = detail.querySelector('td');
    try {
      let stock = detailCache.get(id);
      if (!stock) {
        stock = await api('GET', `/api/materials/${encodeURIComponent(id)}/stock`);
        detailCache.set(id, stock);
      }
      if (token !== routeToken) return; // a newer render took over
      td.innerHTML = detailHtml(stock, id);
    } catch (err) {
      td.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  };

  // one delegated listener on the table host (rows are re-rendered on every page load)
  host.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const tr = e.target.closest('tr.clickable[data-id]');
    if (!tr) return;
    const id = tr.dataset.id;
    const detail = host.querySelector(`tr.batch-detail[data-for="${CSS.escape(id)}"]`);
    if (!detail) return;
    const chev = tr.querySelector('.chev');
    const isOpen = !detail.classList.contains('hidden');
    if (isOpen) {
      detail.classList.add('hidden');
      openIds.delete(id);
      if (chev) chev.textContent = '▸';
    } else {
      detail.classList.remove('hidden');
      openIds.add(id);
      if (chev) chev.textContent = '▾';
      const td = detail.querySelector('td');
      td.innerHTML = detailCache.has(id) ? detailHtml(detailCache.get(id), id) : '<div class="skel line w70"></div><div class="skel line"></div>';
      if (!detailCache.has(id)) renderDetail(id);
    }
  });

  // realtime: drop stale batch caches, refresh anything the user has open
  const stop = onRealtime((evt) => {
    const ids = evt.material_ids ?? [];
    if (!ids.length) return;
    for (const id of ids) detailCache.delete(id);
    ids.filter((id) => openIds.has(id)).forEach(renderDetail);
  });
  onCleanup(stop);

  async function load() {
    const params = new URLSearchParams({ page: String(stockState.page), limit: '25' });
    if (stockState.q) params.set('q', stockState.q);
    const data = await api('GET', `/api/stock-levels?${params}`);
    if (token !== routeToken) return; // a newer render took over
    host.innerHTML = `
      <table class="table">
        <thead><tr><th>Material</th><th class="num">On hand</th><th class="num">Batches</th><th class="num">Stock value</th><th></th></tr></thead>
        <tbody>
          ${
            data.rows.length
              ? data.rows
                  .map(
                    (r) => `
            <tr class="clickable" data-id="${esc(r.id)}">
              <td><div class="cell-title">${esc(r.name)}</div><div class="sub mono">${esc(r.model_number ?? '')}</div></td>
              <td class="num strong">${fmtQty(r.qty)} ${esc(r.default_unit ?? '')}
                ${Number(r.qty) <= Number(r.reorder_point) ? '<span class="badge partial" style="margin-left:6px">low</span>' : ''}</td>
              <td class="num">${r.batch_count}</td>
              <td class="num">$${fmtMoney(r.value)}</td>
              <td class="num"><span class="chev">▸</span></td>
            </tr>
            <tr class="batch-detail hidden" data-for="${esc(r.id)}"><td colspan="5"></td></tr>`
                  )
                  .join('')
              : '<tr><td colspan="5"><div class="empty"><div class="big">No materials match</div>Adjust the search.</div></td></tr>'
          }
        </tbody>
      </table>`;
    $('#st-info').textContent = `page ${stockState.page + 1} of ${Math.max(1, Math.ceil(data.total / 25))} · ${data.total} materials with stock`;
    $('#st-prev').disabled = stockState.page === 0;
    $('#st-next').disabled = (stockState.page + 1) * 25 >= data.total;
    setStatus('Stock levels', `${data.rows.length} rows · page ${stockState.page + 1} · ${metrics.lastMs} ms`);
  }

  $('#st-q').addEventListener(
    'input',
    debounce((e) => {
      stockState.q = e.target.value.trim();
      stockState.page = 0;
      load();
    }, 250)
  );
  $('#st-prev').addEventListener('click', () => {
    stockState.page = Math.max(0, stockState.page - 1);
    load();
  });
  $('#st-next').addEventListener('click', () => {
    stockState.page += 1;
    load();
  });

  await load();
}

/* -------------------------------------------------------------- movements */

async function viewMovements(materialId, token = routeToken) {
  setActiveNav('stock');
  const view = $('#view');
  view.innerHTML = skeletons(6);
  const first = await api('GET', `/api/movements?material_id=${encodeURIComponent(materialId)}`);
  if (token !== routeToken) return; // a newer render took over
  const m = first.material;
  const mvState = { from: '', to: '' };

  view.innerHTML = `
    <div class="crumb"><a href="#/stock">← Stock levels</a><span>/</span><span>${esc(m.name)}</span></div>
    <div class="page-head">
      <div>
        <h1>${esc(m.name)}</h1>
        <div class="sub mono" id="mv-sub"></div>
      </div>
      <div class="spacer"></div>
      <div class="toolbar" style="margin:0">
        <label class="field">From<input class="input small" type="date" id="mv-from" /></label>
        <label class="field">To<input class="input small" type="date" id="mv-to" /></label>
        <button class="btn small" id="mv-clear" type="button">Clear</button>
      </div>
    </div>
    <div class="card">
      <div class="table-wrap" id="mv-table"></div>
    </div>`;

  async function load() {
    const params = new URLSearchParams({ material_id: materialId });
    if (mvState.from) params.set('from', mvState.from);
    if (mvState.to) params.set('to', mvState.to);
    const data = await api('GET', `/api/movements?${params}`);
    if (token !== routeToken) return; // a newer render took over
    const shown = data.rows.slice(0, 300);
    $('#mv-sub').textContent = `${data.material.model_number ?? ''} · ${data.count} movements · opening balance ${fmtQty(data.opening)}${data.count > 300 ? ' · showing first 300' : ''}`;
    $('#mv-table').innerHTML = `
      <table class="table">
        <thead><tr><th>Date</th><th>Type</th><th>Document</th><th>Batch</th><th class="num">Qty</th><th class="num">Running</th><th>Note</th></tr></thead>
        <tbody>
          ${
            shown.length
              ? shown
                  .map(
                    (r) => `
              <tr>
                <td>${fmtDate(r.date)}</td>
                <td><span class="badge ${esc(r.type)}">${esc(r.type)}</span></td>
                <td class="mono" style="font-size:12px">${esc(r.document_no ?? (r.document_id ? shortId(r.document_id, 10) : '—'))}</td>
                <td class="mono" style="font-size:12px">${r.batch_id ? esc(shortId(r.batch_id, 10)) : '<span class="muted">—</span>'}</td>
                <td class="num ${r.signed >= 0 ? 'amount pos' : 'amount neg'} strong">${r.signed >= 0 ? '+' : ''}${fmtQty(r.signed)}</td>
                <td class="num">${fmtQty(r.running)}</td>
                <td class="sub" style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.notes)}">${esc(r.notes)}</td>
              </tr>`
                  )
                  .join('')
              : '<tr><td colspan="7"><div class="empty">No movements in this range.</div></td></tr>'
          }
        </tbody>
      </table>`;
    setStatus('Movement report', `${shown.length} of ${data.count} rows · ${metrics.lastMs} ms`);
  }

  $('#mv-from').addEventListener('change', (e) => {
    mvState.from = e.target.value;
    load();
  });
  $('#mv-to').addEventListener('change', (e) => {
    mvState.to = e.target.value;
    load();
  });
  $('#mv-clear').addEventListener('click', () => {
    mvState.from = '';
    mvState.to = '';
    $('#mv-from').value = '';
    $('#mv-to').value = '';
    load();
  });

  await load();
}

/* ==========================================================================
   ROUTER
   ========================================================================== */

/**
 * Render tokens: every router() run bumps the token. A view that is still
 * awaiting its data when a newer render starts (a user navigation racing an
 * SSE-triggered refresh, for example) bails out instead of writing into the
 * newer view's DOM.
 */
let routeToken = 0;

async function router() {
  const token = ++routeToken;
  cleanups.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
  cleanups = [];
  if (!currentUser) {
    await showAuth('login');
    return;
  }
  const { parts, query } = parseHash();
  const view = $('#view');
  view.classList.remove('anim');
  void view.offsetWidth; // restart the entrance animation
  view.classList.add('anim');
  try {
    if (parts[0] === 'invoice' && parts[1] === 'new') await viewEditor(null, query.material, token);
    else if (parts[0] === 'invoice' && parts[1]) await viewEditor(parts[1], null, token);
    else if (parts[0] === 'invoices') await viewInvoices(query.q, token);
    else if (parts[0] === 'stock') await viewStock(query.q, token);
    else if (parts[0] === 'movements' && parts[1]) await viewMovements(parts[1], token);
    else await viewDashboard(token);
  } catch (err) {
    if (err.status === 401) return; // showAuth already handled it
    console.error(err);
    if (token !== routeToken) return;
    view.innerHTML = `<div class="card"><div class="empty"><div class="big">Something went wrong</div>${esc(err.message)}</div></div>`;
  }
}

/* ==========================================================================
   CHROME (logout, demo tools)
   ========================================================================== */

const FAKE_SIZES = {
  small: { materials: 40, vendors: 6, customers: 15, receipts: 20, invoices: 60, pos: 15 },
  medium: { materials: 120, vendors: 10, customers: 40, receipts: 60, invoices: 180, pos: 40 },
  large: { materials: 300, vendors: 16, customers: 90, receipts: 140, invoices: 420, pos: 90 },
};

async function hasData() {
  try {
    const meta = await api('GET', '/api/meta');
    return meta.tables.documents > 0;
  } catch {
    return false;
  }
}

async function generateSampleData(size = 'small') {
  const preset = FAKE_SIZES[size] ?? FAKE_SIZES.small;
  if (await hasData()) {
    const ok = await confirmDialog({
      title: 'Replace current data?',
      body: 'Generated sample data will replace everything currently in this workspace.',
      confirmText: 'Replace data',
      danger: true,
    });
    if (!ok) return null;
  }
  const t0 = performance.now();
  const out = await api('POST', '/api/demo/generate-fake', { reset: true, ...preset });
  out.clientMs = Math.round(performance.now() - t0);
  toast('Sample data generated', `${out.materials} materials · ${out.receipts} receipts · ${out.invoices} invoices · ${out.clientMs} ms`, 'ok', 5000);
  return out;
}

async function loadMaskedDataset() {
  if (await hasData()) {
    const ok = await confirmDialog({
      title: 'Replace current data?',
      body: 'The masked production dataset will replace everything currently in this workspace.',
      confirmText: 'Load dataset',
      danger: true,
    });
    if (!ok) return null;
  }
  const t0 = performance.now();
  const out = await api('POST', '/api/demo/load-dataset', { force: true });
  out.clientMs = Math.round(performance.now() - t0);
  toast('Masked dataset loaded', `${out.docs.toLocaleString()} records · ${out.clientMs} ms`, 'ok', 5000);
  return out;
}

function wireChrome() {
  wirePalette();

  $('#logout-btn').addEventListener('click', async () => {
    try {
      await rawApi('POST', '/api/auth/logout');
    } catch {
      /* ignore */
    }
    await showAuth('login');
  });

  $('#demo-toggle').addEventListener('click', () => $('#demo-panel').toggleAttribute('hidden'));
  $('#demo-close').addEventListener('click', () => $('#demo-panel').setAttribute('hidden', ''));

  const wire = (id, out, fn) => {
    $(id).addEventListener('click', async () => {
      const btn = $(id);
      const host = $(out);
      btn.disabled = true;
      host.textContent = 'working…';
      try {
        const res = await fn();
        if (res !== null && res !== undefined) host.innerHTML = res;
      } catch (err) {
        host.innerHTML = `<span style="color:var(--bad)">${esc(err.message)}</span>`;
      } finally {
        btn.disabled = false;
      }
    });
  };

  /* data tools */
  wire('#demo-fake', '#demo-out-data', async () => {
    const r = await generateSampleData($('#fake-size').value);
    if (!r) return null;
    return `${r.materials} materials · ${r.vendors} vendors · ${r.customers} customers<br/>${r.receipts} receipts · ${r.invoices} invoices · ${r.purchaseOrders} POs · ${r.adjustments} adjustments<br/>server ${r.ms} ms`;
  });
  wire('#demo-load-dataset', '#demo-out-data', async () => {
    const r = await loadMaskedDataset();
    if (!r) return null;
    return `${r.docs.toLocaleString()} records · ${r.collections.length} collections<br/>server ${r.ms} ms`;
  });
  wire('#demo-wipe', '#demo-out-data', async () => {
    const ok = await confirmDialog({
      title: 'Wipe all business data?',
      body: 'Documents, stock, invoices and movements are removed. Accounts are kept.',
      confirmText: 'Wipe data',
      danger: true,
    });
    if (!ok) return null;
    await api('POST', '/api/demo/wipe', { confirm: 'wipe' });
    return 'All business data wiped.';
  });

  /* live scenario */
  let demoMaterialId = null;
  wire('#demo-step1', '#demo-out1', async () => {
    const t0 = performance.now();
    const out = await api('POST', '/api/demo/setup-material', {});
    demoMaterialId = out.material.id;
    const ms = Math.round(performance.now() - t0);
    return `${esc(out.material.name)} — 12 units in 2 batches (${esc(out.receipt.receipt_number)}) · ${ms} ms<br/><a href="#/invoice/new?material=${encodeURIComponent(out.material.id)}">open in editor →</a>`;
  });
  wire('#demo-step2', '#demo-out2', async () => {
    if (!demoMaterialId) throw new Error('Run step 1 first.');
    const out = await api('POST', '/api/demo/colleague-sale', { material_id: demoMaterialId, quantity: 10 });
    return `${esc(out.invoice.invoice_number)} — sold 10 units from ${out.sold_from_batches.length} batch(es)`;
  });
  wire('#demo-step3', '#demo-out3', async () => {
    const t0 = performance.now();
    const out = await api('POST', '/api/demo/receipt-60', {});
    const ms = Math.round(performance.now() - t0);
    return `${esc(out.receipt.receipt_number)} — ${out.receipt.batches_created} batches, ${out.receipt.movements} movements · ${ms} ms`;
  });
}

/* ------------------------------------------------------------------- boot */

async function boot() {
  wireChrome();
  window.addEventListener('hashchange', router);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.combo')) $$('.combo-list').forEach((l) => l.classList.add('hidden'));
  }, { capture: true });
  try {
    // one call: who am I + does this install have accounts yet
    const st = await rawApi('GET', '/api/auth/status', undefined, true);
    if (!st.user) return await showAuth();
    currentUser = st.user;
    await enterApp();
  } catch {
    await showAuth();
  }
}

boot();
