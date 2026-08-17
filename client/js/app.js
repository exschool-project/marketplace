import { API_BASE } from './config.js';
import { t } from './i18n.js';

export async function api(path, opts) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: opts?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
  return data;
}

const els = {
  loginBtn: document.getElementById('loginBtn'),
  loginBtn2: document.getElementById('loginBtn2'),
  accountSlot: document.getElementById('accountSlot'),
  authGate: document.getElementById('authGate'),
  dashboardContent: document.getElementById('dashboardContent'),
  landingPage: document.getElementById('landingPage'),
  signinPage: document.getElementById('signinPage'),
  appShell: document.querySelector('.app-shell'),
  repoList: document.getElementById('repoList'),
  nav: document.getElementById('mainNav'),
  statRepoCount: document.getElementById('statRepoCount'),
  statPublicCount: document.getElementById('statPublicCount'),
  statPrivateCount: document.getElementById('statPrivateCount'),
  statRecentCount: document.getElementById('statRecentCount'),
};

function goLogin() {
  window.location.hash = '#/connect';
}
els.loginBtn.addEventListener('click', goLogin);
els.loginBtn2.addEventListener('click', goLogin);

document.getElementById('quickConnectBtn').addEventListener('click', () => {
  window.location.href = `${API_BASE}/auth/github/oauth`;
});
document.getElementById('developerConnectBtn').addEventListener('click', () => {
  window.location.href = `${API_BASE}/auth/github`;
});
document.getElementById('signinGithubBtn')?.addEventListener('click', () => {
  window.location.href = `${API_BASE}/auth/github/oauth`;
});
document.getElementById('signinGithubAppBtn')?.addEventListener('click', () => {
  window.location.href = `${API_BASE}/auth/github`;
});

// Vercel-only sign-in is still beta: there's no backend session type yet
// for an account with no GitHub identity attached (every profile needs a
// GitHub user id), so this collects the token and explains that plainly
// rather than pretending it works end-to-end.
const vercelToggle = document.getElementById('signinVercelToggle');
const vercelForm = document.getElementById('signinVercelForm');
vercelToggle?.addEventListener('click', () => {
  const willOpen = !vercelForm.classList.contains('is-open');
  vercelForm.classList.toggle('is-open', willOpen);
  vercelToggle.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) document.getElementById('signinVercelToken')?.focus();
});
document.getElementById('signinVercelSubmit')?.addEventListener('click', () => {
  const token = document.getElementById('signinVercelToken')?.value.trim();
  const note = document.getElementById('signinVercelNote');
  if (!token) {
    note.textContent = t('signin_vercel_note_empty');
    return;
  }
  note.textContent = t('signin_vercel_note_beta');
});

document.getElementById('signinGuestLink')?.addEventListener('click', (e) => {
  e.preventDefault();
  showApp();
  window.location.hash = '#/dashboard';
});

document.querySelectorAll('.landing__why-item').forEach((a) => {
  a.addEventListener('click', (e) => e.preventDefault());
});

const landingMenuBtn = document.getElementById('landingMenuBtn');
const landingMenu = document.getElementById('landingMenu');
if (landingMenuBtn && landingMenu) {
  landingMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = !landingMenu.classList.contains('is-open');
    landingMenu.classList.toggle('is-open', willOpen);
    landingMenuBtn.setAttribute('aria-expanded', String(willOpen));
  });
  document.addEventListener('click', () => landingMenu.classList.remove('is-open'));
  landingMenu.addEventListener('click', (e) => e.stopPropagation());
}

function renderAccount(user) {
  els.accountSlot.innerHTML = `
    <img src="${user.avatar_url}" alt="" width="28" height="28" style="border-radius:3px" />
    <span style="font-family:var(--mono);font-size:13px;margin:0 8px">@${user.github_username}</span>
    <button id="logoutBtn" class="btn btn--sm" data-i18n="sign_out" title="Sign out">${t('sign_out')}</button>
  `;
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/';
    }
  });
}

function renderRepoList(repos) {
  if (!repos.length) {
    els.repoList.innerHTML = '<p class="muted">No repositories yet — create one on GitHub or install UPGit on more repos.</p>';
    return;
  }
  els.repoList.innerHTML = repos
    .slice(0, 8)
    .map(
      (r) => `
      <a class="repo-item" href="#/repo/${r.full_name}">
        <div>
          <div class="repo-item__name">${r.full_name}</div>
          <div class="repo-item__meta">Updated ${new Date(r.updated_at).toLocaleDateString()}</div>
        </div>
        <span class="repo-item__vis">${r.private ? 'private' : 'public'}</span>
      </a>`
    )
    .join('');
}

function renderStats(repos) {
  if (!els.statRepoCount) return;
  const total = repos.length;
  const publicCount = repos.filter((r) => !r.private).length;
  const privateCount = total - publicCount;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentCount = repos.filter((r) => new Date(r.updated_at).getTime() >= weekAgo).length;

  els.statRepoCount.textContent = total;
  els.statPublicCount.textContent = publicCount;
  els.statPrivateCount.textContent = privateCount;
  els.statRecentCount.textContent = recentCount;
}

