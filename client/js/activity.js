import { api, onRoute } from './app.js';
import { t } from './i18n.js';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const STATUS_COLOR = { success: '', failed: 'tag--danger', pending: '', processing: '', cancelled: '' };

async function loadUploadHistory() {
  const el = document.getElementById('uploadHistoryList');
  el.innerHTML = `<p class="muted">${t('loading')}</p>`;
  try {
    const { jobs } = await api('/uploads');
    if (!jobs.length) {
      el.innerHTML = `<p class="muted">${t('no_uploads_yet')}</p>`;
      return;
    }
    el.innerHTML = jobs
      .map(
        (j) => `
      <div class="repo-item">
        <div>
          <div class="repo-item__name">${j.repository_owner ? esc(`${j.repository_owner}/${j.repository_name}`) : t('not_committed')}</div>
          <div class="repo-item__meta">${t('files_count', { n: j.file_count })} · ${new Date(j.created_at).toLocaleString()}${j.commit_sha ? ' · ' + esc(j.commit_sha.slice(0, 7)) : ''}</div>
        </div>
        <span class="repo-item__vis ${j.status === 'failed' ? 'tag--danger' : ''}">${esc(j.status)}</span>
      </div>`
      )
      .join('');
  } catch (err) {
    el.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

function actionLabel(action) {
  const map = {
    login: 'act_login',
    file_create: 'act_file_create',
    file_update: 'act_file_update',
    file_delete: 'act_file_delete',
    branch_delete: 'act_branch_delete',
    upload_commit: 'act_upload_commit',
    issue_create: 'act_issue_create',
    issue_close: 'act_issue_close',
    issue_reopen: 'act_issue_reopen',
    issue_edit: 'act_issue_edit',
    pr_create: 'act_pr_create',
    pr_merge: 'act_pr_merge',
    workflow_rerun: 'act_workflow_rerun',
    workflow_cancel: 'act_workflow_cancel',
    release_create: 'act_release_create',
    release_delete: 'act_release_delete',
  };
  return map[action] ? t(map[action]) : action;
}

async function loadActivity() {
  const el = document.getElementById('activityList');
  el.innerHTML = `<p class="muted">${t('loading')}</p>`;
  try {
    const { events } = await api('/activity');
    if (!events.length) {
      el.innerHTML = `<p class="muted">${t('no_activity_yet')}</p>`;
      return;
    }
    el.innerHTML = events
      .map(
        (e) => `
      <div class="repo-item">
        <div>
          <div class="repo-item__name">${esc(actionLabel(e.action))}</div>
          <div class="repo-item__meta">${e.resource_id ? esc(e.resource_id) + ' · ' : ''}${new Date(e.created_at).toLocaleString()}</div>
        </div>
        <span class="repo-item__vis ${e.status === 'failed' || e.status === 'success_no_installation' ? 'tag--danger' : ''}">${esc(e.status)}</span>
      </div>`
      )
      .join('');
  } catch (err) {
    el.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

onRoute('activity', () => {
  loadUploadHistory();
  loadActivity();
});
