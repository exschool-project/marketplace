const API_BASE = '/api';

let supabaseClient = null;
let session = null;
let currentRole = null;
let pendingImageUrl = null;

const ROLE_LEVEL = { member: 1, admin: 2, owner: 3 };

// Normalisasi role di sisi client juga (samakan dengan server) — kalau
// tidak, role yang formatnya tak terduga (mis. "Admin" dengan huruf besar)
// akan bikin ROLE_LEVEL[...] jadi undefined, dan "undefined < 2" itu SELALU
// false di JS — jadi malah lolos padahal harusnya ditolak. Bug keamanan
// kecil, ditemukan waktu audit ulang.
function clientRoleLevel(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return ROLE_LEVEL[normalized] || 0;
}

// Ambil profil user yang sedang login, lalu pastikan role-nya cukup
// (admin/owner) untuk buka panel ini. Pengecekan role dilakukan di sini
// (client) karena endpoint /api/auth/profile sengaja dibuat terbuka untuk
// semua akun (dipakai bareng akun.html) — supaya jumlah Vercel Functions
// tetap hemat. Penegakan yang sesungguhnya tetap ada di server, di setiap
// endpoint yang mengubah data (requireAdmin/requireOwner).
async function fetchProfileAndEnforceRole() {
  const profile = await authedFetch(`${API_BASE}/auth/profile`);
  if (clientRoleLevel(profile.role) < ROLE_LEVEL.admin) {
    const err = new Error('Akun ini tidak memiliki akses yang cukup.');
    err.status = 403;
    throw err;
  }
  return profile;
}

// ---------- Util ----------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

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
    err.status = res.status; // dipakai buat bedain "sesi habis" vs "server lagi gangguan"
    throw err;
  }
  return body;
}

// ---------- View switching ----------
function showLogin(message = '') {
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('dashboard-view').classList.add('hidden');
  const errEl = document.getElementById('login-error');
  errEl.textContent = message;
  errEl.style.display = message ? 'block' : 'none';
}

function showDashboard(profile) {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('dashboard-view').classList.remove('hidden');
  document.getElementById('admin-name').textContent = profile.full_name || profile.email;

  const normalizedRole = String(profile.role || '').trim().toLowerCase();
  currentRole = normalizedRole;
  const badge = document.getElementById('role-badge');
  badge.textContent = normalizedRole.toUpperCase();
  badge.className = `role-badge role-${normalizedRole}`;

  const teamPanel = document.getElementById('team-panel');
  teamPanel.classList.toggle('hidden', normalizedRole !== 'owner');

  const socialPanel = document.getElementById('social-panel');
  socialPanel.classList.toggle('hidden', normalizedRole !== 'owner');

  const heroBannerPanel = document.getElementById('hero-banner-panel');
  heroBannerPanel.classList.toggle('hidden', normalizedRole !== 'owner');
}

// ---------- Init Supabase (hanya dipakai untuk proses login) ----------
async function initSupabase() {
  const res = await fetch(`${API_BASE}/config`);
  const config = await res.json();
  if (!res.ok) throw new Error(config.error || 'Gagal memuat konfigurasi.');
  supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
}

