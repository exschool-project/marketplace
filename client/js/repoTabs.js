import { api } from './app.js';
import { t } from './i18n.js';

const tabsBar = document.getElementById('repoTabs');
const panels = {
  files: document.getElementById('tabPanel-files'),
  branches: document.getElementById('tabPanel-branches'),
  commits: document.getElementById('tabPanel-commits'),
  issues: document.getElementById('tabPanel-issues'),
  pulls: document.getElementById('tabPanel-pulls'),
  actions: document.getElementById('tabPanel-actions'),
  releases: document.getElementById('tabPanel-releases'),
};

let current = { owner: '', repo: '', branch: 'main', branches: [] };
let commitsPage = 1;
let issueState = 'open';
let prState = 'open';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.addEventListener('upgit:repo-opened', (e) => {
  current = e.detail;
  switchTab('files');
});

function switchTab(name) {
  tabsBar.querySelectorAll('.repo-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
  Object.entries(panels).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));

  if (name === 'branches') loadBranchesTab();
  if (name === 'commits') { commitsPage = 1; document.getElementById('commitsList').innerHTML = ''; loadCommitsTab(); }
  if (name === 'issues') loadIssuesTab();
  if (name === 'pulls') loadPullsTab();
  if (name === 'actions') loadActionsTab();
  if (name === 'releases') loadReleasesTab();
}

tabsBar.querySelectorAll('.repo-tab').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ================= Branches =================

async function loadBranchesTab() {
  const el = document.getElementById('branchesList');
  el.innerHTML = `<p class="muted">${t('loading')}</p>`;
  try {
    const { branches } = await api(`/github/repos/${current.owner}/${current.repo}/branches`);
    current.branches = branches;

    document.getElementById('newBranchFrom').innerHTML = branches
      .map((b) => `<option value="${esc(b.name)}" ${b.name === current.branch ? 'selected' : ''}>${esc(b.name)}</option>`)
      .join('');

    el.innerHTML = branches
      .map(
        (b) => `
        <div class="repo-item">
          <div>
            <div class="repo-item__name">${esc(b.name)} ${b.protected ? `<span class="tag">${t('protected_tag')}</span>` : ''}</div>
          </div>
          <button class="btn btn--sm btn--danger" data-branch="${esc(b.name)}">${t('delete')}</button>
        </div>`
      )
      .join('');

    el.querySelectorAll('button[data-branch]').forEach((btn) => {
      btn.addEventListener('click', () => deleteBranch(btn.dataset.branch));
    });
  } catch (err) {
    el.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

async function deleteBranch(name) {
  if (!confirm(t('delete_branch_confirm', { name }))) return;
  try {
    await api(`/github/repos/${current.owner}/${current.repo}/branches/${encodeURIComponent(name)}`, { method: 'DELETE' });
    loadBranchesTab();
  } catch (err) {
    alert(t('failed_delete_branch', { msg: err.message }));
  }
}

document.getElementById('createBranchBtn').addEventListener('click', async () => {
  const name = document.getElementById('newBranchName').value.trim();
  const from = document.getElementById('newBranchFrom').value;
  if (!name) return alert(t('enter_branch_name'));
  try {
    await api(`/github/repos/${current.owner}/${current.repo}/branches`, {
      method: 'POST',
      body: JSON.stringify({ branch: name, from }),
    });
    document.getElementById('newBranchName').value = '';
    loadBranchesTab();
  } catch (err) {
    alert(t('failed_create_branch', { msg: err.message }));
  }
});

// ================= Commits =================

async function loadCommitsTab() {
  document.getElementById('commitsBranchLabel').textContent = current.branch;
  const el = document.getElementById('commitsList');
  const loadingEl = document.createElement('p');
  loadingEl.className = 'muted';
  loadingEl.textContent = t('loading');
  el.appendChild(loadingEl);

  try {
    const { commits } = await api(
      `/github/repos/${current.owner}/${current.repo}/commits?branch=${encodeURIComponent(current.branch)}&page=${commitsPage}`
    );
    loadingEl.remove();

    commits.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'repo-item';
      row.innerHTML = `
        <div>
          <div class="repo-item__name">${esc(c.message.split('\n')[0])}</div>
          <div class="repo-item__meta">${esc(c.author)} · ${c.date ? new Date(c.date).toLocaleString() : ''}</div>
        </div>
        <span class="mono repo-item__vis" style="cursor:pointer" data-sha="${esc(c.sha)}" title="View diff">${c.sha.slice(0, 7)}</span>`;
      row.querySelector('[data-sha]').addEventListener('click', () => showCommitDetail(c.sha));
      el.appendChild(row);
    });

    commitsPage++;
  } catch (err) {
    loadingEl.textContent = t('failed_load_commits', { msg: err.message });
  }
}

