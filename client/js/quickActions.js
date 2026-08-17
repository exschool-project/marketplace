// Wires up the 4 dashboard quick-action buttons (previously dead —
// data-action attributes with no listener anywhere). "Upload Project" is
// a trivial hash nav; the other three open small modals.
import { api } from './app.js';
import { t } from './i18n.js';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function openModal(el) { el.classList.remove('hidden'); }
function closeModal(el) { el.classList.add('hidden'); }

let cachedRepos = null;
async function loadRepoOptions() {
  if (cachedRepos) return cachedRepos;
  const { repositories } = await api('/github/repos?per_page=100');
  cachedRepos = repositories;
  return repositories;
}

// ---------------- New Repository ----------------

const newRepoModal = document.getElementById('newRepoModal');
const newRepoName = document.getElementById('newRepoName');
const newRepoDesc = document.getElementById('newRepoDesc');
const newRepoError = document.getElementById('newRepoError');
const newRepoConfirmBtn = document.getElementById('newRepoConfirmBtn');

document.getElementById('newRepoCancelBtn').addEventListener('click', () => closeModal(newRepoModal));

newRepoConfirmBtn.addEventListener('click', async () => {
  const name = newRepoName.value.trim();
  if (!name) return;
  const isPrivate = document.querySelector('input[name="newRepoVisibility"]:checked').value === 'private';

  newRepoError.classList.add('hidden');
  newRepoConfirmBtn.disabled = true;
  try {
    const repo = await api('/github/repos', {
      method: 'POST',
      body: JSON.stringify({ name, description: newRepoDesc.value.trim(), private: isPrivate }),
    });
    cachedRepos = null; // invalidate — new repo exists now
    closeModal(newRepoModal);
    window.location.hash = `#/repo/${repo.full_name}`;
  } catch (err) {
    newRepoError.textContent = err.data?.error || err.message;
    newRepoError.classList.remove('hidden');
  } finally {
    newRepoConfirmBtn.disabled = false;
  }
});

// ---------------- Open Repository ----------------

const openRepoModal = document.getElementById('openRepoModal');
const openRepoSelect = document.getElementById('openRepoSelect');

document.getElementById('openRepoCancelBtn').addEventListener('click', () => closeModal(openRepoModal));
document.getElementById('openRepoConfirmBtn').addEventListener('click', () => {
  const fullName = openRepoSelect.value;
  if (!fullName) return;
  closeModal(openRepoModal);
  window.location.hash = `#/repo/${fullName}`;
});

// ---------------- Create Issue (dashboard variant) ----------------
// The repo-detail page's "New issue" button already opens #newIssueModal
// with a repo already in context (see repoTabs.js). From the dashboard
// there's no current repo, so this shows an extra repo-picker row on the
// same modal — repoTabs.js hides that row when it's the one opening it.

const newIssueModal = document.getElementById('newIssueModal');
const newIssueRepoRow = document.getElementById('newIssueRepoRow');
const newIssueRepoSelect = document.getElementById('newIssueRepoSelect');
const newIssueTitle = document.getElementById('newIssueTitle');
const newIssueBody = document.getElementById('newIssueBody');
const newIssueConfirmBtn = document.getElementById('newIssueConfirmBtn');

document.getElementById('newIssueCancelBtn').addEventListener('click', () => closeModal(newIssueModal));

async function openDashboardIssueModal() {
  newIssueRepoRow.classList.remove('hidden');
  newIssueTitle.value = '';
  newIssueBody.value = '';
  newIssueRepoSelect.innerHTML = `<option>${t('loading')}</option>`;
  openModal(newIssueModal);
  try {
    const repos = await loadRepoOptions();
    newIssueRepoSelect.innerHTML = repos.map((r) => `<option value="${esc(r.full_name)}">${esc(r.full_name)}</option>`).join('');
  } catch (err) {
    newIssueRepoSelect.innerHTML = `<option>${esc(err.message)}</option>`;
  }
}

// repoTabs.js owns the "confirm" click when opened from a repo page (it
// binds its own handler and reads its own repo context). When opened
// from the dashboard, the repo picker row is visible, so this handler
// takes over just for that case.
newIssueConfirmBtn.addEventListener('click', async () => {
  if (newIssueRepoRow.classList.contains('hidden')) return; // repoTabs.js handles this case
  const fullName = newIssueRepoSelect.value;
  const title = newIssueTitle.value.trim();
  if (!fullName || !title) return;
  const [owner, repo] = fullName.split('/');

  newIssueConfirmBtn.disabled = true;
  try {
    await api(`/github/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title, body: newIssueBody.value.trim() }),
    });
    closeModal(newIssueModal);
    window.location.hash = `#/repo/${fullName}`;
  } catch (err) {
    alert(`${t('qa_new_issue')}: ${err.message}`);
  } finally {
    newIssueConfirmBtn.disabled = false;
  }
});

// ---------------- Dashboard button wiring ----------------

document.querySelectorAll('.qa-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const action = btn.dataset.action;
    if (action === 'upload') {
      window.location.hash = '#/upload';
    } else if (action === 'deploy-vercel') {
      window.location.hash = '#/vercel/deploy';
    } else if (action === 'new-repo') {
      newRepoName.value = '';
      newRepoDesc.value = '';
      newRepoError.classList.add('hidden');
      openModal(newRepoModal);
    } else if (action === 'open-repo') {
      openRepoSelect.innerHTML = `<option>${t('loading')}</option>`;
      openModal(openRepoModal);
      try {
        const repos = await loadRepoOptions();
        openRepoSelect.innerHTML = repos.map((r) => `<option value="${esc(r.full_name)}">${esc(r.full_name)}</option>`).join('');
      } catch (err) {
        openRepoSelect.innerHTML = `<option>${esc(err.message)}</option>`;
      }
    } else if (action === 'new-issue') {
      openDashboardIssueModal();
    }
  });
});