// ---------- Login / logout ----------
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Memproses...';

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    session = data.session;

    const me = await fetchProfileAndEnforceRole();
    showDashboard(me);
  } catch (err) {
    let msg = err.message;

    if (err.status === 403) {
      // Login berhasil, tapi role-nya bukan admin/owner — memang harus logout.
      await supabaseClient.auth.signOut();
      session = null;
      msg = 'Login berhasil, tapi akun ini bukan admin atau owner.';
    } else if (err.status === 401) {
      // Sesi ditolak server — logout supaya bisa login ulang dari awal.
      await supabaseClient.auth.signOut();
      session = null;
    } else if (err.status >= 500) {
      // Server error — JANGAN logout (sesi masih valid), tapi tampilkan
      // pesan ASLI dari server (bukan diganti teks generik) supaya
      // penyebabnya jelas — biasanya env var Supabase/Cloudinary belum
      // di-set di project Vercel ini.
      msg = `${err.message} (Sesi kamu masih tersimpan, coba tekan Masuk lagi setelah diperbaiki.)`;
    } else if (err.status === undefined) {
      // Tidak ada status sama sekali → kemungkinan gagal konek ke server
      // (jaringan/CORS), bukan error yang dibalikin server kita.
      msg = 'Gagal menghubungi server. Cek koneksi internet, lalu coba lagi.';
    }

    showLogin(msg);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Masuk';
    return;
  }

  submitBtn.disabled = false;
  submitBtn.textContent = 'Masuk';

  // PENTING: load data dashboard di LUAR try/catch auth di atas. Kalau salah
  // satu panggilan di sini gagal (mis. cold-start function lambat sesaat),
  // JANGAN dianggap sebagai kegagalan login — dashboard tetap tampil, cuma
  // kasih tahu bagian mana yang gagal dimuat lewat notifDashboardError, dan
  // tombol "Muat ulang" muncul untuk coba lagi tanpa perlu login ulang.
  await safeLoadAllData();
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  session = null;
  showLogin();
}

async function checkExistingSession() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session) {
    showLogin();
    return;
  }
  session = data.session;
  try {
    const me = await fetchProfileAndEnforceRole();
    showDashboard(me);
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      // Sesi memang tidak valid / role tidak cukup — logout beneran.
      await supabaseClient.auth.signOut();
      session = null;
      showLogin(err.status === 403 ? 'Akun ini bukan admin atau owner.' : '');
      return;
    }
    // Server gangguan / error — sesi Supabase-nya masih valid, jangan logout.
    // Tampilkan pesan asli dari server biar penyebabnya jelas.
    showLogin(err.message || 'Gagal menghubungi server. Muat ulang halaman untuk coba lagi.');
    return;
  }

  // Di LUAR try/catch auth — lihat penjelasan di safeLoadAllData().
  await safeLoadAllData();
}

// ---------- Banner ----------
async function loadBannerAdmin() {
  const { data } = await authedFetch(`${API_BASE}/banner`);
  const list = document.getElementById('banner-list');
  list.innerHTML = data.map((b) => `
    <div class="admin-row" data-id="${b.id}">
      <span class="admin-row-text">${escapeHtml(b.message)}</span>
      <span class="admin-row-tag">${b.is_active ? 'Aktif' : 'Nonaktif'}</span>
      <button class="mini-btn toggle-banner" type="button">${b.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
      <button class="mini-btn danger delete-banner" type="button">Hapus</button>
    </div>
  `).join('') || '<p class="empty-msg">Belum ada pesan banner.</p>';

  const statEl = document.getElementById('stat-banners');
  if (statEl) statEl.textContent = data.filter((b) => b.is_active).length;
}

async function handleBannerSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('banner-input');
  const message = input.value.trim();
  if (!message) return;
  await authedFetch(`${API_BASE}/banner`, { method: 'POST', body: JSON.stringify({ message }) });
  input.value = '';
  await loadBannerAdmin();
}

