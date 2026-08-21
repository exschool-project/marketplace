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

  // Isi form "Ubah profil" dengan data terbaru.
  document.getElementById('profile-edit-name').value = profile.full_name || '';
  document.getElementById('profile-edit-email').value = profile.email || '';
  document.getElementById('profile-edit-phone').value = profile.phone || '';
  document.getElementById('profile-edit-other-contact').value = profile.other_contact || '';
  document.getElementById('profile-edit-error').style.display = 'none';
  document.getElementById('profile-edit-success').style.display = 'none';
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

// ---------- Ubah profil (nama, email, kontak opsional) ----------
async function handleProfileEdit(e) {
  e.preventDefault();
  const full_name = document.getElementById('profile-edit-name').value.trim();
  const email = document.getElementById('profile-edit-email').value.trim();
  const phone = document.getElementById('profile-edit-phone').value.trim();
  const other_contact = document.getElementById('profile-edit-other-contact').value.trim();
  const errEl = document.getElementById('profile-edit-error');
  const successEl = document.getElementById('profile-edit-success');
  const submitBtn = e.target.querySelector('button[type="submit"]');

  errEl.style.display = 'none';
  successEl.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Menyimpan...';

  try {
    const updated = await authedFetch(`${API_BASE}/auth/profile`, {
      method: 'PATCH',
      body: JSON.stringify({ full_name, email, phone, other_contact }),
    });

    // Kalau email diganti, token sesi lama masih bawa klaim email lama —
    // refresh sesi biar sinkron. Kalau gagal, tetap aman: data di server
    // sudah benar, cuma tampilan sesi lokal yang mungkin butuh login ulang.
    if (updated.email_changed) {
      try {
        const { data } = await supabaseClient.auth.refreshSession();
        if (data?.session) session = data.session;
      } catch (refreshErr) {
        // biarkan, bukan error fatal
      }
    }

    showProfile(updated);
    if (!updated.contact_saved) {
      successEl.textContent = 'Nama & email tersimpan. Kontak opsional belum bisa disimpan (migrasi database belum dijalankan) — cek ADD_PROFILE_CONTACT.sql.';
      successEl.style.color = '#8a5a00';
    } else {
      successEl.textContent = updated.email_changed
        ? 'Profil tersimpan. Email login kamu sudah diperbarui.'
        : 'Profil tersimpan.';
      successEl.style.color = '#1a7d3a';
    }
    successEl.style.display = 'block';
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Simpan Perubahan';
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
  document.getElementById('profile-edit-form').addEventListener('submit', handleProfileEdit);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  await checkExistingSession();
});
