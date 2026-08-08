const API_BASE = '/api';

let supabaseClient = null;
let session = null;

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
  if (!res.ok) throw new Error(body.error || 'Terjadi kesalahan.');
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
    await supabaseClient.auth.signOut();
    session = null;
    const msg = err.message === 'Akun ini tidak memiliki akses admin.'
      ? 'Login berhasil, tapi akun ini bukan admin.'
      : err.message;
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
    await supabaseClient.auth.signOut();
    session = null;
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

// ---------- Produk ----------
async function loadProductsAdmin() {
  const { data } = await authedFetch(`${API_BASE}/products`);
  const list = document.getElementById('product-list');
  list.innerHTML = data.map((p) => `
    <div class="admin-row" data-id="${p.id}">
      <span class="admin-row-text">${escapeHtml(p.icon || '📦')} ${escapeHtml(p.name)} — Rp${Number(p.price).toLocaleString('id-ID')}</span>
      <span class="admin-row-tag">${p.is_active ? 'Aktif' : 'Nonaktif'}</span>
      <button class="mini-btn toggle-product" type="button">${p.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
      <button class="mini-btn danger delete-product" type="button">Hapus</button>
    </div>
  `).join('') || '<p class="empty-msg">Belum ada produk.</p>';
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
    category_id: form.querySelector('#product-category').value || null,
    badge: form.querySelector('#product-badge').value.trim() || null,
  };

  await authedFetch(`${API_BASE}/products`, { method: 'POST', body: JSON.stringify(payload) });
  form.reset();
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

// ---------- Load semua data dashboard ----------
async function loadAllData() {
  await loadCategoriesAdmin(); // duluan, karena dropdown produk butuh ini
  await Promise.all([loadBannerAdmin(), loadProductsAdmin()]);
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

  await checkExistingSession();
});