document.getElementById('banner-list')?.addEventListener('click', async (e) => {
  const row = e.target.closest('.admin-row');
  if (!row) return;
  const id = row.dataset.id;

  if (e.target.classList.contains('delete-banner')) {
    if (!confirm('Hapus pesan banner ini?')) return;
    await authedFetch(`${API_BASE}/banner?id=${id}`, { method: 'DELETE' });
    await loadBannerAdmin();
  }

  if (e.target.classList.contains('toggle-banner')) {
    const isActive = row.querySelector('.admin-row-tag').textContent.trim() === 'Aktif';
    await authedFetch(`${API_BASE}/banner?id=${id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: !isActive }),
    });
    await loadBannerAdmin();
  }
});

// ---------- Kategori ----------
async function loadCategoriesAdmin() {
  const { data } = await authedFetch(`${API_BASE}/categories`);

  const list = document.getElementById('category-list');
  list.innerHTML = data.map((c) => `
    <div class="admin-row" data-id="${c.id}">
      <span class="admin-row-text">${escapeHtml(c.name)} <span class="admin-row-sub">/${escapeHtml(c.slug)}</span></span>
      <button class="mini-btn danger delete-category" type="button">Hapus</button>
    </div>
  `).join('') || '<p class="empty-msg">Belum ada kategori.</p>';

  const select = document.getElementById('product-category');
  if (select) {
    select.innerHTML = '<option value="">Tanpa kategori</option>' +
      data.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  }

  const statEl = document.getElementById('stat-categories');
  if (statEl) statEl.textContent = data.length;
}

async function handleCategorySubmit(e) {
  e.preventDefault();
  const input = document.getElementById('category-input');
  const name = input.value.trim();
  if (!name) return;
  await authedFetch(`${API_BASE}/categories`, {
    method: 'POST',
    body: JSON.stringify({ name, slug: slugify(name) }),
  });
  input.value = '';
  await loadCategoriesAdmin();
}

document.getElementById('category-list')?.addEventListener('click', async (e) => {
  const row = e.target.closest('.admin-row');
  if (!row) return;
  if (e.target.classList.contains('delete-category')) {
    if (!confirm('Hapus kategori ini? Produk terkait tidak ikut terhapus.')) return;
    await authedFetch(`${API_BASE}/categories?id=${row.dataset.id}`, { method: 'DELETE' });
    await loadCategoriesAdmin();
  }
});

// ---------- Upload gambar (Cloudinary, signed upload) — dipakai bersama
// oleh form produk dan form banner gambar ----------
async function uploadImageToCloudinary(file, folder, statusEl) {
  if (statusEl) statusEl.textContent = 'Mengunggah ke Cloudinary...';

  const ticket = await authedFetch(`${API_BASE}/upload-signature`, {
    method: 'POST',
    body: JSON.stringify({ folder }),
  });

  const form = new FormData();
  form.append('file', file);
  form.append('api_key', ticket.apiKey);
  form.append('timestamp', ticket.timestamp);
  form.append('signature', ticket.signature);
  form.append('folder', ticket.folder);

  const res = await fetch(ticket.uploadUrl, { method: 'POST', body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message || 'Upload ke Cloudinary gagal.');

  return body.secure_url;
}

function initProductImageInput() {
  const input = document.getElementById('product-image');
  const previewWrap = document.getElementById('product-image-preview');
  const previewImg = document.getElementById('product-image-preview-img');
  const statusEl = document.getElementById('product-image-status');

  input?.addEventListener('change', async () => {
    const file = input.files?.[0];
    pendingImageUrl = null;
    if (!file) {
      previewWrap.classList.add('hidden');
      return;
    }

    previewWrap.classList.remove('hidden');
    previewImg.src = URL.createObjectURL(file);

    try {
      pendingImageUrl = await uploadImageToCloudinary(file, 'ex-school/products', statusEl);
      statusEl.textContent = 'Berhasil diunggah ✓';
    } catch (err) {
      statusEl.textContent = `Gagal: ${err.message}`;
      pendingImageUrl = null;
    }
  });
}

// ---------- Produk ----------
async function loadProductsAdmin() {
  const { data } = await authedFetch(`${API_BASE}/products`);
  const list = document.getElementById('product-list');
  list.innerHTML = data.map((p) => `
    <div class="admin-row" data-id="${p.id}">
      ${p.image_url ? `<img class="admin-row-thumb" src="${escapeHtml(p.image_url)}" alt="">` : ''}
      <span class="admin-row-text">${p.image_url ? '' : escapeHtml(p.icon || '📦') + ' '}${escapeHtml(p.name)} — Rp${Number(p.price).toLocaleString('id-ID')}</span>
      <span class="admin-row-tag">${p.is_active ? 'Aktif' : 'Nonaktif'}</span>
      ${p.is_featured ? '<span class="role-badge role-owner">POPULER</span>' : ''}
      <button class="mini-btn toggle-featured">${p.is_featured ? 'Batal Populer' : 'Jadikan Populer'}</button>
      <button class="mini-btn toggle-product" type="button">${p.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
      <button class="mini-btn danger delete-product" type="button">Hapus</button>
    </div>
  `).join('') || '<p class="empty-msg">Belum ada produk.</p>';

  const statEl = document.getElementById('stat-products');
  if (statEl) statEl.textContent = data.length;
}

async function handleProductSubmit(e) {
  e.preventDefault();
  const form = e.target;

  const name = form.querySelector('#product-name').value.trim();
  const shopName = form.querySelector('#product-shop').value.trim();
  const price = form.querySelector('#product-price').value;

  if (!name || !shopName || !price) {
    alert('Nama produk, toko, dan harga wajib diisi.');
    return;
  }

  const payload = {
    name,
    shop_name: shopName,
    price: Number(price),
    old_price: form.querySelector('#product-old-price').value
      ? Number(form.querySelector('#product-old-price').value)
      : null,
    icon: form.querySelector('#product-icon').value.trim() || '📦',
    image_url: pendingImageUrl || null,
    category_id: form.querySelector('#product-category').value || null,
    badge: form.querySelector('#product-badge').value.trim() || null,
    is_featured: form.querySelector('#product-featured').checked,
  };

  await authedFetch(`${API_BASE}/products`, { method: 'POST', body: JSON.stringify(payload) });
  form.reset();
  pendingImageUrl = null;
  document.getElementById('product-image-preview').classList.add('hidden');
  await loadProductsAdmin();
}

document.getElementById('product-list')?.addEventListener('click', async (e) => {
  const row = e.target.closest('.admin-row');
  if (!row) return;
  const id = row.dataset.id;

  if (e.target.classList.contains('delete-product')) {
    if (!confirm('Hapus produk ini?')) return;
    await authedFetch(`${API_BASE}/products?id=${id}`, { method: 'DELETE' });
    await loadProductsAdmin();
  }

  if (e.target.classList.contains('toggle-product')) {
    const isActive = row.querySelector('.admin-row-tag').textContent.trim() === 'Aktif';
    await authedFetch(`${API_BASE}/products?id=${id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: !isActive }),
    });
    await loadProductsAdmin();
  }

  if (e.target.classList.contains('toggle-featured')) {
    const isFeatured = e.target.textContent.trim() === 'Batal Populer';
    await authedFetch(`${API_BASE}/products?id=${id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_featured: !isFeatured }),
    });
    await loadProductsAdmin();
  }
});

// ---------- Manajemen Tim (khusus owner) ----------
async function loadTeamAdmin() {
  if (currentRole !== 'owner') return;

  const { data } = await authedFetch(`${API_BASE}/admin-users`);
  const list = document.getElementById('team-list');

  list.innerHTML = data.map((u) => `
    <div class="admin-row" data-id="${u.id}">
      <span class="admin-row-text">
        ${escapeHtml(u.full_name || u.email || 'Tanpa nama')}
        <span class="admin-row-sub">${escapeHtml(u.email || '')}${u.is_self ? ' (kamu)' : ''}</span>
      </span>
      <span class="role-badge role-${u.role}">${u.role.toUpperCase()}</span>
      <select class="team-row-select" ${u.is_self && u.role === 'owner' ? 'disabled' : ''}>
        <option value="member" ${u.role === 'member' ? 'selected' : ''}>Member</option>
        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
        <option value="owner" ${u.role === 'owner' ? 'selected' : ''}>Owner</option>
      </select>
    </div>
  `).join('') || '<p class="empty-msg">Belum ada akun.</p>';
}

document.getElementById('team-list')?.addEventListener('change', async (e) => {
  const select = e.target.closest('.team-row-select');
  if (!select) return;
  const row = select.closest('.admin-row');
  const id = row.dataset.id;
  const role = select.value;

  try {
    await authedFetch(`${API_BASE}/admin-users?id=${id}`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    });
    await loadTeamAdmin();
  } catch (err) {
    alert(err.message);
    await loadTeamAdmin();
  }
});

// ---------- Media Sosial (khusus owner) ----------
async function loadSocialAdmin() {
  if (currentRole !== 'owner') return;

  const { data } = await authedFetch(`${API_BASE}/social-links`);
  const list = document.getElementById('social-list');

  list.innerHTML = data.map((s) => `
    <div class="admin-row" data-id="${s.id}">
      <span class="admin-row-text">
        ${escapeHtml(s.platform)}
        <span class="admin-row-sub">${escapeHtml(s.url)}</span>
      </span>
      <span class="admin-row-tag">${s.is_active ? 'Aktif' : 'Nonaktif'}</span>
      <button class="mini-btn toggle-social" type="button">${s.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
      <button class="mini-btn danger delete-social" type="button">Hapus</button>
    </div>
  `).join('') || '<p class="empty-msg">Belum ada link media sosial.</p>';
}

async function handleSocialSubmit(e) {
  e.preventDefault();
  const platformInput = document.getElementById('social-platform');
  const urlInput = document.getElementById('social-url');
  const platform = platformInput.value.trim();
  const url = urlInput.value.trim();
  if (!platform || !url) return;

  await authedFetch(`${API_BASE}/social-links`, {
    method: 'POST',
    body: JSON.stringify({ platform, url }),
  });
  platformInput.value = '';
  urlInput.value = '';
  await loadSocialAdmin();
}

document.getElementById('social-list')?.addEventListener('click', async (e) => {
  const row = e.target.closest('.admin-row');
  if (!row) return;
  const id = row.dataset.id;

  if (e.target.classList.contains('delete-social')) {
    if (!confirm('Hapus link media sosial ini?')) return;
    await authedFetch(`${API_BASE}/social-links?id=${id}`, { method: 'DELETE' });
    await loadSocialAdmin();
  }

  if (e.target.classList.contains('toggle-social')) {
    const isActive = row.querySelector('.admin-row-tag').textContent.trim() === 'Aktif';
    await authedFetch(`${API_BASE}/social-links?id=${id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: !isActive }),
    });
    await loadSocialAdmin();
  }
});