document.getElementById('loadMoreCommitsBtn').addEventListener('click', () => loadCommitsTab());

function renderPatch(patch) {
  if (!patch) return `<p class="muted" style="padding:8px">${t('binary_or_too_large')}</p>`;
  return patch
    .split('\n')
    .map((line) => {
      let cls = 'diff-ctx';
      if (line.startsWith('+') && !line.startsWith('+++')) cls = 'diff-add';
      else if (line.startsWith('-') && !line.startsWith('---')) cls = 'diff-del';
      return `<div class="${cls}">${esc(line)}</div>`;
    })
    .join('');
}

async function showCommitDetail(sha) {
  const panel = document.getElementById('commitDetailPanel');
  panel.classList.remove('hidden');
  panel.innerHTML = `<p class="muted">${t('loading')}</p>`;
  try {
    const c = await api(`/github/repos/${current.owner}/${current.repo}/commits/${sha}`);
    panel.innerHTML = `
      <h2>${t('commit_label')} <span class="mono">${c.sha.slice(0, 10)}</span></h2>
      <p style="white-space:pre-wrap">${esc(c.message)}</p>
      <p class="muted">${esc(c.author)} · ${c.date ? new Date(c.date).toLocaleString() : ''} · +${c.stats.additions}/-${c.stats.deletions}</p>
      ${(c.files || [])
        .map(
          (f) => `
        <details style="border-bottom:2px solid var(--border)">
          <summary style="padding:8px 10px;cursor:pointer" class="mono">${esc(f.filename)} <span class="muted">(${f.status}, +${f.additions}/-${f.deletions})</span></summary>
          <div class="diff__body">${renderPatch(f.patch)}</div>
        </details>`
        )
        .join('') || `<p class="muted">${t('no_file_changes')}</p>`}
    `;
  } catch (err) {
    panel.innerHTML = `<p class="muted">${t('failed_load_commit', { msg: err.message })}</p>`;
  }
}

// ================= Issues =================

document.querySelectorAll('#tabPanel-issues .state-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#tabPanel-issues .state-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
    issueState = btn.dataset.state;
    loadIssuesTab();
  });
});

