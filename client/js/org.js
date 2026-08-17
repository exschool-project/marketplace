import { api, onRoute } from './app.js';
import { t } from './i18n.js';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadOrganizations() {
  const el = document.getElementById('orgsList');
  el.innerHTML = `<p class="muted">${t('loading')}</p>`;

  try {
    const { repositories } = await api('/github/repos?per_page=100');

    const groups = new Map(); // owner login -> { type, repos: [] }
    for (const r of repositories) {
      const owner = r.full_name.split('/')[0];
      const isOrg = r.owner?.type === 'Organization' || r.owner_type === 'Organization';
      if (!groups.has(owner)) groups.set(owner, { type: isOrg ? 'Organization' : 'Personal', repos: [] });
      groups.get(owner).repos.push(r);
    }

    if (!groups.size) {
      el.innerHTML = `<p class="muted">${t('no_repos_accessible')}</p>`;
      return;
    }

    el.innerHTML = [...groups.entries()]
      .map(
        ([owner, g]) => `
      <div class="panel" style="margin-bottom:12px">
        <h2>${esc(owner)} <span class="muted" style="text-transform:none;font-weight:400">— ${g.type === 'Organization' ? t('org_type_organization') : t('org_type_personal')}, ${t(g.repos.length === 1 ? 'repo_count_one' : 'repo_count_other', { n: g.repos.length })}</span></h2>
        <div class="repo-list">
          ${g.repos
            .map(
              (r) => `
            <a class="repo-item" href="#/repo/${esc(r.full_name)}">
              <div class="repo-item__name">${esc(r.full_name)}</div>
              <span class="repo-item__vis">${r.private ? t('private') : t('public')}</span>
            </a>`
            )
            .join('')}
        </div>
      </div>`
      )
      .join('');
  } catch (err) {
    el.innerHTML = `<p class="muted">${t('failed_to_load', { msg: esc(err.message) })}</p>`;
  }
}

onRoute('organizations', () => {
  // Re-fetch every time the tab is opened rather than caching — repo
  // access can change between visits (new installs, revoked access).
  loadOrganizations();
});
