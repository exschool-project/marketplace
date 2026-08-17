// Dedicated Repositories page (#/repositories) — previously this route
// just bounced back to the dashboard. All data here is real: repos come
// from GET /github/repos (same endpoint the dashboard uses, just fetched
// with a higher per_page since this page is the actual full listing).
import { api, onRoute } from './app.js';
import { t } from './i18n.js';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const PAGE_SIZE = 8;

// Rough approximation of GitHub's own per-language dot colors — falls
// back to a neutral gray dot for anything not in this short list rather
// than guessing at a color for it.
const LANG_COLORS = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  HTML: '#e34c26',
  CSS: '#563d7c',
  'Next.js': '#ffffff',
  Java: '#b07219',
  Go: '#00ADD8',
  Rust: '#dea584',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Shell: '#89e051',
  Vue: '#41b883',
};

function langColor(lang) {
  return LANG_COLORS[lang] || 'var(--muted)';
}

function avatarClass(name) {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return `repo-avatar--${sum % 8}`;
}

function initials(name) {
  const parts = name.replace(/[-_]/g, ' ').split(' ').filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

let allRepos = [];
let state = { tab: 'all', search: '', sort: 'updated', page: 1 };

const els = {
  totalCount: document.getElementById('repoPageTotalCount'),
  publicCount: document.getElementById('repoPagePublicCount'),
  privateCount: document.getElementById('repoPagePrivateCount'),
  recentCount: document.getElementById('repoPageRecentCount'),
  tabs: document.getElementById('repoPageTabs'),
  sort: document.getElementById('repoPageSort'),
  search: document.getElementById('repoSearchInput'),
  filterBtn: document.getElementById('repoFilterBtn'),
  refreshBtn: document.getElementById('repoPageRefreshBtn'),
  rows: document.getElementById('repoPageRows'),
  pagination: document.getElementById('repoPagePagination'),
  githubStatus: document.getElementById('repoPageGithubStatus'),
  vercelStatus: document.getElementById('repoPageVercelStatus'),
};

function renderStatCards(repos) {
  const total = repos.length;
  const publicCount = repos.filter((r) => !r.private).length;
  const privateCount = total - publicCount;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentCount = repos.filter((r) => new Date(r.updated_at).getTime() >= weekAgo).length;
  if (els.totalCount) els.totalCount.textContent = total;
  if (els.publicCount) els.publicCount.textContent = publicCount;
  if (els.privateCount) els.privateCount.textContent = privateCount;
  if (els.recentCount) els.recentCount.textContent = recentCount;
}

function applyFilters() {
  let repos = allRepos.slice();

  if (state.tab === 'public') repos = repos.filter((r) => !r.private);
  else if (state.tab === 'private') repos = repos.filter((r) => r.private);
  else if (state.tab === 'fork') repos = repos.filter((r) => r.fork);
  else if (state.tab === 'archived') repos = repos.filter((r) => r.archived);

  if (state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    repos = repos.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q)
    );
  }

  if (state.sort === 'name') repos.sort((a, b) => a.name.localeCompare(b.name));
  else if (state.sort === 'stars') repos.sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0));
  else repos.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  return repos;
}

function renderRows(repos) {
  if (!els.rows) return;
  if (!repos.length) {
    els.rows.innerHTML = `<p class="muted" style="padding:16px 6px">${t('repos_empty')}</p>`;
    return;
  }

  const start = (state.page - 1) * PAGE_SIZE;
  const pageRepos = repos.slice(start, start + PAGE_SIZE);

  els.rows.innerHTML = pageRepos
    .map((r) => {
      const updated = new Date(r.updated_at).toLocaleString();
      return `
      <div class="repo-table__row">
        <a class="repo-table__main" href="#/repo/${esc(r.full_name)}" style="text-decoration:none;color:inherit">
          <span class="repo-avatar ${avatarClass(r.name)}">${esc(initials(r.name))}</span>
          <div class="repo-table__info">
            <div class="repo-table__name">
              ${esc(r.name)}
              ${r.stargazers_count ? `<svg viewBox="0 0 24 24" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>` : ''}
            </div>
            ${r.description ? `<div class="repo-table__desc">${esc(r.description)}</div>` : ''}
            ${r.language ? `<span class="repo-table__lang"><i class="dash-dot" style="background:${langColor(r.language)};width:8px;height:8px"></i>${esc(r.language)}</span>` : ''}
          </div>
        </a>
        <span><span class="tag ${r.private ? '' : 'tag--success'}" ${r.private ? 'style="color:var(--accent);border-color:var(--accent);background:var(--panel-2)"' : ''}>${r.private ? t('stat_private_repos') : t('stat_public_repos')}</span></span>
        <span class="repo-table__updated">${updated}</span>
        <span class="repo-table__actions-cell">
          <a class="repo-table__icon-btn" href="#/repo/${esc(r.full_name)}" title="${esc(t('repos_open_upgit'))}">
            <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          </a>
          <button class="repo-table__icon-btn repo-menu-btn" data-full-name="${esc(r.full_name)}" title="More">
            <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
          </button>
        </span>
      </div>`;
    })
    .join('');

  els.rows.querySelectorAll('.repo-menu-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenus();
      const fullName = btn.dataset.fullName;
      const menu = document.createElement('div');
      menu.className = 'repo-table__menu';
      menu.innerHTML = `
        <a href="#/repo/${esc(fullName)}">${esc(t('repos_open_upgit'))}</a>
        <a href="https://github.com/${esc(fullName)}" target="_blank" rel="noopener">${esc(t('repos_open_github'))}</a>
      `;
      btn.parentElement.appendChild(menu);
    });
  });
}

