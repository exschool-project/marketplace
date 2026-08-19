const API_BASE = '/api';

let supabaseClient = null;
let session = null;

async function authedFetch(url, options = {}) {
  const token = session?.access_token;
  const headers = Object.assign(
    { 'Content-Type': 'application/json' },
    options.headers,
    token ? { Authorization: `Bearer ${token}` } : {}
  );
  const res = await fetch(url, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || 'Terjadi kesalahan.');
    err.status = res.status;
    throw err;
  }
  return body;
}

async function initSupabase() {
  const res = await fetch(`${API_BASE}/config`);
  const config = await res.json();
  if (!res.ok) throw new Error(config.error || 'Gagal memuat konfigurasi.');
  supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
}

// ---------- View switching ----------
function showAuth() {
  document.getElementById('auth-view').classList.remove('hidden');
  document.getElementById('profile-view').classList.add('hidden');
}

function showProfile(profile) {
  document.getElementById('auth-view').classList.add('hidden');
  document.getElementById('profile-view').classList.remove('hidden');
  document.getElementById('profile-name').textContent = `Halo, ${profile.full_name || 'kamu'}!`;
  document.getElementById('profile-email').textContent = profile.email;

  const normalizedRole = String(profile.role || '').trim().toLowerCase();

  const badge = document.getElementById('profile-role-badge');
  const roleLabel = { owner: 'OWNER', admin: 'ADMIN', cs: 'CS', member: 'MEMBER' }[normalizedRole] || normalizedRole.toUpperCase();
  badge.textContent = roleLabel;
  badge.className = `role-badge role-${normalizedRole}`;

  const adminLinkWrap = document.getElementById('profile-admin-link');
  const canSeeAdminPanel = normalizedRole === 'admin' || normalizedRole === 'owner';
  adminLinkWrap.classList.toggle('hidden', !canSeeAdminPanel);

  const csLinkWrap = document.getElementById('profile-cs-link');
  const canSeeCsPanel = normalizedRole === 'cs' || normalizedRole === 'admin' || normalizedRole === 'owner';
  csLinkWrap.classList.toggle('hidden', !canSeeCsPanel);
}

// ---------- Tab Masuk / Daftar ----------
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
}

document.querySelectorAll('.auth-tab').forEach((btn) => {
  btn.addEventListener('click', () => switchAuthTab(btn.dataset.tab));
});

// ---------- Login ----------
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  errEl.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Memproses...';

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Email atau kata sandi salah.');
    session = data.session;
    const profile = await authedFetch(`${API_BASE}/auth/profile`);
    showProfile(profile);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Masuk';
  }
}

// ---------- Daftar ----------
async function handleRegister(e) {
  e.preventDefault();
  const full_name = document.getElementById('register-name').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  const errEl = document.getElementById('register-error');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  errEl.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Memproses...';

  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name, email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Gagal mendaftar.');

    // Daftar berhasil -> langsung login otomatis biar gak perlu isi form lagi.
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      // Akun berhasil dibuat tapi auto-login gagal — arahkan ke tab Masuk saja.
      switchAuthTab('login');
      document.getElementById('login-email').value = email;
      const loginErr = document.getElementById('login-error');
      loginErr.textContent = 'Akun berhasil dibuat! Silakan masuk pakai email & kata sandi kamu.';
      loginErr.style.display = 'block';
      return;
    }
    session = data.session;
    const profile = await authedFetch(`${API_BASE}/auth/profile`);
    showProfile(profile);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Daftar';
  }
}

// ---------- Logout ----------
async function handleLogout() {
  await supabaseClient.auth.signOut();
  session = null;
  showAuth();
}

// ---------- Init ----------
async function checkExistingSession() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session) {
    showAuth();
    return;
  }
  session = data.session;
  try {
    const profile = await authedFetch(`${API_BASE}/auth/profile`);
    showProfile(profile);
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      // Sesi memang tidak valid — logout beneran, kembali ke form login.
      await supabaseClient.auth.signOut();
      session = null;
      showAuth();
      return;
    }
    // Server gangguan / error — sesi Supabase-nya masih valid, jangan logout
    // paksa. Tampilkan pesan ASLI dari server (bukan teks generik) di form
    // login supaya kelihatan jelas ini bukan "belum pernah login".
    const errEl = document.getElementById('login-error');
    errEl.textContent = `Gagal memuat profil: ${err.message || 'server tidak merespons'}. Sesi kamu masih tersimpan, coba muat ulang halaman.`;
    errEl.style.display = 'block';
    showAuth();
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initSupabase();
  } catch (err) {
    const errEl = document.getElementById('login-error');
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    return;
  }

  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('register-form').addEventListener('submit', handleRegister);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  await checkExistingSession();
});
