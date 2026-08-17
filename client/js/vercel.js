import { api, onRoute } from './app.js';
import { t } from './i18n.js';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const READY_STATES = new Set(['READY', 'ERROR', 'CANCELED']);

function statusTag(state) {
  const s = String(state || '').toUpperCase();
  let cls = '';
  if (s === 'READY') cls = 'tag--success';
  else if (s === 'ERROR' || s === 'CANCELED') cls = 'tag--danger';
  else if (s === 'BUILDING' || s === 'QUEUED' || s === 'INITIALIZING') cls = 'tag--warn';
  return `<span class="tag ${cls}">${esc(s || 'UNKNOWN')}</span>`;
}

let connection = null;
const body = () => document.getElementById('vercelBody');

// ---------------- Connection panel ----------------

async function loadConnection() {
  try {
    connection = await api('/vercel/connection');
  } catch {
    connection = { connected: false };
  }
  renderConnectionPanel();
}

function renderConnectionPanel() {
  const panel = document.getElementById('vercelConnectionPanel');
  const tabs = document.getElementById('vercelTabs');
  if (!panel || !tabs) return;

  if (connection?.connected) {
    tabs.classList.remove('hidden');
    panel.innerHTML = `
      <div class="vconn-status">
        <span class="vconn-dot vconn-dot--on"></span>
        <strong>${esc(connection.username || connection.email || 'Vercel')}</strong>
        <span class="muted">${t('v_connected')}${connection.last_verified_at ? ' · ' + t('v_verified_at', { time: new Date(connection.last_verified_at).toLocaleString() }) : ''}</span>
        <button class="btn btn--sm" id="vTestBtn">${t('v_test_connection')}</button>
        <button class="btn btn--sm" id="vDisconnectBtn">${t('v_disconnect')}</button>
      </div>`;
    document.getElementById('vTestBtn').addEventListener('click', testConnection);
    document.getElementById('vDisconnectBtn').addEventListener('click', disconnectVercel);
  } else {
    tabs.classList.add('hidden');
    panel.innerHTML = `
      <div class="vconn-status"><span class="vconn-dot vconn-dot--off"></span><span class="muted">${t('v_not_connected')}</span></div>
      <p class="muted" style="margin-top:8px">${t('v_connect_desc')} <a href="https://vercel.com/account/tokens" target="_blank" rel="noopener" style="color:var(--accent)">vercel.com/account/tokens</a>.</p>
      <input type="password" class="text-input vfield" id="vTokenInput" placeholder="${t('v_token_placeholder')}" autocomplete="off" />
      <button class="btn btn--primary btn--sm" id="vConnectBtn">${t('v_connect_vercel')}</button>
      <p class="muted hidden" id="vConnectError" style="margin-top:8px;color:var(--danger)"></p>
    `;
    document.getElementById('vConnectBtn').addEventListener('click', connectVercel);
  }
}

async function connectVercel() {
  const input = document.getElementById('vTokenInput');
  const errEl = document.getElementById('vConnectError');
  const btn = document.getElementById('vConnectBtn');
  const token = input.value.trim();
  if (!token) return;
  btn.disabled = true;
  btn.textContent = t('v_connecting');
  errEl.classList.add('hidden');
  try {
    await api('/vercel/connect', { method: 'POST', body: JSON.stringify({ token }) });
    input.value = '';
    await loadConnection();
    renderTab();
  } catch (err) {
    errEl.textContent = err.message || t('v_failed_connect');
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = t('v_connect_vercel');
  }
}

async function testConnection() {
  const btn = document.getElementById('vTestBtn');
  btn.disabled = true;
  btn.textContent = t('v_testing');
  try {
    await api('/vercel/connection/test', { method: 'POST' });
    await loadConnection();
  } catch (err) {
    alert(err.message || t('v_connection_test_failed'));
    btn.disabled = false;
    btn.textContent = t('v_test_connection');
  }
}

async function disconnectVercel() {
  if (!confirm(t('v_disconnect_confirm'))) return;
  try {
    await api('/vercel/connect', { method: 'DELETE' });
    await loadConnection();
    renderTab();
  } catch (err) {
    alert(err.message || t('v_failed_disconnect'));
  }
}

// ---------------- Tabs ----------------