async function loadIssuesTab() {
  const el = document.getElementById('issuesList');
  el.innerHTML = `<p class="muted">${t('loading')}</p>`;
  document.getElementById('issueDetailPanel').classList.add('hidden');
  try {
    const { issues } = await api(`/github/repos/${current.owner}/${current.repo}/issues?state=${issueState}`);
    if (!issues.length) {
      el.innerHTML = `<p class="muted">${t('no_issues')}</p>`;
      return;
    }
    el.innerHTML = issues
      .map(
        (i) => `
        <div class="repo-item" data-number="${i.number}" style="cursor:pointer">
          <div>
            <div class="repo-item__name">#${i.number} ${esc(i.title)}</div>
            <div class="repo-item__meta">${esc(i.user || '')} · ${t(i.comments === 1 ? 'comment_count_one' : 'comment_count_other', { n: i.comments })}${i.labels.length ? ' · ' + i.labels.map(esc).join(', ') : ''}</div>
          </div>
          <span class="repo-item__vis">${i.state}</span>
        </div>`
      )
      .join('');
    el.querySelectorAll('[data-number]').forEach((row) => row.addEventListener('click', () => showIssueDetail(row.dataset.number)));
  } catch (err) {
    el.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

async function showIssueDetail(number) {
  const panel = document.getElementById('issueDetailPanel');
  panel.classList.remove('hidden');
  panel.innerHTML = `<p class="muted">${t('loading')}</p>`;
  try {
    const issue = await api(`/github/repos/${current.owner}/${current.repo}/issues/${number}`);
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <h2>#${issue.number} ${esc(issue.title)}</h2>
        <button id="issueToggleBtn" class="btn btn--sm ${issue.state === 'open' ? 'btn--danger' : ''}">${issue.state === 'open' ? t('close_issue') : t('reopen_issue')}</button>
      </div>
      <p class="muted">${esc(issue.user || '')} · ${new Date(issue.created_at).toLocaleString()}</p>
      <p style="white-space:pre-wrap">${esc(issue.body || t('no_description'))}</p>
      <h2 style="margin-top:18px">${t('comments_title')}</h2>
      <div id="issueComments">${
        issue.comments
          .map(
            (c) => `
        <div class="panel" style="margin-bottom:8px">
          <p class="muted" style="margin:0 0 6px">${esc(c.user || '')} · ${new Date(c.created_at).toLocaleString()}</p>
          <p style="white-space:pre-wrap;margin:0">${esc(c.body)}</p>
        </div>`
          )
          .join('') || `<p class="muted">${t('no_comments_yet')}</p>`
      }</div>
      <label class="field-label" for="newCommentBody">${t('add_comment_label')}</label>
      <textarea id="newCommentBody" class="text-input" rows="3" style="resize:vertical"></textarea>
      <div class="modal__actions" style="justify-content:flex-start;margin-top:10px">
        <button id="postCommentBtn" class="btn btn--primary btn--sm">${t('comment_btn')}</button>
      </div>
    `;

    document.getElementById('issueToggleBtn').addEventListener('click', async () => {
      const newState = issue.state === 'open' ? 'closed' : 'open';
      try {
        await api(`/github/repos/${current.owner}/${current.repo}/issues/${number}`, {
          method: 'PATCH',
          body: JSON.stringify({ state: newState }),
        });
        showIssueDetail(number);
        loadIssuesTab();
      } catch (err) {
        alert(t('action_failed', { msg: err.message }));
      }
    });

    document.getElementById('postCommentBtn').addEventListener('click', async () => {
      const body = document.getElementById('newCommentBody').value.trim();
      if (!body) return;
      try {
        await api(`/github/repos/${current.owner}/${current.repo}/issues/${number}/comments`, {
          method: 'POST',
          body: JSON.stringify({ body }),
        });
        showIssueDetail(number);
      } catch (err) {
        alert(t('failed_post_comment', { msg: err.message }));
      }
    });
  } catch (err) {
    panel.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

document.getElementById('newIssueBtn').addEventListener('click', () => {
  document.getElementById('newIssueRepoRow').classList.add('hidden'); // repo is already known (this page's repo) — no picker needed
  document.getElementById('newIssueModal').classList.remove('hidden');
});
document.getElementById('newIssueCancelBtn').addEventListener('click', () => {
  document.getElementById('newIssueModal').classList.add('hidden');
});
document.getElementById('newIssueConfirmBtn').addEventListener('click', async () => {
  if (!document.getElementById('newIssueRepoRow').classList.contains('hidden')) return; // dashboard variant — quickActions.js handles this case
  const title = document.getElementById('newIssueTitle').value.trim();
  const body = document.getElementById('newIssueBody').value.trim();
  if (!title) return alert(t('title_required'));
  try {
    await api(`/github/repos/${current.owner}/${current.repo}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title, body }),
    });
    document.getElementById('newIssueModal').classList.add('hidden');
    document.getElementById('newIssueTitle').value = '';
    document.getElementById('newIssueBody').value = '';
    loadIssuesTab();
  } catch (err) {
    alert(t('failed_create_issue', { msg: err.message }));
  }
});

// ================= Pull requests =================

document.querySelectorAll('#tabPanel-pulls .state-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#tabPanel-pulls .state-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
    prState = btn.dataset.state;
    loadPullsTab();
  });
});

