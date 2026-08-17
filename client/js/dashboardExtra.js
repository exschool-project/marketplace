// Dashboard "overview" widgets — everything beyond the original repo
// stat cards + repo list (which stay exactly as app.js already renders
// them). All data here is real:
//   - greeting/date: the signed-in user + today's date
//   - deployment stats, chart, donut, recent list: GET /vercel/deployments
//     and /vercel/deployments/summary — reads 0/empty gracefully when
//     Vercel isn't connected yet, rather than erroring the whole page.
import { api, onRoute } from './app.js';
import { t } from './i18n.js';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function statusTag(state) {
  const s = String(state || '').toUpperCase();
  let cls = '';
  if (s === 'READY') cls = 'tag--success';
  else if (s === 'ERROR' || s === 'CANCELED') cls = 'tag--danger';
  else if (s === 'BUILDING' || s === 'QUEUED' || s === 'INITIALIZING') cls = 'tag--warn';
  return `<span class="tag ${cls}">${esc(s || 'UNKNOWN')}</span>`;
}

// ---------------- Greeting + date badge ----------------

async function renderGreeting() {
  const heading = document.getElementById('dashGreeting');
  const sub = heading?.nextElementSibling;
  if (sub) sub.textContent = t('dashboard_greeting_sub');
  if (heading) {
    try {
      const { user } = await api('/auth/me');
      heading.textContent = t('dashboard_greeting', { name: user.github_username });
    } catch {
      // Not signed in yet — leave the static "Dashboard" fallback text.
    }
  }
  const dateEl = document.getElementById('dashDateText');
  if (dateEl) {
    const locale = document.documentElement.lang === 'id' ? 'id-ID' : 'en-US';
    dateEl.textContent = new Date().toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  }
}

// ---------------- Deployment summary: stat cards + chart + donut ----------------

function formatDuration(seconds) {
  if (seconds == null) return '\u2014';
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

function renderStatCards(summary, totalCommits) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set('statTotalDeploys', summary.total);
  set('statSuccessDeploys', summary.successful);
  set('statFailedDeploys', summary.failed);
  set('statTotalCommits', totalCommits);
  set('statAvgDeployTime', formatDuration(summary.avg_deploy_seconds));
}