let activeTab = 'dashboard';
let activeSubId = null;

document.getElementById('vercelTabs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-vtab]');
  if (!btn) return;
  window.location.hash = `#/vercel/${btn.dataset.vtab}`;
});

function setActiveTabUI() {
  document.querySelectorAll('#vercelTabs .repo-tab').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.vtab === activeTab);
  });
}

function renderTab() {
  setActiveTabUI();
  if (!connection?.connected) {
    body().innerHTML = '';
    return;
  }
  if (activeTab === 'dashboard') return renderDashboard();
  if (activeTab === 'projects') return activeSubId ? renderProjectDetail(activeSubId) : renderProjects();
  if (activeTab === 'deploy') return renderDeploy();
  if (activeTab === 'deployments') return activeSubId ? renderDeploymentDetail(activeSubId) : renderDeployments();
  if (activeTab === 'account') return renderAccount();
}

// ---------------- Dashboard ----------------

async function renderDashboard() {
  body().innerHTML = `<p class="muted">${t('loading')}</p>`;
  try {
    const [{ projects = [] }, { deployments = [] }] = await Promise.all([
      api('/vercel/projects'),
      api('/vercel/deployments?limit=6'),
    ]);
    const prod = deployments.filter((d) => d.target === 'production').length;
    body().innerHTML = `
      <div class="stat-grid">
        <div class="stat-card stat-card--a"><div class="stat-card__value">${projects.length}</div><div class="stat-card__label">${t('v_projects_label')}</div></div>
        <div class="stat-card stat-card--b"><div class="stat-card__value">${deployments.length}</div><div class="stat-card__label">${t('v_recent_deployments')}</div></div>
        <div class="stat-card stat-card--c"><div class="stat-card__value">${prod}</div><div class="stat-card__label">${t('v_production_deploys')}</div></div>
      </div>
      <div class="panel" style="margin-top:14px">
        <h2>${t('v_recent_deployments')}</h2>
        <div id="vDashDeploys" class="repo-list">${deployments.length ? '' : `<p class="muted">${t('v_no_deployments_yet')}</p>`}</div>
      </div>
    `;
    const list = document.getElementById('vDashDeploys');
    list.innerHTML = deployments
      .map(
        (d) => `
      <a class="repo-item" href="#/vercel/deployments/${esc(d.uid)}">
        <div>
          <div class="repo-item__name">${esc(d.name || d.url || d.uid)}</div>
          <div class="repo-item__meta">${new Date(d.created || d.createdAt).toLocaleString()}</div>
        </div>
        ${statusTag(d.state || d.readyState)}
      </a>`
      )
      .join('');
  } catch (err) {
    body().innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

// ---------------- Projects ----------------

async function renderProjects() {
  body().innerHTML = `<p class="muted">${t('loading')}</p>`;
  try {
    const { projects = [] } = await api('/vercel/projects');
    body().innerHTML = `
      <div class="issues-toolbar">
        <h2 style="margin:0">${t('v_projects_title')}</h2>
        <button class="btn btn--primary btn--sm" id="vNewProjectBtn">${t('v_new_project')}</button>
      </div>
      <div id="vNewProjectForm" class="panel hidden" style="margin-bottom:14px"></div>
      <div class="vcard-grid" id="vProjectGrid">
        ${projects.length ? '' : `<p class="muted">${t('v_no_projects_yet')}</p>`}
      </div>
    `;
    document.getElementById('vNewProjectBtn').addEventListener('click', toggleNewProjectForm);
    document.getElementById('vProjectGrid').innerHTML = projects
      .map(
        (p) => `
      <div class="vcard">
        <div class="vcard__title">${esc(p.name)}</div>
        <div class="vcard__meta">${esc(p.framework || t('v_no_framework'))}${p.targets?.production?.alias?.[0] ? ' · ' + esc(p.targets.production.alias[0]) : ''}</div>
        <div class="vcard__actions">
          <a class="btn btn--sm" href="#/vercel/projects/${encodeURIComponent(p.id)}">${t('v_open')}</a>
          <button class="btn btn--sm" data-quick-deploy="${esc(p.name)}">${t('v_deploy')}</button>
        </div>
      </div>`
      )
      .join('');
    document.getElementById('vProjectGrid').querySelectorAll('[data-quick-deploy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = t('v_deploying');
        try {
          const deployment = await api('/vercel/deploy', {
            method: 'POST',
            body: JSON.stringify({ projectName: btn.dataset.quickDeploy }),
          });
          window.location.hash = `#/vercel/deployments/${deployment.id || deployment.uid}`;
        } catch (err) {
          alert(err.message || t('v_deploy_failed'));
          btn.disabled = false;
          btn.textContent = t('v_deploy');
        }
      });
    });
  } catch (err) {
    body().innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

function toggleNewProjectForm() {
  const form = document.getElementById('vNewProjectForm');
  const willShow = form.classList.contains('hidden');
  form.classList.toggle('hidden');
  if (!willShow) return;
  form.innerHTML = `
    <label class="field-label">${t('v_project_name_label')}</label>
    <input class="text-input vfield" id="vpName" placeholder="my-app" />
    <label class="field-label">${t('v_framework_label')}</label>
    <input class="text-input vfield" id="vpFramework" placeholder="nextjs, vite, ..." />
    <label class="field-label">${t('v_root_dir_label')}</label>
    <input class="text-input vfield" id="vpRoot" placeholder="./" />
    <label class="field-label">${t('v_build_cmd_label')}</label>
    <input class="text-input vfield" id="vpBuild" placeholder="npm run build" />
    <label class="field-label">${t('v_output_dir_label')}</label>
    <input class="text-input vfield" id="vpOutput" placeholder="dist" />
    <label class="field-label">${t('v_install_cmd_label')}</label>
    <input class="text-input vfield" id="vpInstall" placeholder="npm install" />
    <div class="modal__actions" style="justify-content:flex-start;margin-top:10px">
      <button class="btn btn--primary btn--sm" id="vpCreateBtn">${t('v_create_project')}</button>
    </div>
    <p class="muted hidden" id="vpError" style="color:var(--danger)"></p>
  `;
  document.getElementById('vpCreateBtn').addEventListener('click', async () => {
    const name = document.getElementById('vpName').value.trim();
    const errEl = document.getElementById('vpError');
    if (!name) return;
    const btn = document.getElementById('vpCreateBtn');
    btn.disabled = true;
    btn.textContent = t('v_creating');
    try {
      await api('/vercel/projects', {
        method: 'POST',
        body: JSON.stringify({
          name,
          framework: document.getElementById('vpFramework').value.trim() || undefined,
          rootDirectory: document.getElementById('vpRoot').value.trim() || undefined,
          buildCommand: document.getElementById('vpBuild').value.trim() || undefined,
          outputDirectory: document.getElementById('vpOutput').value.trim() || undefined,
          installCommand: document.getElementById('vpInstall').value.trim() || undefined,
        }),
      });
      renderProjects();
    } catch (err) {
      errEl.textContent = err.message || t('v_failed_create_project');
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = t('v_create_project');
    }
  });
}

// ---------------- Project detail (settings / domains / env) ----------------

async function renderProjectDetail(id) {
  body().innerHTML = `<p class="muted">${t('loading')}</p>`;
  try {
    const [project, deploysRes, domainsRes, envRes] = await Promise.all([
      api(`/vercel/projects/${encodeURIComponent(id)}`),
      api(`/vercel/projects/${encodeURIComponent(id)}/deployments?limit=10`),
      api(`/vercel/projects/${encodeURIComponent(id)}/domains`).catch(() => ({ domains: [] })),
      api(`/vercel/projects/${encodeURIComponent(id)}/env`).catch(() => ({ envs: [] })),
    ]);
    const deployments = deploysRes.deployments || [];
    const domains = domainsRes.domains || [];
    const envs = envRes.envs || [];

    body().innerHTML = `
      <a href="#/vercel/projects" class="back-link">&larr; ${t('v_projects_label')}</a>
      <div class="view__head" style="margin-top:8px"><h1 class="mono">${esc(project.name)}</h1><p class="muted">${esc(project.framework || t('v_no_framework'))}</p></div>

      <div class="panel">
        <h2>${t('v_deployments_title')}</h2>
        <div id="vpdDeploys" class="repo-list">${deployments.length ? '' : `<p class="muted">${t('v_no_deployments_yet')}</p>`}</div>
      </div>

      <div class="panel" style="margin-top:14px">
        <h2>${t('v_domains_title')}</h2>
        <div id="vpdDomains" class="repo-list">${domains.length ? '' : `<p class="muted">${t('v_no_domains')}</p>`}</div>
        <div class="modal__actions" style="justify-content:flex-start;margin-top:10px">
          <input class="text-input" id="vpdDomainInput" placeholder="www.example.com" style="max-width:260px" />
          <button class="btn btn--sm" id="vpdDomainAdd">${t('v_add_domain')}</button>
        </div>
      </div>

      <div class="panel" style="margin-top:14px">
        <h2>${t('v_env_vars_title')}</h2>
        <div id="vpdEnv" class="repo-list">${envs.length ? '' : `<p class="muted">${t('v_no_env_vars')}</p>`}</div>
        <div class="modal__actions" style="justify-content:flex-start;margin-top:10px;flex-wrap:wrap">
          <input class="text-input" id="vpdEnvKey" placeholder="NAME" style="max-width:160px" />
          <input class="text-input" id="vpdEnvValue" placeholder="value" style="max-width:220px" type="password" />
          <button class="btn btn--sm" id="vpdEnvAdd">${t('v_add')}</button>
        </div>
      </div>

      <div class="panel" style="margin-top:14px">
        <h2>${t('v_project_settings')}</h2>
        <label class="field-label">${t('v_build_cmd_label').replace(' (optional)', '')}</label>
        <input class="text-input vfield" id="vpdBuild" value="${esc(project.buildCommand || '')}" />
        <label class="field-label">${t('v_output_dir_label').replace(' (optional)', '')}</label>
        <input class="text-input vfield" id="vpdOutput" value="${esc(project.outputDirectory || '')}" />
        <label class="field-label">${t('v_install_cmd_label').replace(' (optional)', '')}</label>
        <input class="text-input vfield" id="vpdInstall" value="${esc(project.installCommand || '')}" />
        <div class="modal__actions" style="justify-content:flex-start;margin-top:10px">
          <button class="btn btn--primary btn--sm" id="vpdSaveSettings">${t('v_save_settings')}</button>
        </div>
      </div>
    `;

    document.getElementById('vpdDeploys').innerHTML = deployments
      .map(
        (d) => `
      <a class="repo-item" href="#/vercel/deployments/${esc(d.uid)}">
        <div><div class="repo-item__name">${esc(d.name || d.uid)}</div><div class="repo-item__meta">${new Date(d.created || d.createdAt).toLocaleString()}</div></div>
        ${statusTag(d.state || d.readyState)}
      </a>`
      )
      .join('');

    document.getElementById('vpdDomains').innerHTML = domains
      .map(
        (d) => `
      <div class="repo-item">
        <div><div class="repo-item__name">${esc(d.name)}</div><div class="repo-item__meta">${d.verified ? t('v_active') : t('v_pending_verification')}</div></div>
        <button class="btn btn--sm" data-remove-domain="${esc(d.name)}">${t('v_remove')}</button>
      </div>`
      )
      .join('');
    document.getElementById('vpdDomains').querySelectorAll('[data-remove-domain]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(t('v_remove_domain_confirm', { name: btn.dataset.removeDomain }))) return;
        try {
          await api(`/vercel/projects/${encodeURIComponent(id)}/domains/${encodeURIComponent(btn.dataset.removeDomain)}`, { method: 'DELETE' });
          renderProjectDetail(id);
        } catch (err) {
          alert(err.message || t('v_failed_remove_domain'));
        }
      });
    });
    document.getElementById('vpdDomainAdd').addEventListener('click', async () => {
      const input = document.getElementById('vpdDomainInput');
      const name = input.value.trim();
      if (!name) return;
      try {
        await api(`/vercel/projects/${encodeURIComponent(id)}/domains`, { method: 'POST', body: JSON.stringify({ name }) });
        renderProjectDetail(id);
      } catch (err) {
        alert(err.message || t('v_failed_add_domain'));
      }
    });

    document.getElementById('vpdEnv').innerHTML = envs
      .map(
        (e) => `
      <div class="repo-item">
        <div><div class="repo-item__name mono">${esc(e.key)}</div><div class="repo-item__meta">•••••••••• · ${(e.target || []).join(', ')}</div></div>
        <button class="btn btn--sm" data-remove-env="${esc(e.id)}">${t('delete')}</button>
      </div>`
      )
      .join('');
    document.getElementById('vpdEnv').querySelectorAll('[data-remove-env]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(t('v_delete_env_confirm'))) return;
        try {
          await api(`/vercel/projects/${encodeURIComponent(id)}/env/${encodeURIComponent(btn.dataset.removeEnv)}`, { method: 'DELETE' });
          renderProjectDetail(id);
        } catch (err) {
          alert(err.message || t('v_failed_delete_env'));
        }
      });
    });
    document.getElementById('vpdEnvAdd').addEventListener('click', async () => {
      const key = document.getElementById('vpdEnvKey').value.trim();
      const value = document.getElementById('vpdEnvValue').value;
      if (!key || !value) return;
      try {
        await api(`/vercel/projects/${encodeURIComponent(id)}/env`, { method: 'POST', body: JSON.stringify({ key, value }) });
        renderProjectDetail(id);
      } catch (err) {
        alert(err.message || t('v_failed_add_env'));
      }
    });

    document.getElementById('vpdSaveSettings').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api(`/vercel/projects/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            buildCommand: document.getElementById('vpdBuild').value.trim() || null,
            outputDirectory: document.getElementById('vpdOutput').value.trim() || null,
            installCommand: document.getElementById('vpdInstall').value.trim() || null,
          }),
        });
      } catch (err) {
        alert(err.message || t('v_failed_save_settings'));
      } finally {
        btn.disabled = false;
      }
    });
  } catch (err) {
    body().innerHTML = `<a href="#/vercel/projects" class="back-link">&larr; ${t('v_projects_label')}</a><p class="muted">${esc(err.message)}</p>`;
  }
}

// ---------------- Deploy ----------------

async function renderDeploy() {
  body().innerHTML = `<p class="muted">${t('loading')}</p>`;
  let projects = [];
  let repos = [];
  let githubConnected = true;
  try {
    ({ projects = [] } = await api('/vercel/projects'));
  } catch (err) {
    body().innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    return;
  }
  try {
    ({ repositories: repos = [] } = await api('/github/repos?per_page=100'));
  } catch (err) {
    if (err.status === 409) githubConnected = false;
  }

  body().innerHTML = `
    <div class="panel">
      <h2>${t('v_deploy_from_github')}</h2>
      ${
        githubConnected
          ? `
        <label class="field-label">${t('v_repository_label')}</label>
        <select class="branch-select branch-select--full" id="vdRepo">
          <option value="">${t('v_select_repo')}</option>
          ${repos.map((r) => `<option value="${esc(r.full_name)}">${esc(r.full_name)}</option>`).join('')}
        </select>
        <label class="field-label">${t('v_branch_label')}</label>
        <input class="text-input vfield" id="vdBranch" placeholder="main" value="main" />
        <label class="field-label">${t('v_vercel_project_label')}</label>
        <select class="branch-select branch-select--full" id="vdProject">
          <option value="">${t('v_new_project_uses_repo_name')}</option>
          ${projects.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('')}
        </select>
        <label class="field-label">${t('v_target_label')}</label>
        <select class="branch-select branch-select--full" id="vdTarget">
          <option value="preview">${t('v_preview')}</option>
          <option value="production">${t('v_production')}</option>
        </select>
        <div class="modal__actions" style="justify-content:flex-start;margin-top:10px">
          <button class="btn btn--primary btn--sm" id="vdDeployBtn">${t('v_deploy')}</button>
        </div>
        <p class="muted hidden" id="vdError" style="color:var(--danger);margin-top:8px"></p>
      `
          : `<p class="muted">${t('v_github_required')}</p>
             <button class="btn btn--sm" id="vdDeployVercelOnly">${t('v_deploy_with_vercel')}</button>`
      }
    </div>

    <div class="panel" style="margin-top:14px">
      <h2>${t('v_upload_deploy_title')}</h2>
      <p class="muted" style="margin-top:-6px">${t('v_upload_deploy_desc')}</p>
      <label class="field-label">${t('v_target_project_name')}</label>
      <input class="text-input vfield" id="vuProjectName" placeholder="my-app" />
      <label class="field-label">${t('v_zip_file_label')}</label>
      <input type="file" id="vuFile" accept=".zip" class="vfield" />
      <label class="field-label">${t('v_target_label')}</label>
      <select class="branch-select branch-select--full" id="vuTarget">
        <option value="preview">${t('v_preview')}</option>
        <option value="production">${t('v_production')}</option>
      </select>
      <div class="modal__actions" style="justify-content:flex-start;margin-top:10px">
        <button class="btn btn--primary btn--sm" id="vuDeployBtn">${t('v_upload_deploy_btn')}</button>
      </div>
      <p class="muted hidden" id="vuError" style="color:var(--danger);margin-top:8px"></p>
    </div>
  `;

  if (githubConnected) {
    document.getElementById('vdDeployBtn').addEventListener('click', async () => {
      const repoFullName = document.getElementById('vdRepo').value;
      const branch = document.getElementById('vdBranch').value.trim() || 'main';
      const projectName = document.getElementById('vdProject').value || (repoFullName ? repoFullName.split('/')[1] : '');
      const target = document.getElementById('vdTarget').value;
      const errEl = document.getElementById('vdError');
      if (!repoFullName) {
        errEl.textContent = t('v_select_repo_first');
        errEl.classList.remove('hidden');
        return;
      }
      const btn = document.getElementById('vdDeployBtn');
      btn.disabled = true;
      btn.textContent = t('v_deploying');
      try {
        const deployment = await api('/vercel/deploy', {
          method: 'POST',
          body: JSON.stringify({ repoFullName, branch, projectName, target }),
        });
        window.location.hash = `#/vercel/deployments/${deployment.id || deployment.uid}`;
      } catch (err) {
        errEl.textContent = err.message || t('v_deployment_failed');
        errEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = t('v_deploy');
      }
    });
  } else {
    document.getElementById('vdDeployVercelOnly')?.addEventListener('click', () => {
      document.getElementById('vuProjectName').scrollIntoView({ behavior: 'smooth' });
      document.getElementById('vuProjectName').focus();
    });
  }

  document.getElementById('vuDeployBtn').addEventListener('click', async () => {
    const projectName = document.getElementById('vuProjectName').value.trim();
    const file = document.getElementById('vuFile').files[0];
    const target = document.getElementById('vuTarget').value;
    const errEl = document.getElementById('vuError');
    errEl.classList.add('hidden');
    if (!projectName || !file) {
      errEl.textContent = t('v_project_zip_required');
      errEl.classList.remove('hidden');
      return;
    }
    const btn = document.getElementById('vuDeployBtn');
    btn.disabled = true;
    btn.textContent = t('v_uploading');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('projectName', projectName);
      form.append('target', target);
      const deployment = await api('/vercel/upload-deploy', { method: 'POST', body: form, headers: {} });
      window.location.hash = `#/vercel/deployments/${deployment.id || deployment.uid}`;
    } catch (err) {
      errEl.textContent = err.message || t('v_upload_deploy_failed');
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = t('v_upload_deploy_btn');
    }
  });
}

