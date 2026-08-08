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
  if (!res.ok) throw new Error(body.error || 'Terjadi kesalahan.');
  return body;
}

async function initSupabase() {
  const res = await fetch(`${API_BASE}/config`);
  const config = await res.json();
  if (!res.ok) throw new Error(config.error || 'Gagal memuat konfigurasi.');
  supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
}

// ---------- Tab switching (login / daftar) ----------
function initTabs() {
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
  });

  tabRegister.addEventListener('click', () => {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    registerForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
  });
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

  const badge = document.getElementById('profile-role-badge');
  const roleLabel = { owner: 'OWNER', admin: 'ADMIN', member: 'MEMBER' }[profile.role] || profile.role.toUpperCase();
  badge.textContent = roleLabel;
  badge.className = `role-badge role-${profile.role}`;

  const adminLinkWrap = document.getElementById('profile-admin-link');
  const canSeeAdminPanel = profile.role === 'admin' || profile.role === 'owner';
  adminLinkWrap.classList.toggle('hidden', !canSeeAdminPanel);
}

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

// ---------- Register ----------
async function handleRegister(e) {
  e.preventDefault();
  const full_name = document.getElementById('register-name').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  const errEl = document.getElementById('register-error');
  const okEl = document.getElementById('register-success');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  errEl.style.display = 'none';
  okEl.style.display = 'none';
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

    okEl.textContent = 'Akun berhasil dibuat! Silakan masuk lewat tab Masuk.';
    okEl.style.display = 'block';
    e.target.reset();
    setTimeout(() => document.getElementById('tab-login').click(), 1200);
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
    await supabaseClient.auth.signOut();
    session = null;
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

  initTabs();
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('register-form').addEventListener('submit', handleRegister);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  await checkExistingSession();
});
