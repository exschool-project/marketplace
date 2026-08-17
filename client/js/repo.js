import { api, onRoute } from './app.js';
import { lineDiff } from './diff.js';
import { mountEditor, getEditorContent, destroyEditor, triggerSearch, triggerUndo, triggerRedo } from './editor.js';
import { t } from './i18n.js';

const els = {
  title: document.getElementById('repoTitle'),
  branchSelect: document.getElementById('branchSelect'),
  error: document.getElementById('repoError'),
  body: document.getElementById('repoBody'),
  tree: document.getElementById('fileTree'),
  newFileBtn: document.getElementById('newFileBtn'),

  editorEmpty: document.getElementById('editorEmpty'),
  editorActive: document.getElementById('editorActive'),
  editorPath: document.getElementById('editorPath'),
  editorHost: document.getElementById('editorHost'),
  editorWarning: document.getElementById('editorWarning'),
  searchBtn: document.getElementById('searchBtn'),
  undoBtn: document.getElementById('undoBtn'),
  redoBtn: document.getElementById('redoBtn'),
  saveFileBtn: document.getElementById('saveFileBtn'),
  deleteFileBtn: document.getElementById('deleteFileBtn'),

  commitModal: document.getElementById('commitModal'),
  commitFilePath: document.getElementById('commitFilePath'),
  commitDiff: document.getElementById('commitDiff'),
  commitMessage: document.getElementById('commitMessage'),
  commitBranch: document.getElementById('commitBranch'),
  commitCancelBtn: document.getElementById('commitCancelBtn'),
  commitConfirmBtn: document.getElementById('commitConfirmBtn'),

  deleteModal: document.getElementById('deleteModal'),
  deleteFilePath: document.getElementById('deleteFilePath'),
  deleteMessage: document.getElementById('deleteMessage'),
  deleteCancelBtn: document.getElementById('deleteCancelBtn'),
  deleteConfirmBtn: document.getElementById('deleteConfirmBtn'),
};

// Current repo/editor state — reset on every navigation into a repo.
let state = {
  owner: '',
  repo: '',
  defaultBranch: 'main',
  branch: 'main',
  branches: [],
  openFile: null, // { path, sha, originalContent, tooLarge }
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------- Tree rendering ----------------

function buildNestedTree(flatEntries) {
  const root = { name: '', type: 'tree', children: new Map() };
  for (const entry of flatEntries) {
    if (entry.type !== 'blob' && entry.type !== 'tree') continue;
    const parts = entry.path.split('/');
    let node = root;
    parts.forEach((part, idx) => {
      const isLeaf = idx === parts.length - 1;
      if (!node.children.has(part)) {
        node.children.set(part, {
          name: part,
          type: isLeaf ? entry.type : 'tree',
          path: parts.slice(0, idx + 1).join('/'),
          children: new Map(),
        });
      }
      node = node.children.get(part);
    });
  }
  return root;
}

function renderTreeNode(node, depth = 0) {
  const dirs = [...node.children.values()].filter((c) => c.type === 'tree').sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.children.values()].filter((c) => c.type === 'blob').sort((a, b) => a.name.localeCompare(b.name));

  let html = '';
  for (const dir of dirs) {
    html += `<details class="tree-dir" style="--depth:${depth}">
      <summary>${esc(dir.name)}/</summary>
      ${renderTreeNode(dir, depth + 1)}
    </details>`;
  }
  for (const file of files) {
    html += `<div class="tree-file" style="--depth:${depth}" data-path="${esc(file.path)}">${esc(file.name)}</div>`;
  }
  return html;
}

function attachTreeHandlers() {
  els.tree.querySelectorAll('.tree-file').forEach((el) => {
    el.addEventListener('click', () => openFile(el.dataset.path));
  });
}

async function loadTree() {
  els.tree.innerHTML = `<p class="muted">${t('loading_tree')}</p>`;
  try {
    const tree = await api(`/github/repos/${state.owner}/${state.repo}/tree?branch=${encodeURIComponent(state.branch)}`);
    const nested = buildNestedTree(tree.tree || []);
    els.tree.innerHTML = renderTreeNode(nested) || `<p class="muted">${t('empty_repo')}</p>`;
    attachTreeHandlers();
  } catch (err) {
    els.tree.innerHTML = `<p class="muted">${t('failed_load_files', { msg: esc(err.message) })}</p>`;
  }
}