// ---------------- Deployments list ----------------

const STATE_FILTERS = ['ALL', 'READY', 'BUILDING', 'ERROR', 'CANCELED'];

async function renderDeployments(filter = 'ALL') {
  body().innerHTML = `<p class="muted">${t('loading')}</p>`;
  try {
    const { deployments = [] } = await api('/vercel/deployments?limit=50');
    const filtered = filter === 'ALL' ? deployments : deployments.filter((d) => (d.state || d.readyState) === filter);
    body().innerHTML = `
      <div class="state-tabs" id="vDeployFilters">
        ${STATE_FILTERS.map((s) => `<button class="state-tab ${s === filter ? 'is-active' : ''}" data-filter="${s}">${s}</button>`).join('')}
      </div>
      <div class="repo-list" id="vDeployList" style="margin-top:12px">
        ${filtered.length ? '' : `<p class="muted">${t('v_no_deployments')}</p>`}
      </div>
    `;
    document.getElementById('vDeployList').innerHTML = filtered
      .map(
        (d) => `
      <a class="repo-item" href="#/vercel/deployments/${esc(d.uid)}">
        <div>
          <div class="repo-item__name">${esc(d.name || d.uid)}</div>
          <div class="repo-item__meta">${esc(d.meta?.githubCommitRef || d.target || 'preview')} · ${new Date(d.created || d.createdAt).toLocaleString()}</div>
        </div>
        ${statusTag(d.state || d.readyState)}
      </a>`
      )
      .join('');
    document.getElementById('vDeployFilters').querySelectorAll('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => renderDeployments(btn.dataset.filter));
    });
  } catch (err) {
    body().innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

// ---------------- Deployment detail (with polling) ----------------

let pollTimer = null;
function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

async function renderDeploymentDetail(id) {
  stopPolling();
  body().innerHTML = `<p class="muted">${t('loading')}</p>`;
  await loadDeploymentDetail(id, 0);
}

async function loadDeploymentDetail(id, attempt) {
  try {
    const d = await api(`/vercel/deployments/${encodeURIComponent(id)}`);
    const state = (d.readyState || d.status || '').toUpperCase();
    const isFinal = READY_STATES.has(state);

    body().innerHTML = `
      <a href="#/vercel/deployments" class="back-link">&larr; ${t('v_deployments_title')}</a>
      <div class="view__head" style="margin-top:8px">
        <h1 class="mono" style="font-size:16px">${esc(d.name || d.id)}</h1>
        <p class="muted">${statusTag(state)} ${isFinal ? '' : '<span class="muted">· updates automatically</span>'}</p>
      </div>
      <div class="panel">
        <div class="repo-item" style="cursor:default"><div class="repo-item__name">${t('v_deployment_id')}</div><div class="repo-item__meta mono">${esc(d.id || d.uid)}</div></div>
        <div class="repo-item" style="cursor:default"><div class="repo-item__name">${t('v_project_field')}</div><div class="repo-item__meta">${esc(d.name || '—')}</div></div>
        <div class="repo-item" style="cursor:default"><div class="repo-item__name">${t('v_target_label')}</div><div class="repo-item__meta">${esc(d.target || 'preview')}</div></div>
        <div class="repo-item" style="cursor:default"><div class="repo-item__name">${t('v_branch_field')}</div><div class="repo-item__meta">${esc(d.meta?.githubCommitRef || '—')}</div></div>
        <div class="repo-item" style="cursor:default"><div class="repo-item__name">${t('v_commit_field')}</div><div class="repo-item__meta mono">${esc((d.meta?.githubCommitSha || '').slice(0, 7) || '—')}</div></div>
        <div class="repo-item" style="cursor:default"><div class="repo-item__name">${t('v_created_field')}</div><div class="repo-item__meta">${new Date(d.createdAt || d.created).toLocaleString()}</div></div>
      </div>
      <div class="modal__actions" style="justify-content:flex-start;margin-top:14px;flex-wrap:wrap">
        ${d.url ? `<a class="btn btn--sm" href="https://${esc(d.url)}" target="_blank" rel="noopener">${t('v_open_deployment')}</a>` : ''}
        ${d.alias?.[0] ? `<a class="btn btn--sm" href="https://${esc(d.alias[0])}" target="_blank" rel="noopener">${t('v_open_website')}</a>` : ''}
        <button class="btn btn--sm" id="vddRedeploy">${t('v_redeploy')}</button>
        ${!isFinal ? `<button class="btn btn--sm" id="vddCancel">${t('v_cancel_deployment')}</button>` : ''}
        ${state === 'READY' && d.target !== 'production' ? `<button class="btn btn--sm" id="vddPromote">${t('v_promote_production')}</button>` : ''}
        <button class="btn btn--sm" id="vddLogs">${t('v_view_logs')}</button>
      </div>
      <div class="panel hidden" id="vddLogsPanel" style="margin-top:14px">
        <h2>${t('v_deployment_logs')}</h2>
        <pre id="vddLogsContent" class="mono" style="white-space:pre-wrap;font-size:12px;max-height:320px;overflow:auto"></pre>
      </div>
    `;

    document.getElementById('vddRedeploy').addEventListener('click', async () => {
      if (!confirm(t('v_redeploy_confirm'))) return;
      try {
        const redeployed = await api(`/vercel/deployments/${encodeURIComponent(id)}/redeploy`, { method: 'POST', body: JSON.stringify({}) });
        window.location.hash = `#/vercel/deployments/${redeployed.id || redeployed.uid}`;
      } catch (err) {
        alert(err.message || t('v_redeploy_failed'));
      }
    });
    document.getElementById('vddCancel')?.addEventListener('click', async () => {
      if (!confirm(t('v_cancel_deployment_confirm'))) return;
      try {
        await api(`/vercel/deployments/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({}) });
        loadDeploymentDetail(id, 0);
      } catch (err) {
        alert(err.message || t('v_failed_cancel_deployment'));
      }
    });
    document.getElementById('vddPromote')?.addEventListener('click', async () => {
      if (!confirm(t('v_promote_confirm'))) return;
      try {
        await api(`/vercel/projects/${encodeURIComponent(d.projectId || d.name)}/promote/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({}) });
        loadDeploymentDetail(id, 0);
      } catch (err) {
        alert(err.message || t('v_failed_promote'));
      }
    });
    document.getElementById('vddLogs').addEventListener('click', async () => {
      const panel = document.getElementById('vddLogsPanel');
      panel.classList.remove('hidden');
      const content = document.getElementById('vddLogsContent');
      content.textContent = t('v_loading_logs');
      try {
        const { events } = await api(`/vercel/deployments/${encodeURIComponent(id)}/events`);
        content.textContent = events.length ? events.map((e) => e.text).join('\n') : t('v_no_logs');
      } catch (err) {
        content.textContent = err.message || t('v_failed_load_logs');
      }
    });

    // Poll while not final — 5s for the first minute, backing off to 15s,
    // and always stopping once the deployment reaches a final state.
    if (!isFinal) {
      const delay = attempt < 6 ? 5000 : attempt < 14 ? 10000 : 15000;
      pollTimer = setTimeout(() => loadDeploymentDetail(id, attempt + 1), delay);
    }
  } catch (err) {
    body().innerHTML = `<a href="#/vercel/deployments" class="back-link">&larr; ${t('v_deployments_title')}</a><p class="muted">${esc(err.message)}</p>`;
  }
}