function resetStats() {
  if (!els.statRepoCount) return;
  [els.statRepoCount, els.statPublicCount, els.statPrivateCount, els.statRecentCount].forEach((el) => {
    if (el) el.textContent = '0';
  });
}

async function loadDashboard() {
  els.repoList.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const { repositories } = await api('/github/repos?per_page=10');
    renderRepoList(repositories);
    renderStats(repositories);
  } catch (err) {
    resetStats();
    if (err.status === 409) {
      els.repoList.innerHTML = `<p class="muted">${t('auth_gate_text')} <a href="#/connect" style="color:var(--accent)">${t('connect_title')} →</a></p>`;
    } else {
      els.repoList.innerHTML = `<p class="muted">Failed to load repositories: ${err.message}</p>`;
    }
  }
}

// ---------------- Router ----------------
// Hash-based, since this is a static SPA with no server-side routing.
// Routes: #/dashboard, #/repo/:owner/:repo
export const views = {
  connect: document.getElementById('view-connect'),
  dashboard: document.getElementById('view-dashboard'),
  repositories: document.getElementById('view-repositories'),
  repo: document.getElementById('view-repo'),
  upload: document.getElementById('view-upload'),
  organizations: document.getElementById('view-organizations'),
  activity: document.getElementById('view-activity'),
  settings: document.getElementById('view-settings'),
  vercel: document.getElementById('view-vercel'),
  help: document.getElementById('view-help'),
  about: document.getElementById('view-about'),
};

const routeHandlers = {}; // registered by repo.js etc. via onRoute()
export function onRoute(name, handler) {
  routeHandlers[name] = handler;
}

function setActiveNav(viewName) {
  els.nav.querySelectorAll('.nav__item').forEach((a) => {
    a.classList.toggle('is-active', a.dataset.view === viewName);
  });
  document.querySelectorAll('.bottom-nav__item, .bottom-nav__fab').forEach((a) => {
    a.classList.toggle('is-active', a.dataset.view === viewName);
  });
}

function showView(name) {
  Object.values(views).forEach((v) => v.classList.remove('is-active', 'is-entering'));
  const target = views[name] || views.dashboard;
  target.classList.add('is-active');
  // Force a reflow before adding the animation class so the animation
  // reliably restarts even when navigating back to a view that still had
  // the class from before — without this, re-adding an already-present
  // class is a no-op and the animation wouldn't replay.
  void target.offsetWidth;
  target.classList.add('is-entering');
}

async function router() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean);

  if (parts[0] === 'connect') {
    showView('connect');
    setActiveNav('');
    return;
  }

  if (parts[0] === 'install-app') {
    showView('connect');
    setActiveNav('');
    document.getElementById('connectError').textContent = t('install_app_notice');
    return;
  }

  if (parts[0] === 'repo' && parts[1] && parts[2]) {
    showView('repo');
    setActiveNav('repositories');
    routeHandlers.repo?.(parts[1], parts[2]);
    return;
  }

  if (parts[0] === 'repositories') {
    showView('repositories');
    setActiveNav('repositories');
    routeHandlers.repositories?.();
    return;
  }

  if (parts[0] === 'upload') {
    showView('upload');
    setActiveNav('upload');
    routeHandlers.upload?.();
    return;
  }

  if (parts[0] === 'organizations') {
    showView('organizations');
    setActiveNav('organizations');
    routeHandlers.organizations?.();
    return;
  }

  if (parts[0] === 'activity') {
    showView('activity');
    setActiveNav('activity');
    routeHandlers.activity?.();
    return;
  }

  if (parts[0] === 'settings') {
    showView('settings');
    setActiveNav('settings');
    routeHandlers.settings?.();
    return;
  }

  if (parts[0] === 'help') {
    showView('help');
    setActiveNav('help');
    return;
  }

  if (parts[0] === 'about') {
    showView('about');
    setActiveNav('about');
    return;
  }

  if (parts[0] === 'vercel') {
    showView('vercel');
    setActiveNav('vercel');
    routeHandlers.vercel?.(parts.slice(1));
    return;
  }

  showView('dashboard');
  setActiveNav('dashboard');
  await loadDashboard();
  routeHandlers.dashboard?.();
}

window.addEventListener('hashchange', router);

// Every nav item is a real hash link — no alert placeholder left.
document.querySelectorAll('.nav__item, .bottom-nav__item').forEach((a) => {
  a.addEventListener('click', () => {
    closeSidebarDrawer();
  });
});

// ---------------- Sidebar: collapse (desktop) + drawer (mobile) ----------------

const sidebar = document.getElementById('sidebar');
const sidebarScrim = document.getElementById('sidebarScrim');
const SIDEBAR_COLLAPSE_KEY = 'upgit_sidebar_collapsed';

// Desktop: persists across visits, since it's a "how I like my workspace"
// preference, not a one-off action.
if (localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1') {
  sidebar.classList.add('is-collapsed');
}
document.getElementById('sidebarCollapseBtn').addEventListener('click', () => {
  const collapsed = sidebar.classList.toggle('is-collapsed');
  localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? '1' : '0');
});

