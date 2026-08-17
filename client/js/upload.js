import { api, onRoute } from './app.js';
import { API_BASE } from './config.js';
import { t } from './i18n.js';

// Mirrors server/src/config/env.js's UPLOAD_MAX_SIZE default (4MB per
// file). There's no endpoint exposing the live server-side value, so if
// that env var is ever overridden in production, update this constant
// too — otherwise this pre-check and the server's real limit disagree.
const MAX_FILE_SIZE = 4 * 1024 * 1024;

const els = {
  repoSelect: document.getElementById('uploadRepoSelect'),
  branchSelect: document.getElementById('uploadBranchSelect'),
  targetPath: document.getElementById('uploadTargetPath'),

  dropzone: document.getElementById('uploadDropzone'),
  pickFilesBtn: document.getElementById('pickFilesBtn'),
  pickFolderBtn: document.getElementById('pickFolderBtn'),
  pickZipBtn: document.getElementById('pickZipBtn'),
  filesInput: document.getElementById('filesInput'),
  folderInput: document.getElementById('folderInput'),
  zipInput: document.getElementById('zipInput'),

  analyzing: document.getElementById('uploadAnalyzing'),
  error: document.getElementById('uploadError'),
  preview: document.getElementById('uploadPreview'),
  banners: document.getElementById('uploadBanners'),
  fileCount: document.getElementById('uploadFileCount'),
  totalSize: document.getElementById('uploadTotalSize'),
  fileList: document.getElementById('uploadFileList'),
  resetBtn: document.getElementById('uploadResetBtn'),
  commitMessage: document.getElementById('uploadCommitMessage'),
  commitMessageCount: document.getElementById('uploadCommitMessageCount'),
  commitBtn: document.getElementById('uploadCommitBtn'),
  deployBtn: document.getElementById('uploadDeployBtn'),
  result: document.getElementById('uploadResult'),

  repoStatus: document.getElementById('uploadRepoStatus'),
  dropzoneBrowseBtn: document.getElementById('dropzoneBrowseBtn'),
  connSummary: document.getElementById('uploadConnSummary'),
  connCards: document.getElementById('uploadConnCards'),
  connBanner: document.getElementById('uploadConnBanner'),

  analyzeProgressBar: document.getElementById('analyzeProgressBar'),
  analyzeProgressLabel: document.getElementById('analyzeProgressLabel'),
  analyzeProgressStage: document.getElementById('analyzeProgressStage'),
  progressWrap: document.getElementById('uploadProgressWrap'),
  progressBar: document.getElementById('uploadProgressBar'),
  progressLabel: document.getElementById('uploadProgressLabel'),
  progressStage: document.getElementById('uploadProgressStage'),
};

let repos = [];
let analysis = null; // { jobId, files, detectedProjectTypes, hasGitignore, gitignoreTemplates }
let excluded = new Set(); // secret file paths the user chose to exclude
let gitignoreChoice = null;

const maxSizeNote = document.getElementById('uploadMaxSizeNote');
function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
if (maxSizeNote) maxSizeNote.textContent = t('max_file_size_note', { size: humanSize(MAX_FILE_SIZE) });

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------- Repo / branch pickers ----------------

async function loadRepos() {
  els.repoSelect.innerHTML = `<option>${t('loading')}</option>`;
  try {
    const { repositories } = await api('/github/repos?per_page=50');
    repos = repositories;
    if (!repos.length) {
      els.repoSelect.innerHTML = `<option>${t('no_repos_found')}</option>`;
      return;
    }
    els.repoSelect.innerHTML = repos.map((r) => `<option value="${esc(r.full_name)}">${esc(r.full_name)}</option>`).join('');
    await loadBranchesFor(repos[0].full_name);
    updateRepoStatus();
  } catch (err) {
    els.repoSelect.innerHTML = `<option>${t('failed_load_repos')}</option>`;
  }
}

async function loadBranchesFor(fullName) {
  const [owner, repo] = fullName.split('/');
  els.branchSelect.innerHTML = `<option>${t('loading')}</option>`;
  try {
    const { branches } = await api(`/github/repos/${owner}/${repo}/branches`);
    els.branchSelect.innerHTML = branches.map((b) => `<option value="${esc(b.name)}">${esc(b.name)}</option>`).join('');
  } catch {
    els.branchSelect.innerHTML = '<option value="main">main</option>';
  }
}