// ---------------- Account ----------------

function renderAccount() {
  body().innerHTML = `
    <div class="panel">
      <h2>${t('v_account_title')}</h2>
      <div class="repo-item" style="cursor:default"><div class="repo-item__name">${t('v_username')}</div><div class="repo-item__meta">${esc(connection.username || '—')}</div></div>
      <div class="repo-item" style="cursor:default"><div class="repo-item__name">${t('v_email')}</div><div class="repo-item__meta">${esc(connection.email || '—')}</div></div>
      <div class="repo-item" style="cursor:default"><div class="repo-item__name">${t('v_user_id')}</div><div class="repo-item__meta mono">${esc(connection.user_id || '—')}</div></div>
      <div class="repo-item" style="cursor:default"><div class="repo-item__name">${t('v_last_verified')}</div><div class="repo-item__meta">${connection.last_verified_at ? new Date(connection.last_verified_at).toLocaleString() : '—'}</div></div>
      <div class="modal__actions" style="justify-content:flex-start;margin-top:14px">
        <button class="btn btn--sm" id="vAcctTest">${t('v_test_connection')}</button>
        <button class="btn btn--sm" id="vAcctDisconnect">${t('v_disconnect')}</button>
      </div>
    </div>
    <div class="panel" style="margin-top:14px">
      <h2>${t('v_usage_title')}</h2>
      <p class="muted" id="vUsageText">${t('loading')}</p>
    </div>
  `;
  document.getElementById('vAcctTest').addEventListener('click', testConnection);
  document.getElementById('vAcctDisconnect').addEventListener('click', disconnectVercel);
  api('/vercel/usage')
    .then((res) => {
      document.getElementById('vUsageText').textContent = res.message || t('v_usage_unavailable');
    })
    .catch((err) => {
      document.getElementById('vUsageText').textContent = err.message || t('v_usage_unavailable');
    });
}

// ---------------- Route entry ----------------

onRoute('vercel', async (parts) => {
  stopPolling();
  await loadConnection();

  const tab = parts[0] || 'dashboard';
  activeTab = ['dashboard', 'projects', 'deploy', 'deployments', 'account'].includes(tab) ? tab : 'dashboard';
  activeSubId = parts[1] || null;
  renderTab();
});