// Hand-rolled SVG line chart — no charting library in this project, and
// this dashboard's needs (two lines, a handful of points, tooltip on
// hover) don't justify pulling one in.
function renderChart(daily) {
  const wrap = document.getElementById('dashChart');
  if (!wrap) return;
  if (!daily.length) {
    wrap.innerHTML = `<p class="muted">${t('dash_no_deploys')}</p>`;
    return;
  }

  const W = 560;
  const H = 180;
  const padL = 28;
  const padB = 20;
  const padT = 10;
  const maxVal = Math.max(1, ...daily.map((d) => Math.max(d.successful, d.failed)));
  const stepX = (W - padL - 8) / Math.max(1, daily.length - 1);
  const yFor = (v) => padT + (H - padT - padB) * (1 - v / maxVal);
  const xFor = (i) => padL + i * stepX;

  const linePath = (key) =>
    daily.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(d[key]).toFixed(1)}`).join(' ');
  const areaPath = (key) =>
    `${linePath(key)} L ${xFor(daily.length - 1).toFixed(1)} ${yFor(0).toFixed(1)} L ${xFor(0).toFixed(1)} ${yFor(0).toFixed(1)} Z`;

  const gridLines = [0, 0.5, 1]
    .map((f) => `<line class="dash-chart__grid" x1="${padL}" x2="${W - 4}" y1="${(padT + (H - padT - padB) * f).toFixed(1)}" y2="${(padT + (H - padT - padB) * f).toFixed(1)}" />`)
    .join('');

  const labelEvery = daily.length > 10 ? Math.ceil(daily.length / 7) : 1;
  const xLabels = daily
    .map((d, i) => {
      if (i % labelEvery !== 0 && i !== daily.length - 1) return '';
      const label = new Date(d.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
      return `<text class="dash-chart__axis-label" x="${xFor(i).toFixed(1)}" y="${H - 2}" text-anchor="middle">${label}</text>`;
    })
    .join('');

  const dots = (key, cls) =>
    daily
      .map(
        (d, i) =>
          `<circle class="dash-chart__dot" data-i="${i}" data-key="${key}" cx="${xFor(i).toFixed(1)}" cy="${yFor(d[key]).toFixed(1)}" r="3.5" fill="var(--${cls})" />`
      )
      .join('');

  wrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <g>${gridLines}</g>
      <path class="dash-chart__area--success" d="${areaPath('successful')}" />
      <path class="dash-chart__line--success" d="${linePath('successful')}" />
      <path class="dash-chart__area--danger" d="${areaPath('failed')}" />
      <path class="dash-chart__line--danger" d="${linePath('failed')}" />
      ${dots('successful', 'success')}
      ${dots('failed', 'danger')}
      ${xLabels}
    </svg>
    <div class="dash-chart__tooltip" id="dashChartTooltip"></div>
  `;

  const tooltip = document.getElementById('dashChartTooltip');
  wrap.querySelectorAll('.dash-chart__dot').forEach((dot) => {
    dot.addEventListener('mouseenter', (e) => {
      const i = Number(dot.dataset.i);
      const key = dot.dataset.key;
      const d = daily[i];
      const label = new Date(d.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
      tooltip.textContent = `${label} \u2014 ${key === 'successful' ? t('dash_successful') : t('dash_failed')}: ${d[key]}`;
      const rect = wrap.getBoundingClientRect();
      const cx = (Number(dot.getAttribute('cx')) / W) * rect.width;
      const cy = (Number(dot.getAttribute('cy')) / H) * rect.height;
      tooltip.style.left = `${cx}px`;
      tooltip.style.top = `${cy - 8}px`;
      tooltip.classList.add('is-visible');
    });
    dot.addEventListener('mouseleave', () => tooltip.classList.remove('is-visible'));
  });
}

function renderDonut(summary) {
  const wrap = document.getElementById('dashDonut');
  if (!wrap) return;
  const total = summary.total || 0;
  if (!total) {
    wrap.innerHTML = `<p class="muted">${t('dash_no_deploys')}</p>`;
    return;
  }

  const R = 46;
  const C = 2 * Math.PI * R;
  const segs = [
    { val: summary.successful, color: 'var(--success)' },
    { val: summary.failed, color: 'var(--danger)' },
    { val: summary.building, color: 'var(--primary)' },
  ];
  let offset = 0;
  const circles = segs
    .filter((s) => s.val > 0)
    .map((s) => {
      const len = (s.val / total) * C;
      const dash = `${len.toFixed(2)} ${(C - len).toFixed(2)}`;
      const circle = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${s.color}" stroke-width="14" stroke-dasharray="${dash}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 60 60)" />`;
      offset += len;
      return circle;
    })
    .join('');

  const pct = (v) => `${((v / total) * 100).toFixed(1)}%`;

  wrap.innerHTML = `
    <svg class="dash-donut" width="120" height="120" viewBox="0 0 120 120">
      ${circles}
      <text x="60" y="56" text-anchor="middle" class="dash-donut__center dash-donut__total">${total}</text>
      <text x="60" y="72" text-anchor="middle" class="dash-donut__center dash-donut__label">${t('stat_total_deploys')}</text>
    </svg>
    <div class="dash-donut-legend">
      <div class="dash-donut-legend__row">
        <span class="dash-donut-legend__label"><i class="dash-dot dash-dot--success"></i>${t('dash_successful')}</span>
        <span>${summary.successful} (${pct(summary.successful)})</span>
      </div>
      <div class="dash-donut-legend__row">
        <span class="dash-donut-legend__label"><i class="dash-dot dash-dot--danger"></i>${t('dash_failed')}</span>
        <span>${summary.failed} (${pct(summary.failed)})</span>
      </div>
      <div class="dash-donut-legend__row">
        <span class="dash-donut-legend__label"><i class="dash-dot dash-dot--building"></i>${t('dash_building')}</span>
        <span>${summary.building} (${pct(summary.building)})</span>
      </div>
    </div>
  `;
}