els.repoSelect.addEventListener('change', () => {
  loadBranchesFor(els.repoSelect.value);
  updateRepoStatus();
});

function updateRepoStatus() {
  if (!els.repoStatus) return;
  const val = els.repoSelect.value;
  if (val && !['loading', ''].includes(val)) {
    els.repoStatus.textContent = t('repo_selected', { repo: val });
    els.repoStatus.classList.add('is-set');
  } else {
    els.repoStatus.textContent = t('no_repo_selected');
    els.repoStatus.classList.remove('is-set');
  }
}

// ---------------- Connected services panel ----------------
// Real status only — no placeholder "3 services" claims. GitHub is
// always connected here (you can't reach this page otherwise); Vercel
// is optional, and its card + the overall banner reflect that.
async function loadConnectionsPanel() {
  if (!els.connCards) return;
  let githubMode = null;
  let githubUser = null;
  let vercelConnected = false;
  let vercelUsername = null;

  try {
    const me = await api('/auth/me');
    githubUser = me.user?.github_username || null;
    githubMode = me.github_auth_mode;
  } catch {
    // Not signed in — shouldn't happen on this route, but fail quiet.
  }

  try {
    const conn = await api('/vercel/connection');
    vercelConnected = Boolean(conn.connected);
    vercelUsername = conn.username || null;
  } catch {
    // Vercel connection check failing isn't fatal to the upload page.
  }

  const githubLabel = githubMode === 'github_app' ? t('conn_github_app') : t('conn_github_oauth');
  els.connCards.innerHTML = `
    <div class="upload-conn-card">
      <div class="upload-conn-card__left">
        <span class="upload-conn-card__icon"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.5 0-.24-.01-1.04-.01-1.89-2.78.61-3.37-1.2-3.37-1.2-.45-1.18-1.11-1.49-1.11-1.49-.9-.63.07-.62.07-.62 1 .07 1.53 1.04 1.53 1.04.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.31.1-2.73 0 0 .84-.27 2.75 1.05a9.36 9.36 0 015 0c1.91-1.32 2.75-1.05 2.75-1.05.55 1.42.2 2.47.1 2.73.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .28.18.6.69.5A10.26 10.26 0 0022 12.25C22 6.58 17.52 2 12 2z"/></svg></span>
        <div>
          <div class="upload-conn-card__name">GitHub <span class="tag tag--success">${esc(t('conn_connected'))}</span></div>
          <div class="upload-conn-card__meta">${esc(githubLabel)} \u00b7 @${esc(githubUser || '\u2014')}</div>
        </div>
      </div>
    </div>
    <div class="upload-conn-card">
      <div class="upload-conn-card__left">
        <span class="upload-conn-card__icon"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 19.5h20L12 2z"/></svg></span>
        <div>
          <div class="upload-conn-card__name">Vercel <span class="tag ${vercelConnected ? 'tag--success' : 'tag--danger'}">${esc(vercelConnected ? t('conn_connected') : t('conn_not_connected'))}</span></div>
          <div class="upload-conn-card__meta">${vercelConnected ? '@' + esc(vercelUsername || '') : t('upload_conn_vercel_hint')}</div>
        </div>
      </div>
    </div>
  `;

  if (els.connSummary) {
    els.connSummary.innerHTML = `<span class="repo-conn-card__dot ${vercelConnected ? '' : 'repo-conn-card__dot--off'}"></span><span>${esc(vercelConnected ? t('upload_conn_all_ready') : t('upload_conn_partial'))}</span>`;
  }
  if (els.connBanner) {
    if (vercelConnected) {
      els.connBanner.className = 'banner banner--info';
      els.connBanner.textContent = t('upload_conn_all_ready_desc');
    } else {
      els.connBanner.className = 'banner banner--warning';
      els.connBanner.textContent = t('upload_conn_no_vercel_desc');
    }
    els.connBanner.classList.remove('hidden');
  }

  // Deploy CTA only makes sense once Vercel is actually connected.
  if (els.deployBtn && !vercelConnected) {
    els.deployBtn.title = t('upload_conn_no_vercel_desc');
  }
}

els.dropzoneBrowseBtn?.addEventListener('click', () => els.filesInput.click());

els.commitMessage?.addEventListener('input', () => {
  if (els.commitMessageCount) els.commitMessageCount.textContent = String(els.commitMessage.value.length);
});
if (els.commitMessage && els.commitMessageCount) els.commitMessageCount.textContent = String(els.commitMessage.value.length);