// Mobile: an off-canvas drawer instead — opened by the topbar's menu
// button, closed by tapping the scrim behind it or picking a nav item.
function openSidebarDrawer() {
  sidebar.classList.add('is-open');
  sidebarScrim.classList.add('is-visible');
}
function closeSidebarDrawer() {
  sidebar.classList.remove('is-open');
  sidebarScrim.classList.remove('is-visible');
}
document.getElementById('sidebarToggleBtn').addEventListener('click', openSidebarDrawer);
sidebarScrim.addEventListener('click', closeSidebarDrawer);

// Notifications: deliberately not a real feature (see notif panel copy
// in index.html for why) — this just toggles the explanation.
const notifBell = document.getElementById('notifBell');
const notifPanel = document.getElementById('notifPanel');
notifBell.addEventListener('click', () => notifPanel.classList.toggle('hidden'));
document.addEventListener('click', (e) => {
  if (!notifPanel.contains(e.target) && !notifBell.contains(e.target)) notifPanel.classList.add('hidden');
});

// ---------------- PWA: service worker + install prompt ----------------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err.message);
    });
  });
}

let deferredInstallPrompt = null;
const installBtn = document.getElementById('installAppBtn');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  installBtn.classList.remove('hidden');
});

installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installBtn.classList.add('hidden');
});

window.addEventListener('appinstalled', () => {
  installBtn.classList.add('hidden');
});

// ---------------- Force refresh (Settings > "Clear cache & reload") ----------------
// The service worker's own update check only runs on the *next* page
// load and only replaces the cache after that — it can't unstick a tab
// that's open right now. This does it immediately: drop the SW
// registration, wipe every Cache Storage entry this origin owns, then
// hard-reload straight from the network.
const forceRefreshBtn = document.getElementById('forceRefreshBtn');
if (forceRefreshBtn) {
  forceRefreshBtn.addEventListener('click', async () => {
    const status = document.getElementById('forceRefreshStatus');
    forceRefreshBtn.disabled = true;
    status.textContent = t('refresh_app_working');
    status.classList.remove('hidden');
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      status.textContent = t('refresh_app_done');
    } catch (err) {
      console.warn('Force refresh cleanup failed:', err.message);
    } finally {
      window.location.reload();
    }
  });
}

async function boot() {
  try {
    const { user, github_auth_mode } = await api('/auth/me');
    els.authGate.classList.add('hidden');
    els.dashboardContent.classList.remove('hidden');
    document.body.dataset.githubAuthMode = github_auth_mode || '';
    renderAccount(user);
    showApp();
  } catch {
    els.authGate.classList.remove('hidden');
    els.dashboardContent.classList.add('hidden');
    // A direct link to /#/install-app (after "Developer Connect" sends the
    // user back here without an installation yet) should still open the
    // app shell's connect view, since that's where the install notice
    // text lives — anywhere else, unauthenticated visitors land on the
    // new sign-in page first (or the marketing landing page for "/").
    const hash = window.location.hash.replace(/^#\/?/, '');
    if (hash.startsWith('install-app')) {
      showApp();
    } else if (hash.startsWith('connect')) {
      showSignin();
    } else {
      showLanding();
    }
  }
  router();
}

// Populates the "UPGit dalam Angka" panel on the landing page with real
// counts from the database (total registered users, pushes to GitHub,
// deploys to Vercel) — no auth required, this loads before anyone signs in.
let landingStatsLoaded = false;
async function loadLandingStats() {
  if (landingStatsLoaded) return;
  const elUsers = document.getElementById('landingStatUsers');
  const elPushes = document.getElementById('landingStatPushes');
  const elDeploys = document.getElementById('landingStatDeploys');
  if (!elUsers || !elPushes || !elDeploys) return;
  try {
    const stats = await api('/stats');
    const fmt = (n) => Number(n || 0).toLocaleString('id-ID');
    elUsers.textContent = fmt(stats.total_users);
    elPushes.textContent = fmt(stats.total_pushes);
    elDeploys.textContent = fmt(stats.total_deploys);
    landingStatsLoaded = true;
  } catch {
    // Leave the "—" placeholders in place rather than showing a wrong number.
  }
}

function showLanding() {
  els.landingPage.classList.remove('hidden');
  els.signinPage.classList.add('hidden');
  els.appShell.classList.add('hidden');
  loadLandingStats();
}

function showSignin() {
  els.landingPage.classList.add('hidden');
  els.signinPage.classList.remove('hidden');
  els.appShell.classList.add('hidden');
}

function showApp() {
  els.landingPage.classList.add('hidden');
  els.signinPage.classList.add('hidden');
  els.appShell.classList.remove('hidden');
}

document.getElementById('landingGetStartedBtn').addEventListener('click', () => {
  showSignin();
  window.location.hash = '#/connect';
});
document.getElementById('aboutCtaBtn')?.addEventListener('click', () => {
  window.location.hash = '#/dashboard';
});

boot();
