const API_BASE = '/api';

let supabaseClient = null;
let session = null;
let currentRole = null;
let pendingImageUrl = null;

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

  currentRole = profile.role;
  const badge = document.getElementById('role-badge');
  badge.textContent = profile.role.toUpperCase();
  badge.className = `role-badge role-${profile.role}`;

  const teamPanel = document.getElementById('team-panel');
  teamPanel.classList.toggle('hidden', profile.role !== 'owner');
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

    const me = await authedFetch(`${API_BASE}/auth/me`);
    showDashboard(me);
    await loadAllData();
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
    } else if (err.status >= 500 || err.status === undefined) {
      // Server lagi gangguan sesaat / jaringan bermasalah — JANGAN logout,
      // supaya kalau di-retry, sesi yang sudah didapat tetap kepakai.
      msg = 'Server sedang gangguan sesaat. Coba tekan Masuk sekali lagi.';
    }

    showLogin(msg);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Masuk';
  }
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
    const me = await authedFetch(`${API_BASE}/auth/me`);
    showDashboard(me);
    await loadAllData();
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      // Sesi memang tidak valid / role tidak cukup — logout beneran.
      await supabaseClient.auth.signOut();
      session = null;
      showLogin(err.status === 403 ? 'Akun ini bukan admin atau owner.' : '');
      return;
    }
    // Server gangguan sesaat — sesi Supabase-nya masih valid, jangan logout.
    // Coba tampilkan dashboard kosong + biarkan user refresh manual.
    showLogin('Server sedang gangguan sesaat. Muat ulang halaman untuk coba lagi.');
    showLogin();
  }
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
    await authedFetch(`${API_BASE}/banner/${id}`, { method: 'DELETE' });
    await loadBannerAdmin();
  }

  if (e.target.classList.contains('toggle-banner')) {
    const isActive = row.querySelector('.admin-row-tag').textContent.trim() === 'Aktif';
    await authedFetch(`${API_BASE}/banner/${id}`, {
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
    await authedFetch(`${API_BASE}/categories/${row.dataset.id}`, { method: 'DELETE' });
    await loadCategoriesAdmin();
  }
});

// ---------- Upload gambar produk (Cloudinary, signed upload) ----------
async function uploadProductImage(file) {
  const statusEl = document.getElementById('product-image-status');
  statusEl.textContent = 'Mengunggah ke Cloudinary...';

  const ticket = await authedFetch(`${API_BASE}/upload-signature`, {
    method: 'POST',
    body: JSON.stringify({ folder: 'ex-school/products' }),
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
    statusEl.textContent = 'Mengunggah...';

    try {
      pendingImageUrl = await uploadProductImage(file);
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
    await authedFetch(`${API_BASE}/products/${id}`, { method: 'DELETE' });
    await loadProductsAdmin();
  }

  if (e.target.classList.contains('toggle-product')) {
    const isActive = row.querySelector('.admin-row-tag').textContent.trim() === 'Aktif';
    await authedFetch(`${API_BASE}/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: !isActive }),
    });
    await loadProductsAdmin();
  }
});

// ---------- Manajemen Tim (khusus owner) ----------
async function loadTeamAdmin() {
  if (currentRole !== 'owner') return;

  const { data } = await authedFetch(`${API_BASE}/admin/users`);
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
    await authedFetch(`${API_BASE}/admin/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    });
    await loadTeamAdmin();
  } catch (err) {
    alert(err.message);
    await loadTeamAdmin();
  }
});

// ---------- Load semua data dashboard ----------
async function loadAllData() {
  await loadCategoriesAdmin(); // duluan, karena dropdown produk butuh ini
  await Promise.all([loadBannerAdmin(), loadProductsAdmin(), loadTeamAdmin()]);
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
  initProductImageInput();

  await checkExistingSession();
});