// ---------- Banner Gambar (khusus owner) ----------
let pendingHeroBannerUrl = null;

function initHeroBannerImageInput() {
  const input = document.getElementById('hero-banner-image');
  const previewWrap = document.getElementById('hero-banner-preview');
  const previewImg = document.getElementById('hero-banner-preview-img');
  const statusEl = document.getElementById('hero-banner-status');

  input?.addEventListener('change', async () => {
    const file = input.files?.[0];
    pendingHeroBannerUrl = null;
    if (!file) {
      previewWrap.classList.add('hidden');
      return;
    }

    previewWrap.classList.remove('hidden');
    previewImg.src = URL.createObjectURL(file);

    try {
      pendingHeroBannerUrl = await uploadImageToCloudinary(file, 'ex-school/hero-banners', statusEl);
      statusEl.textContent = 'Berhasil diunggah ✓';
    } catch (err) {
      statusEl.textContent = `Gagal: ${err.message}`;
      pendingHeroBannerUrl = null;
    }
  });
}

async function loadHeroBannerAdmin() {
  if (currentRole !== 'owner') return;

  const { data } = await authedFetch(`${API_BASE}/hero-banners`);
  const list = document.getElementById('hero-banner-list');

  list.innerHTML = data.map((b) => `
    <div class="admin-row" data-id="${b.id}">
      <img class="admin-row-thumb" src="${escapeHtml(b.image_url)}" alt="">
      <span class="admin-row-text">
        ${b.title ? escapeHtml(b.title) : '<span class="admin-row-sub">Tanpa judul</span>'}
        ${b.link_url ? `· ${escapeHtml(b.link_url)}` : ''}
      </span>
      <span class="admin-row-tag">${b.is_active ? 'Aktif' : 'Nonaktif'}</span>
      <button class="mini-btn toggle-hero-banner" type="button">${b.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
      <button class="mini-btn danger delete-hero-banner" type="button">Hapus</button>
    </div>
  `).join('') || '<p class="empty-msg">Belum ada banner gambar.</p>';
}