async function loadPullsTab() {
  const el = document.getElementById('pullsList');
  el.innerHTML = `<p class="muted">${t('loading')}</p>`;
  document.getElementById('pullDetailPanel').classList.add('hidden');
  const apiState = prState === 'merged' ? 'closed' : prState;
  try {
    const { pulls } = await api(`/github/repos/${current.owner}/${current.repo}/pulls?state=${apiState}`);
    const filtered = prState === 'merged' ? pulls.filter((p) => p.merged) : prState === 'closed' ? pulls.filter((p) => !p.merged) : pulls;
    if (!filtered.length) {
      el.innerHTML = `<p class="muted">${t('no_pull_requests')}</p>`;
      return;
    }
    el.innerHTML = filtered
      .map(
        (p) => `
        <div class="repo-item" data-number="${p.number}" style="cursor:pointer">
          <div>
            <div class="repo-item__name">#${p.number} ${esc(p.title)}</div>
            <div class="repo-item__meta">${esc(p.head)} → ${esc(p.base)} · ${esc(p.user || '')}</div>
          </div>
          <span class="repo-item__vis">${p.merged ? 'merged' : p.state}</span>
        </div>`
      )
      .join('');
    el.querySelectorAll('[data-number]').forEach((row) => row.addEventListener('click', () => showPullDetail(row.dataset.number)));
  } catch (err) {
    el.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

async function showPullDetail(number) {
  const panel = document.getElementById('pullDetailPanel');
  panel.classList.remove('hidden');
  panel.innerHTML = `<p class="muted">${t('loading')}</p>`;
  try {
    const pr = await api(`/github/repos/${current.owner}/${current.repo}/pulls/${number}`);
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
        <h2>#${pr.number} ${esc(pr.title)}</h2>
        <div style="display:flex;gap:8px">
          ${!pr.merged && pr.state === 'open' ? `<button id="mergeBtn" class="btn btn--primary btn--sm">${t('merge')}</button>` : ''}
          ${!pr.merged ? `<button id="prToggleBtn" class="btn btn--sm ${pr.state === 'open' ? 'btn--danger' : ''}">${pr.state === 'open' ? t('close_pr') : t('reopen_pr')}</button>` : ''}
        </div>
      </div>
      <p class="muted">${esc(pr.head)} → ${esc(pr.base)} · ${esc(pr.user || '')} · ${new Date(pr.created_at).toLocaleString()}</p>
      <p style="white-space:pre-wrap">${esc(pr.body || t('no_description'))}</p>

      <h2 style="margin-top:18px">${t('files_changed_title', { n: pr.files.length })}</h2>
      <div class="diff">${
        pr.files
          .map((f) => `<div style="padding:6px 10px;border-bottom:2px solid var(--border)" class="mono">${esc(f.filename)} <span class="muted">(+${f.additions}/-${f.deletions})</span></div>`)
          .join('') || `<p class="muted" style="padding:8px">${t('no_files')}</p>`
      }</div>

      <h2 style="margin-top:18px">${t('commits_title', { n: pr.commits.length })}</h2>
      <div class="repo-list">${
        pr.commits
          .map((c) => `<div class="repo-item"><div class="repo-item__name">${esc((c.message || '').split('\n')[0])}</div><span class="mono repo-item__vis">${c.sha.slice(0, 7)}</span></div>`)
          .join('') || `<p class="muted">${t('no_commits')}</p>`
      }</div>

      <h2 style="margin-top:18px">${t('conversation_title')}</h2>
      <div id="pullComments">${
        pr.comments
          .map(
            (c) => `
        <div class="panel" style="margin-bottom:8px">
          <p class="muted" style="margin:0 0 6px">${esc(c.user || '')} · ${new Date(c.created_at).toLocaleString()}</p>
          <p style="white-space:pre-wrap;margin:0">${esc(c.body)}</p>
        </div>`
          )
          .join('') || `<p class="muted">${t('no_comments_yet')}</p>`
      }</div>
      <label class="field-label" for="newPRCommentBody">${t('add_comment_label')}</label>
      <textarea id="newPRCommentBody" class="text-input" rows="3" style="resize:vertical"></textarea>
      <div class="modal__actions" style="justify-content:flex-start;margin-top:10px">
        <button id="postPRCommentBtn" class="btn btn--primary btn--sm">${t('comment_btn')}</button>
      </div>
    `;

    document.getElementById('prToggleBtn')?.addEventListener('click', async () => {
      const newState = pr.state === 'open' ? 'closed' : 'open';
      try {
        await api(`/github/repos/${current.owner}/${current.repo}/pulls/${number}`, {
          method: 'PATCH',
          body: JSON.stringify({ state: newState }),
        });
        showPullDetail(number);
        loadPullsTab();
      } catch (err) {
        alert(t('action_failed', { msg: err.message }));
      }
    });

    document.getElementById('mergeBtn')?.addEventListener('click', () => {
      document.getElementById('mergePRNumber').textContent = number;
      const modal = document.getElementById('mergePRModal');
      modal.dataset.number = number;
      modal.classList.remove('hidden');
    });

    document.getElementById('postPRCommentBtn').addEventListener('click', async () => {
      const body = document.getElementById('newPRCommentBody').value.trim();
      if (!body) return;
      try {
        await api(`/github/repos/${current.owner}/${current.repo}/pulls/${number}/comments`, {
          method: 'POST',
          body: JSON.stringify({ body }),
        });
        showPullDetail(number);
      } catch (err) {
        alert(t('failed_post_comment', { msg: err.message }));
      }
    });
  } catch (err) {
    panel.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

document.getElementById('newPRBtn').addEventListener('click', () => {
  const opts = current.branches.map((b) => `<option value="${esc(b.name)}">${esc(b.name)}</option>`).join('');
  document.getElementById('newPRBase').innerHTML = opts;
  document.getElementById('newPRHead').innerHTML = opts;
  document.getElementById('newPRModal').classList.remove('hidden');
});
document.getElementById('newPRCancelBtn').addEventListener('click', () => {
  document.getElementById('newPRModal').classList.add('hidden');
});
document.getElementById('newPRConfirmBtn').addEventListener('click', async () => {
  const title = document.getElementById('newPRTitle').value.trim();
  const body = document.getElementById('newPRBody').value.trim();
  const base = document.getElementById('newPRBase').value;
  const head = document.getElementById('newPRHead').value;
  if (!title) return alert(t('title_required'));
  if (base === head) return alert(t('base_compare_differ'));
  try {
    await api(`/github/repos/${current.owner}/${current.repo}/pulls`, {
      method: 'POST',
      body: JSON.stringify({ title, body, base, head }),
    });
    document.getElementById('newPRModal').classList.add('hidden');
    loadPullsTab();
  } catch (err) {
    alert(t('failed_create_pr', { msg: err.message }));
  }
});

document.getElementById('mergePRCancelBtn').addEventListener('click', () => {
  document.getElementById('mergePRModal').classList.add('hidden');
});
document.getElementById('mergePRConfirmBtn').addEventListener('click', async () => {
  const number = document.getElementById('mergePRModal').dataset.number;
  try {
    await api(`/github/repos/${current.owner}/${current.repo}/pulls/${number}/merge`, {
      method: 'PUT',
      body: JSON.stringify({}),
    });
    document.getElementById('mergePRModal').classList.add('hidden');
    showPullDetail(number);
    loadPullsTab();
  } catch (err) {
    alert(t('merge_failed', { msg: err.message }));
  }
});

// ================= Actions =================

const STATUS_LABEL = {
  queued: t('status_queued'),
  in_progress: t('status_running'),
  completed: t('status_completed'),
};

async function loadActionsTab() {
  const wfEl = document.getElementById('workflowsList');
  const runsEl = document.getElementById('runsList');
  wfEl.innerHTML = `<p class="muted">${t('loading')}</p>`;
  runsEl.innerHTML = '';

  try {
    const { workflows } = await api(`/github/repos/${current.owner}/${current.repo}/actions/workflows`);
    wfEl.innerHTML = workflows.length
      ? workflows
          .map(
            (w) => `
        <div class="repo-item">
          <div>
            <div class="repo-item__name">${esc(w.name)}</div>
            <div class="repo-item__meta">${esc(w.path)}</div>
          </div>
          <span class="repo-item__vis">${esc(w.state)}</span>
        </div>`
          )
          .join('')
      : `<p class="muted">${t('no_workflows')}</p>`;
  } catch (err) {
    wfEl.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    return; // no point trying runs if workflows failed (usually same permission issue)
  }

  runsEl.innerHTML = `<p class="muted">${t('loading')}</p>`;
  try {
    const { runs } = await api(`/github/repos/${current.owner}/${current.repo}/actions/runs`);
    if (!runs.length) {
      runsEl.innerHTML = `<p class="muted">${t('no_workflow_runs')}</p>`;
      return;
    }
    runsEl.innerHTML = runs
      .map((r) => {
        const statusText = r.status === 'completed' ? r.conclusion || 'completed' : STATUS_LABEL[r.status] || r.status;
        const canCancel = r.status === 'queued' || r.status === 'in_progress';
        const canRetry = r.status === 'completed';
        return `
        <div class="repo-item">
          <div>
            <div class="repo-item__name">${esc(r.name || 'workflow')} <span class="muted">on ${esc(r.branch || '')}</span></div>
            <div class="repo-item__meta">${esc(statusText)} · ${new Date(r.created_at).toLocaleString()} · <a href="${esc(r.html_url)}" target="_blank" rel="noopener">${t('view_on_github')}</a></div>
          </div>
          <div style="display:flex;gap:6px">
            ${canRetry ? `<button class="btn btn--sm" data-retry="${r.id}">${t('rerun_btn')}</button>` : ''}
            ${canCancel ? `<button class="btn btn--sm btn--danger" data-cancel="${r.id}">${t('cancel_btn')}</button>` : ''}
          </div>
        </div>`;
      })
      .join('');

    runsEl.querySelectorAll('[data-retry]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          await api(`/github/repos/${current.owner}/${current.repo}/actions/runs/${btn.dataset.retry}/retry`, { method: 'POST' });
          loadActionsTab();
        } catch (err) {
          alert(t('failed_rerun', { msg: err.message }));
        }
      })
    );
    runsEl.querySelectorAll('[data-cancel]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm(t('cancel_run_confirm'))) return;
        try {
          await api(`/github/repos/${current.owner}/${current.repo}/actions/runs/${btn.dataset.cancel}/cancel`, { method: 'POST' });
          loadActionsTab();
        } catch (err) {
          alert(t('failed_cancel_run', { msg: err.message }));
        }
      })
    );
  } catch (err) {
    runsEl.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

// Note (honest limitation): run logs are viewed via the "View on GitHub"
// link rather than fetched and rendered inline. GitHub's log-download
// endpoint returns a redirect to a signed, time-limited zip URL rather
// than plain text, and reliably following that through the installation
// token in every octokit version isn't something I could verify without
// live testing here — linking out to GitHub's own log viewer is the
// honest, always-correct fallback rather than a flaky reimplementation.

// ================= Releases =================

async function loadReleasesTab() {
  const el = document.getElementById('releasesList');
  el.innerHTML = `<p class="muted">${t('loading')}</p>`;
  try {
    const { releases } = await api(`/github/repos/${current.owner}/${current.repo}/releases`);
    if (!releases.length) {
      el.innerHTML = `<p class="muted">${t('no_releases_yet')}</p>`;
      return;
    }
    el.innerHTML = releases
      .map(
        (r) => `
        <div class="repo-item">
          <div>
            <div class="repo-item__name">${esc(r.name || r.tag_name)} <span class="mono muted">${esc(r.tag_name)}</span> ${r.prerelease ? `<span class="tag">${t('prerelease_tag')}</span>` : ''}</div>
            <div class="repo-item__meta">${new Date(r.created_at).toLocaleDateString()} · <a href="${esc(r.html_url)}" target="_blank" rel="noopener">${t('view_on_github')}</a></div>
          </div>
          <button class="btn btn--sm btn--danger" data-release="${r.id}">${t('delete')}</button>
        </div>`
      )
      .join('');

    el.querySelectorAll('[data-release]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm(t('delete_release_confirm'))) return;
        try {
          await api(`/github/repos/${current.owner}/${current.repo}/releases/${btn.dataset.release}`, { method: 'DELETE' });
          loadReleasesTab();
        } catch (err) {
          alert(t('failed_delete_release', { msg: err.message }));
        }
      })
    );
  } catch (err) {
    el.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

document.getElementById('createReleaseBtn').addEventListener('click', async () => {
  const tag_name = document.getElementById('newReleaseTag').value.trim();
  const name = document.getElementById('newReleaseTitle').value.trim();
  const body = document.getElementById('newReleaseBody').value.trim();
  const prerelease = document.getElementById('newReleasePrerelease').checked;
  if (!tag_name) return alert(t('tag_required'));

  try {
    await api(`/github/repos/${current.owner}/${current.repo}/releases`, {
      method: 'POST',
      body: JSON.stringify({ tag_name, name, body, prerelease }),
    });
    document.getElementById('newReleaseTag').value = '';
    document.getElementById('newReleaseTitle').value = '';
    document.getElementById('newReleaseBody').value = '';
    document.getElementById('newReleasePrerelease').checked = false;
    loadReleasesTab();
  } catch (err) {
    alert(t('failed_create_release', { msg: err.message }));
  }
});