// ---------------- File picking ----------------

els.pickFilesBtn.addEventListener('click', () => els.filesInput.click());
els.pickFolderBtn.addEventListener('click', () => els.folderInput.click());
els.pickZipBtn.addEventListener('click', () => els.zipInput.click());

els.filesInput.addEventListener('change', () => analyzeFileList(els.filesInput.files));
els.folderInput.addEventListener('change', () => analyzeFileList(els.folderInput.files));
els.zipInput.addEventListener('change', () => {
  if (els.zipInput.files[0]) analyzeZip(els.zipInput.files[0]);
});

['dragenter', 'dragover'].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.add('dropzone--active');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove('dropzone--active');
  })
);
els.dropzone.addEventListener('drop', (e) => {
  const dropped = e.dataTransfer.files;
  if (!dropped.length) return;
  if (dropped.length === 1 && dropped[0].name.toLowerCase().endsWith('.zip')) {
    analyzeZip(dropped[0]);
  } else {
    analyzeFileList(dropped);
  }
});

// ---------------- Analyze ----------------

function showAnalyzing() {
  els.analyzing.classList.remove('hidden');
  els.error.classList.add('hidden');
  els.preview.classList.add('hidden');
  els.result.classList.add('hidden');
  els.analyzeProgressBar.style.width = '0%';
  els.analyzeProgressBar.classList.remove('upload-progress__bar--indeterminate');
  els.analyzeProgressLabel.textContent = '0%';
  if (els.analyzeProgressStage) els.analyzeProgressStage.textContent = t('analyzing_bytes');
}

// Once the browser finishes sending bytes, the request is still in
// flight while the server unzips/scans/detects project types — that gap
// used to leave the bar sitting at a misleading 100%. Switching to an
// indeterminate sweep here keeps it honest (we genuinely don't know the
// server-side percentage) while still showing visible motion.
function showAnalyzingServerSide() {
  els.analyzeProgressBar.style.width = '100%';
  els.analyzeProgressBar.classList.add('upload-progress__bar--indeterminate');
  els.analyzeProgressLabel.textContent = '';
  if (els.analyzeProgressStage) els.analyzeProgressStage.textContent = t('analyzing_server');
}

// fetch() has no upload-progress event — only XHR does. This is what
// drives the real (not simulated) 0-100% bar while the file bytes are
// actually being sent, for both the ZIP and files/folder paths.
function uploadWithProgress(url, form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener('load', () => {
      let json;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        return reject(new Error(t('server_bad_response')));
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(json);
      else reject(new Error(json.error || t('request_failed', { status: xhr.status })));
    });
    xhr.addEventListener('error', () => reject(new Error(t('network_error_upload'))));
    xhr.send(form);
  });
}

async function analyzeZip(file) {
  showAnalyzing();
  const form = new FormData();
  form.append('zip', file);
  try {
    const data = await uploadWithProgress(`${API_BASE}/uploads/analyze-zip`, form, (pct) => {
      els.analyzeProgressBar.style.width = `${pct}%`;
      els.analyzeProgressLabel.textContent = `${pct}%`;
      if (pct >= 100) showAnalyzingServerSide();
    });
    onAnalyzed(data);
  } catch (err) {
    showError(err.message);
  }
}

async function analyzeFileList(fileList) {
  const files = Array.from(fileList);
  const oversized = files.filter((f) => f.size > MAX_FILE_SIZE);
  if (oversized.length) {
    showError(
      t('files_exceed_limit', {
        n: oversized.length,
        size: humanSize(MAX_FILE_SIZE),
        names: oversized.map((f) => f.name).slice(0, 5).join(', ') + (oversized.length > 5 ? '…' : ''),
      })
    );
    return;
  }
  showAnalyzing();
  const paths = files.map((f) => f.webkitRelativePath || f.name);
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  form.append('paths', JSON.stringify(paths));
  try {
    const data = await uploadWithProgress(`${API_BASE}/uploads/analyze-files`, form, (pct) => {
      els.analyzeProgressBar.style.width = `${pct}%`;
      els.analyzeProgressLabel.textContent = `${pct}%`;
      if (pct >= 100) showAnalyzingServerSide();
    });
    onAnalyzed(data);
  } catch (err) {
    showError(err.message);
  }
}

function showError(message) {
  els.analyzing.classList.add('hidden');
  els.error.textContent = message;
  els.error.classList.remove('hidden');
}