async function handleHeroBannerSubmit(e) {
  e.preventDefault();

  if (!pendingHeroBannerUrl) {
    alert('Tunggu gambar selesai diunggah dulu (atau pilih gambar).');
    return;
  }

  const linkInput = document.getElementById('hero-banner-link');
  const titleInput = document.getElementById('hero-banner-title');
  const subtitleInput = document.getElementById('hero-banner-subtitle');
  await authedFetch(`${API_BASE}/hero-banners`, {
    method: 'POST',
    body: JSON.stringify({
      image_url: pendingHeroBannerUrl,
      link_url: linkInput.value.trim() || null,
      title: titleInput.value.trim() || null,
      subtitle: subtitleInput.value.trim() || null,
    }),
  });

  document.getElementById('hero-banner-form').reset();
  pendingHeroBannerUrl = null;
  document.getElementById('hero-banner-preview').classList.add('hidden');
  await loadHeroBannerAdmin();
}

document.getElementById('hero-banner-list')?.addEventListener('click', async (e) => {
  const row = e.target.closest('.admin-row');
  if (!row) return;
  const id = row.dataset.id;

  if (e.target.classList.contains('delete-hero-banner')) {
    if (!confirm('Hapus banner gambar ini?')) return;
    await authedFetch(`${API_BASE}/hero-banners?id=${id}`, { method: 'DELETE' });
    await loadHeroBannerAdmin();
  }

  if (e.target.classList.contains('toggle-hero-banner')) {
    const isActive = row.querySelector('.admin-row-tag').textContent.trim() === 'Aktif';
    await authedFetch(`${API_BASE}/hero-banners?id=${id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: !isActive }),
    });
    await loadHeroBannerAdmin();
  }
});

// ---------- Load semua data dashboard ----------
async function loadAllData() {
  await loadCategoriesAdmin(); // duluan, karena dropdown produk butuh ini
  await Promise.all([loadBannerAdmin(), loadProductsAdmin(), loadTeamAdmin(), loadSocialAdmin(), loadHeroBannerAdmin()]);
}

// Versi "aman" dari loadAllData(): kalau gagal (mis. cold-start function
// lambat sesaat), TIDAK melempar balik ke login — dashboard tetap tampil,
// cuma dikasih notifikasi + tombol coba lagi. Ini yang jadi akar kenapa
// dulu sering "kelihatan login tapi langsung mental balik ke halaman
// login": loadAllData() dulu dipanggil di dalam try/catch yang sama
// dengan pengecekan auth, jadi kegagalan MUAT DATA disalahartikan sebagai
// kegagalan LOGIN.
async function safeLoadAllData() {
  const errEl = document.getElementById('dashboard-load-error');
  try {
    await loadAllData();
    if (errEl) errEl.classList.add('hidden');
  } catch (err) {
    console.error('[dashboard] gagal memuat data:', err);
    if (errEl) {
      errEl.textContent = `Sebagian data gagal dimuat: ${err.message || 'tidak diketahui'}. `;
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'mini-btn';
      retryBtn.textContent = 'Muat ulang';
      retryBtn.addEventListener('click', () => safeLoadAllData());
      errEl.appendChild(retryBtn);
      errEl.classList.remove('hidden');
    }
  }
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initSupabase();
  } catch (err) {
    showLogin(err.message);
    return;
  }

  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('banner-form').addEventListener('submit', handleBannerSubmit);
  document.getElementById('category-form').addEventListener('submit', handleCategorySubmit);
  document.getElementById('product-form').addEventListener('submit', handleProductSubmit);
  document.getElementById('social-form').addEventListener('submit', handleSocialSubmit);
  document.getElementById('hero-banner-form').addEventListener('submit', handleHeroBannerSubmit);
  initProductImageInput();
  initHeroBannerImageInput();

  await checkExistingSession();

  // Poin F dari audit: kalau user logout lalu pencet tombol Back browser,
  // halaman bisa ke-restore dari bfcache (menampilkan dashboard versi lama
  // tanpa re-run JS). Listener ini re-cek sesi tiap kali halaman muncul
  // lagi dari bfcache, supaya dashboard tidak nyangkut kebuka.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) checkExistingSession();
  });
});
