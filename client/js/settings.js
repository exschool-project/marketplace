import { api, onRoute } from './app.js';
import { t } from './i18n.js';

const els = {
  branch: document.getElementById('settingsDefaultBranch'),
  message: document.getElementById('settingsCommitMessage'),
  saveBtn: document.getElementById('saveSettingsBtn'),
  saved: document.getElementById('settingsSaved'),
  connectionModeText: document.getElementById('connectionModeText'),
  reconnectBtn: document.getElementById('reconnectGithubBtn'),
  revokeVercelBtn: document.getElementById('securityRevokeVercelBtn'),
  signOutBtn: document.getElementById('securitySignOutBtn'),
};

let loaded = false;

async function loadSettings() {
  try {
    const data = await api('/settings');
    els.branch.value = data.default_branch || '';
    els.message.value = data.default_commit_message || '';
  } catch {
    // Non-fatal — inputs just stay at their placeholder defaults.
  }

  try {
    const { github_auth_mode } = await api('/auth/me');
    els.connectionModeText.textContent =
      github_auth_mode === 'oauth'
        ? t('connection_mode_quick')
        : github_auth_mode === 'github_app'
          ? t('connection_mode_developer')
          : t('connection_mode_none');
  } catch {
    els.connectionModeText.textContent = t('connection_mode_none');
  }
}

els.reconnectBtn.addEventListener('click', () => {
  window.location.hash = '#/connect';
});

// Security panel — reuses the same endpoints as the Vercel tab's disconnect
// button and the topbar's sign-out button, just surfaced in one place.
els.revokeVercelBtn.addEventListener('click', async () => {
  if (!confirm(t('security_revoke_vercel'))) return;
  els.revokeVercelBtn.disabled = true;
  try {
    await api('/vercel/connect', { method: 'DELETE' });
  } catch (err) {
    alert(err.message || 'Failed to remove token.');
  } finally {
    els.revokeVercelBtn.disabled = false;
  }
});

els.signOutBtn.addEventListener('click', async () => {
  if (!confirm(t('security_disconnect_github'))) return;
  try {
    await api('/auth/logout', { method: 'POST' });
  } finally {
    window.location.href = '/';
  }
});

els.saveBtn.addEventListener('click', async () => {
  els.saved.classList.add('hidden');
  els.saveBtn.disabled = true;
  try {
    await api('/settings', {
      method: 'PUT',
      body: JSON.stringify({
        default_branch: els.branch.value.trim(),
        default_commit_message: els.message.value.trim(),
      }),
    });
    els.saved.classList.remove('hidden');
    setTimeout(() => els.saved.classList.add('hidden'), 2500);
  } catch (err) {
    alert(`Failed to save settings: ${err.message}`);
  } finally {
    els.saveBtn.disabled = false;
  }
});

onRoute('settings', () => {
  if (!loaded) {
    loaded = true;
    loadSettings();
  }
});