// ---------------- File viewer / editor ----------------

async function openFile(path) {
  els.editorEmpty.classList.add('hidden');
  els.editorActive.classList.remove('hidden');
  els.editorPath.textContent = path;
  els.editorWarning.classList.add('hidden');
  destroyEditor();
  els.editorHost.innerHTML = `<p class="muted" style="padding:14px">${t('loading')}</p>`;

  try {
    const data = await api(`/github/repos/${state.owner}/${state.repo}/file?path=${encodeURIComponent(path)}&ref=${encodeURIComponent(state.branch)}`);

    if (data.tooLarge) {
      state.openFile = { path, sha: data.sha, originalContent: null, currentContent: null, tooLarge: true };
      els.editorHost.innerHTML = '';
      els.editorWarning.textContent = data.message;
      els.editorWarning.classList.remove('hidden');
      return;
    }

    state.openFile = { path, sha: data.sha, originalContent: data.content, currentContent: data.content, tooLarge: false };
    els.editorHost.innerHTML = '';
    await mountEditor(els.editorHost, {
      doc: data.content,
      path,
      readOnly: false,
      onChange: (newContent) => {
        if (state.openFile) state.openFile.currentContent = newContent;
      },
    });
  } catch (err) {
    els.editorHost.innerHTML = '';
    els.editorWarning.textContent = t('failed_load_file', { msg: err.message });
    els.editorWarning.classList.remove('hidden');
  }
}

// ---------------- Commit modal ----------------

function renderDiff(oldText, newText) {
  const { rows, additions, deletions } = lineDiff(oldText, newText);
  const summary = `<p class="muted diff__summary">+${additions} / -${deletions}</p>`;
  const body = rows
    .map((r) => {
      const cls = r.type === 'add' ? 'diff-add' : r.type === 'del' ? 'diff-del' : 'diff-ctx';
      const prefix = r.type === 'add' ? '+' : r.type === 'del' ? '-' : ' ';
      return `<div class="${cls}">${prefix} ${esc(r.text)}</div>`;
    })
    .join('');
  return summary + `<div class="diff__body">${body}</div>`;
}