function onAnalyzed(data) {
  analysis = data;
  excluded = new Set(data.files.filter((f) => f.secret).map((f) => f.path)); // secrets excluded by default
  gitignoreChoice = null;

  els.analyzing.classList.add('hidden');
  els.preview.classList.remove('hidden');
  els.commitBtn.disabled = false;
  if (els.deployBtn) els.deployBtn.disabled = false;
  renderPreview();
}

// ---------------- Preview rendering ----------------

function renderBanners() {
  const parts = [];

  if (analysis.detectedProjectTypes.length) {
    parts.push(
      `<div class="banner banner--info">${t('detected_project', { types: `<strong>${esc(analysis.detectedProjectTypes.join(', '))}</strong>` })}</div>`
    );
  }

  const secretCount = analysis.files.filter((f) => f.secret).length;
  if (secretCount) {
    parts.push(
      `<div class="banner banner--warning">${t(secretCount > 1 ? 'secret_files_warning_other' : 'secret_files_warning_one', { n: secretCount })}</div>`
    );
  }

  if (!analysis.hasGitignore) {
    parts.push(`
      <div class="banner banner--info">
        ${t('no_gitignore_found')}
        <select id="gitignoreSelect" class="branch-select" style="margin-left:8px">
          <option value="">${t('dont_add_one')}</option>
          ${analysis.gitignoreTemplates.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
        </select>
      </div>`);
  }

  els.banners.innerHTML = parts.join('');

  const gitignoreSelect = document.getElementById('gitignoreSelect');
  if (gitignoreSelect) {
    gitignoreSelect.addEventListener('change', () => {
      gitignoreChoice = gitignoreSelect.value || null;
    });
  }
}

// Groups flat paths like "src/components/Button.js" into a nested tree
// { name, path, type: 'folder'|'file', children: [...] } so ZIP/folder
// uploads render as an actual folder structure instead of one long flat
// list — this is automatic: it's purely derived from each file's path,
// no extra input needed from the user.
function buildTree(files) {
  const root = { name: '', path: '', type: 'folder', children: new Map() };
  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean);
    let node = root;
    let acc = '';
    parts.forEach((part, i) => {
      acc = acc ? `${acc}/${part}` : part;
      const isFile = i === parts.length - 1;
      if (!node.children.has(part)) {
        node.children.set(part, isFile ? { name: part, path: acc, type: 'file', file: f } : { name: part, path: acc, type: 'folder', children: new Map() });
      }
      node = node.children.get(part);
    });
  }
  return root;
}

function renderNode(node, depth) {
  const entries = [...node.children.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1; // folders first
    return a.name.localeCompare(b.name);
  });

  return entries
    .map((n) => {
      const indent = 14 + depth * 18;
      if (n.type === 'folder') {
        const fileCount = countFiles(n);
        return `
          <div class="upload-tree-folder" data-folder-path="${esc(n.path)}">
            <button type="button" class="upload-tree-folder__toggle" style="padding-left:${indent}px" data-toggle-folder="${esc(n.path)}">
              <span class="upload-tree-folder__chevron">▾</span>
              <span class="upload-tree-folder__name">${esc(n.name)}/</span>
              <span class="muted upload-tree-folder__count">${t(fileCount === 1 ? 'folder_file_count_one' : 'folder_file_count_other', { n: fileCount })}</span>
            </button>
            <div class="upload-tree-folder__children" data-folder-children="${esc(n.path)}">
              ${renderNode(n, depth + 1)}
            </div>
          </div>`;
      }
      const f = n.file;
      const isExcluded = excluded.has(f.path);
      return `
        <label class="upload-file-row ${f.secret ? 'upload-file-row--secret' : ''}" style="padding-left:${indent}px">
          <input type="checkbox" data-path="${esc(f.path)}" ${isExcluded ? '' : 'checked'} />
          <span class="mono upload-file-row__path">${esc(n.name)}</span>
          ${f.secret ? `<span class="tag tag--danger">${t('secret_tag')}</span>` : ''}
          <span class="muted upload-file-row__size">${humanSize(f.size)}</span>
        </label>`;
    })
    .join('');
}

function countFiles(node) {
  let count = 0;
  for (const child of node.children.values()) {
    count += child.type === 'file' ? 1 : countFiles(child);
  }
  return count;
}