function closeMenus() {
  document.querySelectorAll('.repo-table__menu').forEach((m) => m.remove());
}
document.addEventListener('click', closeMenus);

function renderPagination(total) {
  if (!els.pagination) return;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  state.page = Math.min(state.page, pageCount);
  const from = total === 0 ? 0 : (state.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(state.page * PAGE_SIZE, total);

  const pageBtns = [];
  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p === pageCount || Math.abs(p - state.page) <= 1) {
      pageBtns.push(`<button class="repo-page-btn ${p === state.page ? 'is-active' : ''}" data-page="${p}">${p}</button>`);
    } else if (pageBtns[pageBtns.length - 1] !== '<span class="muted">\u2026</span>') {
      pageBtns.push('<span class="muted">\u2026</span>');
    }
  }

  els.pagination.innerHTML = `
    <span class="muted" style="font-size:12.5px">${t('repos_showing', { from, to, total })}</span>
    <div class="repo-pagination__pages">
      <button class="repo-page-btn" id="repoPagePrev" ${state.page <= 1 ? 'disabled' : ''}>&lsaquo;</button>
      ${pageBtns.join('')}
      <button class="repo-page-btn" id="repoPageNext" ${state.page >= pageCount ? 'disabled' : ''}>&rsaquo;</button>
    </div>
  `;

  document.getElementById('repoPagePrev')?.addEventListener('click', () => {
    state.page = Math.max(1, state.page - 1);
    renderAll();
  });
  document.getElementById('repoPageNext')?.addEventListener('click', () => {
    state.page = Math.min(pageCount, state.page + 1);
    renderAll();
  });
  els.pagination.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.page = Number(btn.dataset.page);
      renderAll();
    });
  });
}

function renderAll() {
  const filtered = applyFilters();
  renderRows(filtered);
  renderPagination(filtered.length);
}

async function loadRepos() {
  if (els.rows) els.rows.innerHTML = `<p class="muted" style="padding:16px 6px">${t('loading')}</p>`;
  try {
    const { repositories } = await api('/github/repos?per_page=100');
    allRepos = repositories;
    renderStatCards(allRepos);
    state.page = 1;
    renderAll();
  } catch (err) {
    if (els.rows) {
      els.rows.innerHTML =
        err.status === 409
          ? `<p class="muted" style="padding:16px 6px">${t('auth_gate_text')} <a href="#/connect" style="color:var(--accent)">${t('connect_title')} \u2192</a></p>`
          : `<p class="muted" style="padding:16px 6px">${esc(err.message)}</p>`;
    }
  }
}

async function loadConnections() {
  try {
    const { user } = await api('/auth/me');
    if (els.githubStatus) {
      els.githubStatus.innerHTML = `<span class="repo-conn-card__dot"></span><span>${t('conn_connected_as', { name: user.github_username })}</span>`;
    }
  } catch {
    if (els.githubStatus) els.githubStatus.innerHTML = `<span class="repo-conn-card__dot repo-conn-card__dot--off"></span><span>${t('conn_not_connected')}</span>`;
  }

  try {
    const conn = await api('/vercel/connection');
    if (els.vercelStatus) {
      els.vercelStatus.innerHTML = conn.connected
        ? `<span class="repo-conn-card__dot"></span><span>${t('conn_connected')}</span>`
        : `<span class="repo-conn-card__dot repo-conn-card__dot--off"></span><span>${t('conn_not_connected')}</span>`;
    }
  } catch {
    if (els.vercelStatus) els.vercelStatus.innerHTML = `<span class="repo-conn-card__dot repo-conn-card__dot--off"></span><span>${t('conn_not_connected')}</span>`;
  }
}

// ---------------- Wiring ----------------

els.tabs?.addEventListener('click', (e) => {
  const btn = e.target.closest('.repo-tab');
  if (!btn) return;
  els.tabs.querySelectorAll('.repo-tab').forEach((b) => b.classList.remove('is-active'));
  btn.classList.add('is-active');
  state.tab = btn.dataset.filter;
  state.page = 1;
  renderAll();
});

els.sort?.addEventListener('change', () => {
  state.sort = els.sort.value;
  state.page = 1;
  renderAll();
});

let searchDebounce;
els.search?.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    state.search = els.search.value;
    state.page = 1;
    renderAll();
  }, 150);
});

// The "/" hint next to the search box is a real shortcut, not decoration.
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || !els.search) return;
  const view = document.getElementById('view-repositories');
  if (!view || !view.classList.contains('is-active')) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  e.preventDefault();
  els.search.focus();
});

// Clears every filter back to defaults — the button's one real function
// rather than a decorative dead click.
els.filterBtn?.addEventListener('click', () => {
  state = { tab: 'all', search: '', sort: 'updated', page: 1 };
  if (els.search) els.search.value = '';
  if (els.sort) els.sort.value = 'updated';
  els.tabs?.querySelectorAll('.repo-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.filter === 'all'));
  renderAll();
});

els.refreshBtn?.addEventListener('click', loadRepos);

onRoute('repositories', () => {
  loadRepos();
  loadConnections();
});