async function populateBranchSelect(select, selected) {
  select.innerHTML = state.branches.map((b) => `<option value="${esc(b.name)}" ${b.name === selected ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
}

els.searchBtn.addEventListener('click', () => triggerSearch());
els.undoBtn.addEventListener('click', () => triggerUndo());
els.redoBtn.addEventListener('click', () => triggerRedo());

els.saveFileBtn.addEventListener('click', async () => {
  if (!state.openFile || state.openFile.tooLarge) return;
  const newContent = getEditorContent();
  if (newContent === state.openFile.originalContent) {
    alert(t('no_changes_commit'));
    return;
  }

  els.commitFilePath.textContent = state.openFile.path;
  els.commitDiff.innerHTML = renderDiff(state.openFile.originalContent, newContent);
  els.commitMessage.value = `Update ${state.openFile.path}`;
  await populateBranchSelect(els.commitBranch, state.branch);
  els.commitModal.classList.remove('hidden');
});

els.commitCancelBtn.addEventListener('click', () => els.commitModal.classList.add('hidden'));

els.commitConfirmBtn.addEventListener('click', async () => {
  const path = state.openFile.path;
  const content = getEditorContent();
  const message = els.commitMessage.value.trim() || `Update ${path}`;
  const branch = els.commitBranch.value;

  els.commitConfirmBtn.disabled = true;
  els.commitConfirmBtn.textContent = t('committing');
  try {
    const result = await api(`/github/repos/${state.owner}/${state.repo}/file`, {
      method: 'PUT',
      body: JSON.stringify({ path, content, message, branch, sha: state.openFile.sha }),
    });
    state.openFile.sha = result.content_sha;
    state.openFile.originalContent = content;
    els.commitModal.classList.add('hidden');
    if (branch === state.branch) loadTree();
  } catch (err) {
    alert(t('commit_failed', { msg: err.message }));
  } finally {
    els.commitConfirmBtn.disabled = false;
    els.commitConfirmBtn.textContent = t('commit_changes');
  }
});

// ---------------- Delete modal ----------------

els.deleteFileBtn.addEventListener('click', () => {
  if (!state.openFile || state.openFile.tooLarge) return;
  els.deleteFilePath.textContent = state.openFile.path;
  els.deleteModal.classList.remove('hidden');
});

els.deleteCancelBtn.addEventListener('click', () => els.deleteModal.classList.add('hidden'));

els.deleteConfirmBtn.addEventListener('click', async () => {
  const { path, sha } = state.openFile;
  const message = els.deleteMessage.value.trim() || `Delete ${path}`;

  els.deleteConfirmBtn.disabled = true;
  try {
    await api(`/github/repos/${state.owner}/${state.repo}/file`, {
      method: 'DELETE',
      body: JSON.stringify({ path, message, branch: state.branch, sha }),
    });
    els.deleteModal.classList.add('hidden');
    destroyEditor();
    els.editorHost.innerHTML = '';
    els.editorActive.classList.add('hidden');
    els.editorEmpty.classList.remove('hidden');
    state.openFile = null;
    loadTree();
  } catch (err) {
    alert(t('delete_failed', { msg: err.message }));
  } finally {
    els.deleteConfirmBtn.disabled = false;
  }
});

// ---------------- New file ----------------

els.newFileBtn.addEventListener('click', async () => {
  const path = prompt(t('new_file_prompt'));
  if (!path) return;

  els.editorEmpty.classList.add('hidden');
  els.editorActive.classList.remove('hidden');
  els.editorPath.textContent = path;
  els.editorWarning.classList.add('hidden');
  destroyEditor();
  els.editorHost.innerHTML = '';
  state.openFile = { path, sha: undefined, originalContent: '', currentContent: '', tooLarge: false };
  await mountEditor(els.editorHost, {
    doc: '',
    path,
    readOnly: false,
    onChange: (newContent) => {
      if (state.openFile) state.openFile.currentContent = newContent;
    },
  });
});

// ---------------- Branch switching ----------------

els.branchSelect.addEventListener('change', () => {
  state.branch = els.branchSelect.value;
  destroyEditor();
  els.editorHost.innerHTML = '';
  els.editorActive.classList.add('hidden');
  els.editorEmpty.classList.remove('hidden');
  state.openFile = null;
  loadTree();
});

// ---------------- Entry point ----------------

async function openRepo(owner, repo) {
  state = { owner, repo, defaultBranch: 'main', branch: 'main', branches: [], openFile: null };
  els.title.textContent = `${owner}/${repo}`;
  els.error.classList.add('hidden');
  els.body.classList.add('hidden');
  destroyEditor();
  els.editorHost.innerHTML = '';
  els.editorActive.classList.add('hidden');
  els.editorEmpty.classList.remove('hidden');

  try {
    const [repoInfo, branchData] = await Promise.all([
      api(`/github/repos/${owner}/${repo}`),
      api(`/github/repos/${owner}/${repo}/branches`),
    ]);

    state.defaultBranch = repoInfo.default_branch;
    state.branch = repoInfo.default_branch;
    state.branches = branchData.branches;

    await populateBranchSelect(els.branchSelect, state.branch);
    els.body.classList.remove('hidden');
    await loadTree();
    broadcastRepoState();
  } catch (err) {
    els.error.textContent = err.status === 404
      ? t('repo_not_found')
      : t('failed_open_repo', { msg: err.message });
    els.error.classList.remove('hidden');
  }
}

function broadcastRepoState() {
  document.dispatchEvent(
    new CustomEvent('upgit:repo-opened', {
      detail: { owner: state.owner, repo: state.repo, branch: state.branch, branches: state.branches },
    })
  );
}

onRoute('repo', openRepo);

// Navigating away from the repo view entirely (e.g. back to dashboard) —
// tear down the editor instance so it doesn't linger detached in memory.
window.addEventListener('hashchange', () => {
  if (!window.location.hash.startsWith('#/repo/')) {
    destroyEditor();
  }
});