function renderFileList() {
  const tree = buildTree(analysis.files);
  els.fileList.innerHTML = renderNode(tree, 0);

  els.fileList.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const path = cb.dataset.path;
      if (cb.checked) excluded.delete(path);
      else excluded.add(path);
      updateCounts();
    });
  });

  els.fileList.querySelectorAll('[data-toggle-folder]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const children = els.fileList.querySelector(`[data-folder-children="${CSS.escape(btn.dataset.toggleFolder)}"]`);
      const collapsed = children.classList.toggle('is-collapsed');
      btn.querySelector('.upload-tree-folder__chevron').textContent = collapsed ? '▸' : '▾';
    });
  });
}

function updateCounts() {
  const included = analysis.files.filter((f) => !excluded.has(f.path));
  els.fileCount.textContent = included.length;
  els.totalSize.textContent = humanSize(included.reduce((s, f) => s + f.size, 0));
}

function renderPreview() {
  renderBanners();
  renderFileList();
  updateCounts();
}

// ---------------- Reset ----------------

async function resetUpload() {
  if (analysis?.jobId) {
    api(`/uploads/${analysis.jobId}/cancel`, { method: 'POST' }).catch(() => {});
  }
  analysis = null;
  excluded = new Set();
  gitignoreChoice = null;
  els.preview.classList.add('hidden');
  els.result.classList.add('hidden');
  els.error.classList.add('hidden');
  els.filesInput.value = '';
  els.folderInput.value = '';
  els.zipInput.value = '';
  els.commitBtn.disabled = true;
  if (els.deployBtn) els.deployBtn.disabled = true;
}
els.resetBtn.addEventListener('click', resetUpload);

// ---------------- Commit ----------------

// Real stage → percent-range mapping. Blob creation is the true bulk of
// the work (proportional to file count) so it gets most of the bar;
// tree/commit/ref are each a single fast API call.
const STAGE_RANGES = {
  base: [0, 4],
  blobs: [4, 85],
  tree: [85, 92],
  commit: [92, 97],
  ref: [97, 99], // never 100 here — that's reserved for the actual HTTP response
};

function pctForProgress(stage, completed, total) {
  const [from, to] = STAGE_RANGES[stage] || [0, 99];
  if (stage === 'blobs' && total > 0) {
    return from + (to - from) * Math.min(1, completed / total);
  }
  return to;
}

function startCommitProgress(jobId) {
  els.progressWrap.classList.remove('hidden');
  els.progressBar.style.width = '0%';
  els.progressBar.classList.remove('upload-progress__bar--indeterminate');
  els.progressLabel.textContent = '0%';
  els.progressStage.textContent = t('stage_uploading');

  let stopped = false;
  let lastPct = 0;

  const render = (stage, completed, total) => {
    const pct = Math.max(lastPct, pctForProgress(stage, completed, total));
    lastPct = pct;
    els.progressBar.style.width = `${pct.toFixed(0)}%`;
    els.progressLabel.textContent = `${pct.toFixed(0)}%`;
    const stageKey = `stage_${stage}`;
    els.progressStage.textContent =
      stage === 'blobs' && total > 0
        ? `${t('stage_blobs')} — ${t('stage_blobs_count', { done: completed, total })}`
        : t(stageKey) || '';
  };

  // Polls the actual job row — populated in real time by the server as
  // each blob/tree/commit/ref call completes (see routes/uploads.js and
  // bulkCommitService.commitFiles). This is real work being reported,
  // not a fake timer easing toward a guess.
  async function poll() {
    if (stopped) return;
    try {
      const job = await api(`/uploads/${jobId}`);
      if (job.progress_stage) render(job.progress_stage, job.progress_completed, job.progress_total);
    } catch {
      // Transient poll failure — keep the last known bar state and retry.
    }
    if (!stopped) setTimeout(poll, 350);
  }
  setTimeout(poll, 350);

  return () => {
    stopped = true;
  };
}

function finishCommitProgress(stopTimer) {
  stopTimer();
  els.progressBar.style.width = '100%';
  els.progressLabel.textContent = '100%';
  els.progressStage.textContent = t('commit_done');
  setTimeout(() => els.progressWrap.classList.add('hidden'), 900);
}