function renderRecentDeploys(deployments) {
  const wrap = document.getElementById('dashRecentDeploys');
  if (!wrap) return;
  if (!deployments.length) {
    wrap.innerHTML = `<p class="muted">${t('dash_no_deploys')}</p>`;
    return;
  }
  wrap.innerHTML = deployments
    .slice(0, 6)
    .map((d) => {
      const state = d.state || d.readyState;
      const created = d.created || d.createdAt;
      return `
      <a class="repo-item" href="#/vercel/deployments/${esc(d.uid)}">
        <div>
          <div class="repo-item__name">${esc(d.name || d.url || d.uid)}</div>
          <div class="repo-item__meta">${d.target === 'production' ? 'Production' : (d.target || 'Preview')} \u00b7 ${created ? new Date(created).toLocaleString() : ''}</div>
        </div>
        ${statusTag(state)}
      </a>`;
    })
    .join('');
}

async function loadDeploymentOverview(days) {
  const chartEl = document.getElementById('dashChart');
  const donutEl = document.getElementById('dashDonut');
  if (chartEl) chartEl.innerHTML = `<p class="muted">${t('loading')}</p>`;
  if (donutEl) donutEl.innerHTML = `<p class="muted">${t('loading')}</p>`;

  try {
    const summary = await api(`/vercel/deployments/summary?days=${days}`);
    renderChart(summary.daily);
    renderDonut(summary);
    return summary;
  } catch (err) {
    // 409 = Vercel not connected yet — a normal, expected state here, not
    // an error worth alarming the user about on their main dashboard.
    const msg = err.status === 409 ? t('dash_connect_vercel_hint') : err.message;
    if (chartEl) chartEl.innerHTML = `<p class="muted">${esc(msg)}</p>`;
    if (donutEl) donutEl.innerHTML = `<p class="muted">${esc(msg)}</p>`;
    renderStatCards({ total: 0, successful: 0, failed: 0, building: 0, avg_deploy_seconds: null }, '0');
    return null;
  }
}

async function loadRecentDeploys() {
  const wrap = document.getElementById('dashRecentDeploys');
  try {
    const { deployments = [] } = await api('/vercel/deployments?limit=6');
    renderRecentDeploys(deployments);
  } catch (err) {
    if (wrap) wrap.innerHTML = `<p class="muted">${err.status === 409 ? t('dash_connect_vercel_hint') : esc(err.message)}</p>`;
  }
}

async function loadTotalCommits() {
  try {
    const stats = await api('/stats');
    return stats.total_pushes ?? 0;
  } catch {
    return 0;
  }
}

async function loadAll(days = 7) {
  const [summary, totalCommits] = await Promise.all([loadDeploymentOverview(days), loadTotalCommits(), loadRecentDeploys()]);
  if (summary) renderStatCards(summary, totalCommits);
}

// ---------------- Wiring ----------------

const rangeSelect = document.getElementById('dashChartRange');
if (rangeSelect) {
  rangeSelect.addEventListener('change', () => loadAll(Number(rangeSelect.value)));
}

window.addEventListener('i18n:change', () => {
  renderGreeting();
  // Re-render whatever's currently on screen with the new language's
  // labels (tooltips, "no deployments yet", etc.) without a network
  // round-trip — cheapest is just reloading the current range.
  if (document.getElementById('dashboardContent') && !document.getElementById('dashboardContent').classList.contains('hidden')) {
    loadAll(Number(rangeSelect?.value || 7));
  }
});

onRoute('dashboard', () => {
  renderGreeting();
  loadAll(Number(rangeSelect?.value || 7));
});