// Does the actual commit — shared by both CTA buttons below. Throws on
// failure (repo not picked, or the API call itself failing); callers
// decide how to present that.
async function performCommit() {
  const fullName = els.repoSelect.value;
  if (!fullName) {
    alert(t('pick_repo_first'));
    throw new Error('UPGIT_NO_REPO');
  }
  const [owner, repo] = fullName.split('/');
  const branch = els.branchSelect.value;
  const message = els.commitMessage.value.trim() || t('upload_project_default_msg');

  const stopTimer = startCommitProgress(analysis.jobId);
  try {
    const result = await api(`/uploads/${analysis.jobId}/commit`, {
      method: 'POST',
      body: JSON.stringify({
        owner,
        repo,
        branch,
        targetPath: els.targetPath.value.trim(),
        message,
        excludePaths: [...excluded],
        gitignoreTemplate: gitignoreChoice,
      }),
    });
    finishCommitProgress(stopTimer);
    return { owner, repo, branch, result };
  } catch (err) {
    stopTimer();
    els.progressWrap.classList.add('hidden');
    throw err;
  }
}

function showCommitResult({ owner, repo, branch, result }, deployInfo) {
  els.preview.classList.add('hidden');
  els.result.classList.remove('hidden');
  const deployBlock = !deployInfo
    ? ''
    : deployInfo.error
      ? `<p class="muted" style="color:var(--danger)">${t('upload_deploy_failed', { msg: esc(deployInfo.error) })}</p>`
      : `<p><a href="#/vercel/deployments/${esc(deployInfo.id || deployInfo.uid)}" style="color:var(--accent)">${t('upload_deploy_view_link')}</a></p>`;

  els.result.innerHTML = `
    <p><strong>${t(result.file_count > 1 ? 'files_committed_other' : 'files_committed_one', { n: result.file_count })}</strong></p>
    <p class="muted">${t('commit_on')} <span class="mono">${result.commit_sha.slice(0, 10)}</span> on
      <a href="https://github.com/${esc(owner)}/${esc(repo)}/commits/${esc(branch)}" target="_blank" rel="noopener" style="color:var(--accent)">${esc(owner)}/${esc(repo)}@${esc(branch)}</a>
    </p>
    <p><a href="#/repo/${esc(owner)}/${esc(repo)}" style="color:var(--accent)">${t('open_repository_link')}</a></p>
    ${deployBlock}
  `;
  analysis = null;
}

function setCtaBusy(busy) {
  els.commitBtn.disabled = busy;
  if (els.deployBtn) els.deployBtn.disabled = busy;
}

els.commitBtn.addEventListener('click', async () => {
  if (!analysis) return;
  setCtaBusy(true);
  els.commitBtn.textContent = t('uploading');
  try {
    const commit = await performCommit();
    showCommitResult(commit);
  } catch (err) {
    if (err.message !== 'UPGIT_NO_REPO') alert(t('upload_failed', { msg: err.message }));
  } finally {
    setCtaBusy(false);
    els.commitBtn.textContent = t('upload_commit');
  }
});

els.deployBtn?.addEventListener('click', async () => {
  if (!analysis) return;
  setCtaBusy(true);
  els.deployBtn.textContent = t('uploading');
  try {
    const commit = await performCommit();
    els.deployBtn.textContent = t('v_deploying');
    try {
      const deployment = await api('/vercel/deploy', {
        method: 'POST',
        body: JSON.stringify({
          repoFullName: `${commit.owner}/${commit.repo}`,
          branch: commit.branch,
          projectName: commit.repo,
          target: 'production',
        }),
      });
      showCommitResult(commit, deployment);
    } catch (deployErr) {
      // The push already succeeded — don't hide that behind a deploy
      // error. Show the commit result plus a clear (separate) deploy
      // failure instead of a generic alert.
      showCommitResult(commit, { error: deployErr.message });
    }
  } catch (err) {
    if (err.message !== 'UPGIT_NO_REPO') alert(t('upload_failed', { msg: err.message }));
  } finally {
    setCtaBusy(false);
    els.deployBtn.textContent = t('upload_cta_deploy_btn');
  }
});

// ---------------- Entry point ----------------

let loaded = false;
onRoute('upload', async () => {
  loadConnectionsPanel();
  if (!loaded) {
    loaded = true;
    await loadRepos();
    try {
      const settings = await api('/settings');
      if (settings.default_commit_message) {
        els.commitMessage.value = settings.default_commit_message;
        if (els.commitMessageCount) els.commitMessageCount.textContent = String(els.commitMessage.value.length);
      }
    } catch {
      // Non-fatal — keep the hardcoded default in the HTML.
    }
  }
});
