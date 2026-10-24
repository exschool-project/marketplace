const API_BASE = '/api';

let supabaseClient = null;
let session = null;
let currentRole = null;
let pendingImageUrl = null;

const ROLE_LEVEL = { member: 1, cs: 2, admin: 3, owner: 4 };

// ---------- Cache profil (anti-kedip login pas pindah halaman) ----------
// Disimpan di sessionStorage (bukan localStorage) -> otomatis hilang kalau
// tab/browser ditutup. Key sama kayak cs.js & akun.js, biar login sekali
// langsung kerasa instan di halaman panel lain dalam tab yang sama.
const PROFILE_CACHE_KEY = 'exschool_profile_cache';
function cacheProfile(profile) {
  try { sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile)); } catch (e) { /* abaikan */ }
}
function clearCachedProfile() {
  try { sessionStorage.removeItem(PROFILE_CACHE_KEY); } catch (e) { /* abaikan */ }
}

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
  cacheProfile(profile); // buat instan pas pindah ke cs.html/akun.html nanti
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

  // Semua elemen "khusus owner" — baik panelnya sendiri MAUPUN link-nya
  // di sidebar (.admin-nav-link + grup labelnya) — ditandain class
  // "owner-only" yang sama, jadi cukup satu toggle buat keduanya
  // sekaligus. Ini yang bikin tampilan "wajib sesuai role": role selain
  // owner nggak akan pernah lihat menu ATAU link menuju ke situ sama
  // sekali, bukan cuma kontennya aja yang disembunyikan.
  const isOwner = normalizedRole === 'owner';
  document.querySelectorAll('.owner-only').forEach((el) => {
    el.classList.toggle('hidden', !isOwner);
  });

  seedListSkeletons();
  initSidebarScrollSpy();
}

// ---------- Router halaman panel ----------
// Tiap menu sidebar = satu halaman sendiri (hanya satu yang tampil sekaligus),
// dialamatkan lewat hash URL (mis. admin.html#products-panel) jadi tombol
// back/refresh browser tetap kembali ke halaman yang sama. Halaman khusus
// owner otomatis ditolak untuk role lain dan dialihkan ke Ringkasan —
// ini cuma urusan tampilan; penegakan sebenarnya tetap di server.
const PAGE_TITLES = {
  'overview': 'Ringkasan',
  'orders-panel': 'Pesanan & Chat',
  'banner-panel': 'Banner Berjalan',
  'categories-panel': 'Kategori',
  'products-panel': 'Produk',
  'options-panel': 'Pilihan & Harga',
  'testimonials-panel': 'Testimoni',
  'hero-banner-panel': 'Banner Gambar / Video',
  'social-panel': 'Media Sosial',
  'team-panel': 'Manajemen Tim',
};
const ROLE_DESC = {
  owner: 'Owner — akses penuh: konten toko, pesanan, banner utama, media sosial, dan manajemen tim.',
  admin: 'Admin — kelola pesanan, produk, kategori, testimoni, dan banner berjalan. Pengaturan banner utama, media sosial, dan tim khusus Owner.',
};

function currentPageId() {
  const id = decodeURIComponent((location.hash || '').replace(/^#/, ''));
  const el = id && document.getElementById(id);
  const allowed = el && el.classList.contains('admin-page') && !el.classList.contains('hidden');
  return allowed ? id : 'overview';
}

function renderPage() {
  const active = currentPageId();
  document.querySelectorAll('.admin-page').forEach((el) => {
    el.classList.toggle('page-off', el.id !== active);
  });
  document.querySelectorAll('.admin-nav-link').forEach((link) => {
    link.classList.toggle('active', link.getAttribute('href') === `#${active}`);
  });
  const roleDesc = document.getElementById('overview-role-desc');
  if (roleDesc) roleDesc.textContent = ROLE_DESC[currentRole] || '';
  if (location.hash && location.hash !== `#${active}`) history.replaceState(null, '', `#${active}`);
  document.querySelector('.admin-content')?.scrollIntoView({ block: 'start' });
  window.scrollTo({ top: 0 });
}

let pageRouterReady = false;
function initSidebarScrollSpy() { // nama lama dipertahankan; sekarang = router
  renderPage();
  if (pageRouterReady) return;
  pageRouterReady = true;
  window.addEventListener('hashchange', renderPage);
}

// Taruh shimmer placeholder di semua daftar SEBELUM data aslinya kejawab
// dari server — biar begitu dashboard kebuka langsung kelihatan "lagi
// dimuat", bukan kosong melompong nunggu beberapa saat.
function seedListSkeletons() {
  const listIds = [
    'order-list', 'banner-list', 'category-list', 'product-list',
    'testimonial-list', 'hero-banner-list', 'social-list', 'team-list',
  ];
  listIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.children.length) {
      el.innerHTML = Array.from({ length: 3 }, () => '<div class="row-skeleton"></div>').join('');
    }
  });
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
  clearCachedProfile();
  if (orderListPollTimer) clearInterval(orderListPollTimer);
  showLogin();
}

async function checkExistingSession() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session) {
    clearCachedProfile();
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
      clearCachedProfile();
      showLogin(err.status === 403 ? 'Akun ini bukan admin atau owner.' : '');
      return;
    }
    // Server gangguan / error — sesi Supabase-nya masih valid, jangan logout.
    // Kalau dashboard udah sempat tampil dari cache, biarkan tetap tampil
    // (jangan malah lempar balik ke layar login gara-gara gangguan sesaat).
    if (!window.__cachedProfile) {
      showLogin(err.message || 'Gagal menghubungi server. Muat ulang halaman untuk coba lagi.');
    }
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
  try {
    await authedFetch(`${API_BASE}/banner`, { method: 'POST', body: JSON.stringify({ message }) });
    input.value = '';
    await loadBannerAdmin();
  } catch (err) {
    alert(`Gagal menambah pesan banner: ${err.message}`);
  }
}

document.getElementById('banner-list')?.addEventListener('click', async (e) => {
  const row = e.target.closest('.admin-row');
  if (!row) return;
  const id = row.dataset.id;

  try {
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
  } catch (err) {
    alert(`Gagal memperbarui banner: ${err.message}`);
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
  try {
    await authedFetch(`${API_BASE}/categories`, {
      method: 'POST',
      body: JSON.stringify({ name, slug: slugify(name) }),
    });
    input.value = '';
    await loadCategoriesAdmin();
  } catch (err) {
    alert(`Gagal menambah kategori: ${err.message}`);
  }
}

document.getElementById('category-list')?.addEventListener('click', async (e) => {
  const row = e.target.closest('.admin-row');
  if (!row) return;
  if (e.target.classList.contains('delete-category')) {
    if (!confirm('Hapus kategori ini? Produk terkait tidak ikut terhapus.')) return;
    try {
      await authedFetch(`${API_BASE}/categories?id=${row.dataset.id}`, { method: 'DELETE' });
      await loadCategoriesAdmin();
    } catch (err) {
      alert(`Gagal menghapus kategori: ${err.message}`);
    }
  }
});

// ---------- Upload gambar (Cloudinary, signed upload) — dipakai bersama
// oleh form produk dan form banner gambar ----------
const MAX_VIDEO_SECONDS = 60;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // batas upload Cloudinary paket gratis

// Baca durasi video di browser sebelum diunggah (banner video maks 1 menit).
function getVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    const src = URL.createObjectURL(file);
    v.preload = 'metadata';
    v.onloadedmetadata = () => { URL.revokeObjectURL(src); resolve(v.duration); };
    v.onerror = () => { URL.revokeObjectURL(src); reject(new Error('Video tidak bisa dibaca. Pakai format MP4/WebM.')); };
    v.src = src;
  });
}

async function uploadImageToCloudinary(file, folder, statusEl) {
  const isVideo = file.type.startsWith('video/');
  if (isVideo) {
    if (file.size > MAX_VIDEO_BYTES) throw new Error('Ukuran video maksimal 100 MB.');
    const secs = await getVideoDuration(file);
    if (!Number.isFinite(secs) || secs > MAX_VIDEO_SECONDS + 0.5) {
      throw new Error(`Durasi video maksimal ${MAX_VIDEO_SECONDS} detik (video ini ${Math.round(secs)} detik).`);
    }
  }
  if (statusEl) statusEl.textContent = isVideo ? 'Mengunggah video ke Cloudinary (bisa agak lama)...' : 'Mengunggah ke Cloudinary...';

  const ticket = await authedFetch(`${API_BASE}/upload-signature`, {
    method: 'POST',
    body: JSON.stringify({ folder, resource_type: isVideo ? 'video' : 'image' }),
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

const isVideoUrl = (u) => /\/video\/upload\//.test(String(u || '')) || /\.(mp4|webm|mov)(\?|$)/i.test(String(u || ''));

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
      statusEl.innerHTML = `Berhasil diunggah ${ICONS.check}`;
    } catch (err) {
      statusEl.textContent = `Gagal: ${err.message}`;
      pendingImageUrl = null;
    }
  });
}

// ---------- Produk ----------
let productsCache = [];

async function loadProductsAdmin() {
  const { data } = await authedFetch(`${API_BASE}/products`);
  productsCache = data;
  fillTestimonialProductSelect();
  fillOptionsProductSelect();
  const list = document.getElementById('product-list');
  list.innerHTML = data.map((p) => `
    <div class="admin-row" data-id="${p.id}">
      ${p.image_url ? `<img class="admin-row-thumb" src="${escapeHtml(p.image_url)}" alt="">` : ''}
      <span class="admin-row-text">${p.image_url ? '' : (p.icon ? escapeHtml(p.icon) + ' ' : ICONS.box + ' ')}${escapeHtml(p.name)} — Rp${Number(p.price).toLocaleString('id-ID')}</span>
      <span class="admin-row-tag">${p.is_active ? 'Aktif' : 'Nonaktif'}</span>
      ${p.is_featured ? '<span class="role-badge role-owner">POPULER</span>' : ''}
      <button class="mini-btn edit-detail" type="button">Edit Detail</button>
      <button class="mini-btn edit-options" type="button">Pilihan &amp; Harga</button>
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
    icon: form.querySelector('#product-icon').value.trim() || '',
    image_url: pendingImageUrl || null,
    category_id: form.querySelector('#product-category').value || null,
    badge: form.querySelector('#product-badge').value.trim() || null,
    is_featured: form.querySelector('#product-featured').checked,
  };

  try {
    await authedFetch(`${API_BASE}/products`, { method: 'POST', body: JSON.stringify(payload) });
    form.reset();
    pendingImageUrl = null;
    document.getElementById('product-image-preview').classList.add('hidden');
    await loadProductsAdmin();
  } catch (err) {
    alert(`Gagal menambah produk: ${err.message}`);
  }
}

document.getElementById('product-list')?.addEventListener('click', async (e) => {
  const row = e.target.closest('.admin-row');
  if (!row) return;
  const id = row.dataset.id;

  if (e.target.classList.contains('edit-options')) {
    location.hash = '#options-panel';
    const sel = document.getElementById('opt-product');
    sel.value = id;
    loadOptionsEditor(id);
    return;
  }

  if (e.target.classList.contains('edit-detail')) {
    openDetailEditor(id);
    return;
  }

  try {
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
  } catch (err) {
    alert(`Gagal memperbarui produk: ${err.message}`);
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
        <option value="cs" ${u.role === 'cs' ? 'selected' : ''}>CS</option>
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

  try {
    await authedFetch(`${API_BASE}/social-links`, {
      method: 'POST',
      body: JSON.stringify({ platform, url }),
    });
    platformInput.value = '';
    urlInput.value = '';
    await loadSocialAdmin();
  } catch (err) {
    alert(`Gagal menambah link media sosial: ${err.message}`);
  }
}

document.getElementById('social-list')?.addEventListener('click', async (e) => {
  const row = e.target.closest('.admin-row');
  if (!row) return;
  const id = row.dataset.id;

  try {
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
  } catch (err) {
    alert(`Gagal memperbarui link media sosial: ${err.message}`);
  }
});


// ---------- Editor detail produk (deskripsi, fitur, galeri, contoh, FAQ) ----------
let detailState = null; // { id, gallery: [url], showcase: [{url, caption}] }

// Saran kategori (datalist) = kategori yang sudah dipakai di produk ini
function fillCategoryList() {
  let dl = document.getElementById('pde-cat-list');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'pde-cat-list'; document.body.appendChild(dl); }
  const cats = [...new Set((detailState?.showcase || []).map((s) => (s.category || '').trim()).filter(Boolean))];
  dl.innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('');
}

function renderDetailMedia() {
  fillCategoryList();
  document.getElementById('pde-gallery').innerHTML = detailState.gallery.map((u, i) => `
    <div class="pde-thumb"><img src="${escapeHtml(u)}" alt=""><button type="button" class="pde-remove" data-kind="gallery" data-index="${i}" aria-label="Hapus">✕</button></div>
  `).join('');
  document.getElementById('pde-showcase').innerHTML = detailState.showcase.map((s, i) => `
    <div class="pde-showcase-row">
      <img src="${escapeHtml(s.url)}" alt="">
      <div class="pde-showcase-fields">
        <div class="pde-sc-pair">
          <input type="text" class="pde-sc-cat" data-index="${i}" list="pde-cat-list" value="${escapeHtml(s.category || '')}" placeholder="Kategori (mis. Logo, Website, Poster)">
          <input type="text" class="pde-sc-title" data-index="${i}" value="${escapeHtml(s.title || '')}" placeholder="Judul gambar">
        </div>
        <textarea class="pde-sc-desc" data-index="${i}" rows="3" placeholder="Deskripsi / keterangan gambar">${escapeHtml(s.description || '')}</textarea>
        <div class="pde-sc-pair">
          <input type="url" class="pde-sc-src" data-index="${i}" value="${escapeHtml(s.source_url || '')}" placeholder="Link sumber / referensi (https://...)">
          <input type="text" class="pde-sc-srclabel" data-index="${i}" value="${escapeHtml(s.source_label || '')}" placeholder="Nama sumber (opsional)">
        </div>
      </div>
      <button type="button" class="pde-remove" data-kind="showcase" data-index="${i}" aria-label="Hapus">✕</button>
    </div>
  `).join('');
}

function openDetailEditor(id) {
  const p = productsCache.find((x) => x.id === id);
  if (!p) return;
  detailState = {
    id,
    gallery: Array.isArray(p.gallery) ? [...p.gallery] : [],
    showcase: Array.isArray(p.showcase) ? p.showcase.map((s) => ({ url: s.url, title: s.title || '', description: s.description ?? s.caption ?? '', category: s.category || '', source_url: s.source_url || '', source_label: s.source_label || '' })) : [],
  };
  document.getElementById('pde-title').textContent = p.name;
  document.getElementById('pde-description').value = p.description || '';
  document.getElementById('pde-delivery').value = p.delivery_time || '';
  document.getElementById('pde-features').value = (Array.isArray(p.features) ? p.features : []).join('\n');
  document.getElementById('product-detail-form')._updateWc?.();
  document.getElementById('pde-faq').value = (Array.isArray(p.faq) ? p.faq : []).map((f) => `${f.q} | ${f.a}`).join('\n');
  document.getElementById('pde-status').textContent = '';
  document.getElementById('pde-preview').href = `produk.html?id=${encodeURIComponent(id)}`;
  document.getElementById('pde-gallery-input').value = '';
  document.getElementById('pde-showcase-input').value = '';
  renderDetailMedia();
  const form = document.getElementById('product-detail-form');
  form.classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeDetailEditor() {
  document.getElementById('product-detail-form')?.classList.add('hidden');
  detailState = null;
}

async function uploadMany(inputEl, target) {
  const files = [...(inputEl.files || [])];
  const statusEl = document.getElementById('pde-status');
  if (!files.length || !detailState) return;
  let done = 0;
  for (const file of files) {
    try {
      statusEl.textContent = `Mengunggah ${done + 1}/${files.length}...`;
      const url = await uploadImageToCloudinary(file, 'ex-school/products', null);
      if (!detailState) return; // editor ditutup selama upload
      if (target === 'gallery') detailState.gallery.push(url);
      else detailState.showcase.push({ url, title: '', description: '', category: '', source_url: '', source_label: '' });
      done += 1;
      renderDetailMedia();
    } catch (err) {
      statusEl.textContent = `Gagal mengunggah ${file.name}: ${err.message}`;
      inputEl.value = '';
      return;
    }
  }
  statusEl.textContent = `${done} gambar berhasil diunggah. Jangan lupa klik "Simpan Detail".`;
  inputEl.value = '';
}

const MAX_WORDS = 25000; // samakan dengan MAX_WORDS di api/products.js
const countWords = (t) => (String(t || '').trim().match(/\S+/g) || []).length;

function initDetailEditor() {
  const form = document.getElementById('product-detail-form');
  if (!form) return;

  // Penghitung kata langsung untuk deskripsi
  const descEl = document.getElementById('pde-description');
  const wcEl = document.getElementById('pde-wordcount');
  const updateWc = () => {
    const n = countWords(descEl.value);
    wcEl.textContent = `${n.toLocaleString('id-ID')} / ${MAX_WORDS.toLocaleString('id-ID')} kata`;
    wcEl.style.color = n > MAX_WORDS ? '#B00020' : '';
  };
  descEl.addEventListener('input', updateWc);
  form._updateWc = updateWc;

  document.getElementById('pde-gallery-input').addEventListener('change', (e) => uploadMany(e.target, 'gallery'));
  document.getElementById('pde-showcase-input').addEventListener('change', (e) => uploadMany(e.target, 'showcase'));
  document.getElementById('pde-cancel').addEventListener('click', closeDetailEditor);

  form.addEventListener('click', (e) => {
    const btn = e.target.closest('.pde-remove');
    if (!btn || !detailState) return;
    detailState[btn.dataset.kind].splice(Number(btn.dataset.index), 1);
    renderDetailMedia();
  });
  form.addEventListener('input', (e) => {
    if (!detailState) return;
    const i = Number(e.target.dataset.index);
    if (e.target.classList.contains('pde-sc-title')) detailState.showcase[i].title = e.target.value;
    if (e.target.classList.contains('pde-sc-cat')) { detailState.showcase[i].category = e.target.value; fillCategoryList(); }
    if (e.target.classList.contains('pde-sc-src')) detailState.showcase[i].source_url = e.target.value;
    if (e.target.classList.contains('pde-sc-srclabel')) detailState.showcase[i].source_label = e.target.value;
    if (e.target.classList.contains('pde-sc-desc')) detailState.showcase[i].description = e.target.value;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!detailState) return;
    const statusEl = document.getElementById('pde-status');
    const saveBtn = document.getElementById('pde-save');

    const lines = (id) => document.getElementById(id).value.split('\n').map((l) => l.trim()).filter(Boolean);
    const faq = lines('pde-faq').map((l) => {
      const i = l.indexOf('|');
      return i === -1 ? null : { q: l.slice(0, i).trim(), a: l.slice(i + 1).trim() };
    }).filter((f) => f && f.q && f.a);

    const payload = {
      description: document.getElementById('pde-description').value.trim() || null,
      delivery_time: document.getElementById('pde-delivery').value.trim() || null,
      features: lines('pde-features'),
      gallery: detailState.gallery,
      showcase: detailState.showcase.map((s) => ({ ...s, category: (s.category || '').trim(), source_url: (s.source_url || '').trim() })),
      faq,
    };

    const badSrc = detailState.showcase.find((s) => s.source_url && !/^https?:\/\//i.test(s.source_url.trim()));
    if (badSrc) {
      statusEl.textContent = 'Link sumber harus diawali http:// atau https://';
      return;
    }

    const tooLong = [['Deskripsi', payload.description], ...payload.features.map((f) => ['Poin fitur', f]),
      ...payload.faq.flatMap((f) => [['Pertanyaan FAQ', f.q], ['Jawaban FAQ', f.a]])]
      .find(([, t]) => countWords(t) > MAX_WORDS);
    if (tooLong) {
      statusEl.textContent = `${tooLong[0]} melebihi ${MAX_WORDS.toLocaleString('id-ID')} kata. Pendekkan dulu.`;
      return;
    }

    saveBtn.disabled = true;
    statusEl.textContent = 'Menyimpan...';
    try {
      await authedFetch(`${API_BASE}/products?id=${detailState.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      statusEl.textContent = 'Tersimpan ✓';
      await loadProductsAdmin();
    } catch (err) {
      statusEl.textContent = /column|schema/i.test(err.message)
        ? 'Gagal: kolom detail belum ada di database. Jalankan ADD_PRODUCT_DETAIL.sql di Supabase dulu.'
        : `Gagal menyimpan: ${err.message}`;
    } finally {
      saveBtn.disabled = false;
    }
  });
}


// ---------- Pilihan & Harga (varian produk) — halaman sendiri ----------
// Tiap pilihan = satu baris form: nama pilihan, tipe harga, nominal, habis.
//   tipe "same" = pakai harga produk (tidak naik)
//   tipe "own"  = harga sendiri (menggantikan harga produk)
//   tipe "add"  = tambahan di atas harga produk
let optState = null; // { productId, base, groups: [{ name, values: [{ label, mode, amount, sold_out }] }] }

const rupiahFull = (n) => 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID');

function fillOptionsProductSelect() {
  const sel = document.getElementById('opt-product');
  if (!sel) return;
  const keep = sel.value;
  sel.innerHTML = '<option value="">— Pilih produk —</option>' +
    productsCache.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  if (keep && productsCache.some((p) => p.id === keep)) sel.value = keep;
}

function loadOptionsEditor(productId) {
  const area = document.getElementById('opt-area');
  const p = productsCache.find((x) => x.id === productId);
  if (!p) { optState = null; area.classList.add('hidden'); return; }
  optState = {
    productId,
    base: Number(p.price),
    groups: (Array.isArray(p.options) ? p.options : []).map((g) => ({
      name: g.name || '',
      values: (g.values || []).map((v) => ({
        label: v.label || '',
        mode: v.price > 0 ? 'own' : (v.price_add > 0 ? 'add' : 'same'),
        amount: v.price > 0 ? v.price : (v.price_add > 0 ? v.price_add : ''),
        sold_out: !!v.sold_out,
      })),
    })),
  };
  document.getElementById('opt-status').textContent = '';
  document.getElementById('opt-preview').href = `beli.html?id=${encodeURIComponent(productId)}`;
  area.classList.remove('hidden');
  renderOptionsEditor();
}

function optPreviewText(v) {
  if (v.mode === 'own') return `Pembeli bayar ${rupiahFull(v.amount)}`;
  if (v.mode === 'add') return `Pembeli bayar ${rupiahFull(optState.base + (Number(v.amount) || 0))}`;
  return `Pembeli bayar ${rupiahFull(optState.base)}`;
}

function renderOptionsEditor() {
  document.getElementById('opt-base').innerHTML = `Harga produk: <strong>${rupiahFull(optState.base)}</strong>`;
  document.getElementById('opt-groups').innerHTML = optState.groups.map((g, gi) => `
    <div class="opt-group" data-g="${gi}">
      <div class="opt-group-head">
        <input type="text" class="opt-gname" data-g="${gi}" value="${escapeHtml(g.name)}" placeholder="Nama pilihan (mis. Kapasitas, Warna, Paket)">
        <button type="button" class="mini-btn danger opt-del-group" data-g="${gi}">Hapus grup</button>
      </div>
      <div class="opt-cols" aria-hidden="true"><span>Pilihan</span><span>Harga</span><span>Nominal (Rp)</span><span>Habis</span><span></span></div>
      ${g.values.map((v, vi) => `
      <div class="opt-row" data-g="${gi}" data-v="${vi}">
        <input type="text" class="opt-label" value="${escapeHtml(v.label)}" placeholder="Mis. 256GB" aria-label="Nama pilihan">
        <select class="opt-mode" aria-label="Jenis harga">
          <option value="same"${v.mode === 'same' ? ' selected' : ''}>Sama dengan harga produk</option>
          <option value="own"${v.mode === 'own' ? ' selected' : ''}>Harga sendiri</option>
          <option value="add"${v.mode === 'add' ? ' selected' : ''}>Tambahan harga</option>
        </select>
        <input type="number" class="opt-amount" min="0" step="1000" inputmode="numeric" value="${v.amount === '' ? '' : escapeHtml(v.amount)}" placeholder="${v.mode === 'add' ? 'Tambahan' : 'Harga'}" ${v.mode === 'same' ? 'disabled' : ''} aria-label="Nominal">
        <label class="opt-soldout"><input type="checkbox" class="opt-sold"${v.sold_out ? ' checked' : ''}> Habis</label>
        <button type="button" class="pde-remove opt-del-row" aria-label="Hapus pilihan">✕</button>
        <span class="opt-preview-text">${escapeHtml(optPreviewText(v))}</span>
      </div>`).join('')}
      <button type="button" class="mini-btn opt-add-row" data-g="${gi}">+ Tambah pilihan</button>
    </div>
  `).join('') || '<p class="empty-msg">Produk ini belum punya pilihan. Klik "+ Tambah grup pilihan" untuk mulai.</p>';
}

function initOptionsEditor() {
  const sel = document.getElementById('opt-product');
  const wrap = document.getElementById('opt-groups');
  if (!sel || !wrap) return;
  sel.addEventListener('change', () => loadOptionsEditor(sel.value));

  document.getElementById('opt-add-group').addEventListener('click', () => {
    if (!optState) return;
    optState.groups.push({ name: '', values: [{ label: '', mode: 'same', amount: '', sold_out: false }] });
    renderOptionsEditor();
  });

  wrap.addEventListener('click', (e) => {
    if (!optState) return;
    const g = Number(e.target.closest('[data-g]')?.dataset.g);
    if (e.target.classList.contains('opt-add-row')) {
      optState.groups[g].values.push({ label: '', mode: 'same', amount: '', sold_out: false });
      renderOptionsEditor();
    } else if (e.target.classList.contains('opt-del-row')) {
      const v = Number(e.target.closest('.opt-row').dataset.v);
      optState.groups[g].values.splice(v, 1);
      renderOptionsEditor();
    } else if (e.target.classList.contains('opt-del-group')) {
      optState.groups.splice(g, 1);
      renderOptionsEditor();
    }
  });

  const syncRow = (el) => {
    const row = el.closest('.opt-row');
    if (!row || !optState) return;
    const v = optState.groups[Number(row.dataset.g)].values[Number(row.dataset.v)];
    v.label = row.querySelector('.opt-label').value;
    v.mode = row.querySelector('.opt-mode').value;
    v.amount = row.querySelector('.opt-amount').value;
    v.sold_out = row.querySelector('.opt-sold').checked;
    const amt = row.querySelector('.opt-amount');
    amt.disabled = v.mode === 'same';
    amt.placeholder = v.mode === 'add' ? 'Tambahan' : 'Harga';
    row.querySelector('.opt-preview-text').textContent = optPreviewText(v);
  };
  wrap.addEventListener('input', (e) => {
    if (!optState) return;
    if (e.target.classList.contains('opt-gname')) {
      optState.groups[Number(e.target.dataset.g)].name = e.target.value;
    } else syncRow(e.target);
  });
  wrap.addEventListener('change', (e) => { if (e.target.classList.contains('opt-mode') || e.target.classList.contains('opt-sold')) syncRow(e.target); });

  document.getElementById('opt-save').addEventListener('click', async () => {
    if (!optState) return;
    const statusEl = document.getElementById('opt-status');
    const saveBtn = document.getElementById('opt-save');
    const fail = (msg) => { statusEl.textContent = msg; statusEl.style.color = '#B00020'; };
    statusEl.style.color = '';

    const groups = [];
    const names = new Set();
    for (const g of optState.groups) {
      const name = g.name.trim();
      const values = g.values.filter((v) => v.label.trim() || v.amount !== '');
      if (!name && !values.length) continue; // grup kosong diabaikan
      if (!name) return fail('Ada grup pilihan yang belum diberi nama.');
      if (names.has(name)) return fail(`Nama grup "${name}" dobel. Pakai nama berbeda.`);
      names.add(name);
      if (!values.length) return fail(`Grup "${name}" belum punya pilihan.`);
      const labels = new Set();
      const outValues = [];
      for (const v of values) {
        const label = v.label.trim();
        if (!label) return fail(`Ada pilihan di grup "${name}" yang belum diberi nama.`);
        if (labels.has(label)) return fail(`Pilihan "${label}" dobel di grup "${name}".`);
        labels.add(label);
        const amount = Number(v.amount) || 0;
        if (v.mode !== 'same' && amount <= 0) return fail(`Isi nominal untuk "${label}" (grup "${name}"), atau ubah jenis harganya jadi "Sama dengan harga produk".`);
        outValues.push({
          label,
          price: v.mode === 'own' ? Math.round(amount) : 0,
          price_add: v.mode === 'add' ? Math.round(amount) : 0,
          sold_out: !!v.sold_out,
        });
      }
      groups.push({ name, values: outValues });
    }
    const pricedGroups = groups.filter((g) => g.values.some((v) => v.price > 0));
    if (pricedGroups.length > 1) {
      return fail(`"Harga sendiri" hanya boleh dipakai di SATU grup (sekarang: ${pricedGroups.map((g) => g.name).join(', ')}). Di grup lain pakai "Tambahan harga" atau "Sama dengan harga produk".`);
    }

    saveBtn.disabled = true;
    statusEl.textContent = 'Menyimpan...';
    try {
      await authedFetch(`${API_BASE}/products?id=${optState.productId}`, { method: 'PUT', body: JSON.stringify({ options: groups }) });
      statusEl.textContent = 'Tersimpan ✓';
      const keepId = optState.productId;
      await loadProductsAdmin();
      document.getElementById('opt-product').value = keepId;
    } catch (err) {
      fail(/column|schema/i.test(err.message)
        ? 'Gagal: kolom pilihan belum ada di database. Jalankan ADD_PRODUCT_OPTIONS.sql di Supabase dulu.'
        : `Gagal menyimpan: ${err.message}`);
    } finally {
      saveBtn.disabled = false;
    }
  });
}

// ---------- Testimoni (admin & owner) ----------
let pendingTestimonialImage = null;

function fillTestimonialProductSelect() {
  const sel = document.getElementById('testimonial-product');
  if (!sel) return;
  const keep = sel.value;
  sel.innerHTML = '<option value="">Umum (semua produk)</option>' +
    productsCache.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  sel.value = keep;
}

function initTestimonialImageInput() {
  const input = document.getElementById('testimonial-image');
  const statusEl = document.getElementById('testimonial-image-status');
  input?.addEventListener('change', async () => {
    pendingTestimonialImage = null;
    const file = input.files?.[0];
    if (!file) { statusEl.textContent = ''; return; }
    try {
      pendingTestimonialImage = await uploadImageToCloudinary(file, 'ex-school/testimonials', statusEl);
      statusEl.textContent = 'Foto berhasil diunggah';
    } catch (err) {
      statusEl.textContent = `Gagal: ${err.message}`;
    }
  });
}

async function loadTestimonialsAdmin() {
  const { data } = await authedFetch(`${API_BASE}/testimonials`);
  const list = document.getElementById('testimonial-list');

  list.innerHTML = data.map((t) => `
    <div class="admin-row" data-id="${t.id}">
      <span class="admin-row-text">
        ${'★'.repeat(t.rating)}${'☆'.repeat(5 - t.rating)} — ${escapeHtml(t.author_name)}${t.author_role ? ` · ${escapeHtml(t.author_role)}` : ''}${t.product_id ? ` · <em>${escapeHtml((productsCache.find((p) => p.id === t.product_id) || {}).name || 'produk')}</em>` : ''}${t.image_url ? ' · foto' : ''}
        <span class="admin-row-sub">${escapeHtml(t.quote)}</span>
      </span>
      <span class="admin-row-tag">${t.is_active ? 'Aktif' : 'Nonaktif'}</span>
      <button class="mini-btn toggle-testimonial" type="button">${t.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
      <button class="mini-btn danger delete-testimonial" type="button">Hapus</button>
    </div>
  `).join('') || '<p class="empty-msg">Belum ada testimoni. Section testimoni di beranda masih disembunyikan sampai ada yang ditambahkan di sini.</p>';
}

async function handleTestimonialSubmit(e) {
  e.preventDefault();
  const nameInput = document.getElementById('testimonial-name');
  const roleInput = document.getElementById('testimonial-role');
  const ratingInput = document.getElementById('testimonial-rating');
  const quoteInput = document.getElementById('testimonial-quote');

  const author_name = nameInput.value.trim();
  const quote = quoteInput.value.trim();
  if (!author_name || !quote) return;

  try {
    await authedFetch(`${API_BASE}/testimonials`, {
      method: 'POST',
      body: JSON.stringify({
        author_name,
        author_role: roleInput.value.trim() || null,
        quote,
        rating: Number(ratingInput.value),
        product_id: document.getElementById('testimonial-product').value || null,
        image_url: pendingTestimonialImage,
      }),
    });
    pendingTestimonialImage = null;
    document.getElementById('testimonial-image').value = '';
    document.getElementById('testimonial-image-status').textContent = '';
    nameInput.value = '';
    roleInput.value = '';
    quoteInput.value = '';
    ratingInput.value = '5';
    await loadTestimonialsAdmin();
  } catch (err) {
    alert(`Gagal menambah testimoni: ${err.message}`);
  }
}

document.getElementById('testimonial-list')?.addEventListener('click', async (e) => {
  const row = e.target.closest('.admin-row');
  if (!row) return;
  const id = row.dataset.id;

  try {
    if (e.target.classList.contains('delete-testimonial')) {
      if (!confirm('Hapus testimoni ini?')) return;
      await authedFetch(`${API_BASE}/testimonials?id=${id}`, { method: 'DELETE' });
      await loadTestimonialsAdmin();
    }

    if (e.target.classList.contains('toggle-testimonial')) {
      const isActive = row.querySelector('.admin-row-tag').textContent.trim() === 'Aktif';
      await authedFetch(`${API_BASE}/testimonials?id=${id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !isActive }),
      });
      await loadTestimonialsAdmin();
    }
  } catch (err) {
    alert(`Gagal memperbarui testimoni: ${err.message}`);
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
    const previewVideo = document.getElementById('hero-banner-preview-video');
    const fileIsVideo = file.type.startsWith('video/');
    previewImg.classList.toggle('hidden', fileIsVideo);
    previewVideo.classList.toggle('hidden', !fileIsVideo);
    if (fileIsVideo) previewVideo.src = URL.createObjectURL(file);
    else previewImg.src = URL.createObjectURL(file);

    try {
      pendingHeroBannerUrl = await uploadImageToCloudinary(file, 'ex-school/hero-banners', statusEl);
      statusEl.innerHTML = `Berhasil diunggah ${ICONS.check}`;
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
      ${isVideoUrl(b.image_url)
        ? `<video class="admin-row-thumb" src="${escapeHtml(b.image_url)}" muted preload="metadata"></video>`
        : `<img class="admin-row-thumb" src="${escapeHtml(b.image_url)}" alt="">`}
      <span class="admin-row-text">
        ${isVideoUrl(b.image_url) ? '<span class="role-badge role-owner">VIDEO</span> ' : ''}${b.title ? escapeHtml(b.title) : '<span class="admin-row-sub">Tanpa judul</span>'}
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
    alert('Tunggu file selesai diunggah dulu (atau pilih gambar/video).');
    return;
  }

  const linkInput = document.getElementById('hero-banner-link');

  try {
    await authedFetch(`${API_BASE}/hero-banners`, {
      method: 'POST',
      body: JSON.stringify({
        image_url: pendingHeroBannerUrl,
        link_url: linkInput.value.trim() || null,
      }),
    });

    document.getElementById('hero-banner-form').reset();
    pendingHeroBannerUrl = null;
    document.getElementById('hero-banner-preview').classList.add('hidden');
    await loadHeroBannerAdmin();
  } catch (err) {
    alert(`Gagal menambah banner gambar: ${err.message}`);
  }
}

document.getElementById('hero-banner-list')?.addEventListener('click', async (e) => {
  const row = e.target.closest('.admin-row');
  if (!row) return;
  const id = row.dataset.id;

  try {
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
  } catch (err) {
    alert(`Gagal memperbarui banner gambar: ${err.message}`);
  }
});

// ---------- Notifikasi pesan baru (suara + browser notification) ----------
function playPing() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.16, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (err) {
    // audio diblokir browser — tidak fatal
  }
}

function notifyNewMessage(title, body) {
  playPing();
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  try {
    const n = new Notification(title, { body });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (err) {
    // tidak fatal
  }
}

function initNotifyButton() {
  const btn = document.getElementById('notif-btn');
  if (!btn) return;
  if (typeof Notification === 'undefined') {
    btn.remove();
    return;
  }
  const sync = () => {
    if (Notification.permission === 'granted') {
      btn.innerHTML = `${ICONS.bell} Notifikasi Aktif`;
      btn.disabled = true;
    } else {
      btn.innerHTML = `${ICONS.bell} Aktifkan Notifikasi`;
      btn.disabled = false;
    }
  };
  sync();
  btn.addEventListener('click', async () => {
    await Notification.requestPermission();
    sync();
  });
}

let orderListSnapshot = new Map();
let orderSnapshotReady = false;
let orderListPollTimer = null;

function detectAndNotifyOrderMessages(orders) {
  const next = new Map();
  const newItems = [];

  orders.forEach((o) => {
    next.set(o.id, { at: o.last_message_at, sender: o.last_sender_type });
    if (!orderSnapshotReady) return;
    const prev = orderListSnapshot.get(o.id);
    const changed = o.last_message_at && (!prev || prev.at !== o.last_message_at);
    if (changed && o.last_sender_type && o.last_sender_type !== 'admin') newItems.push(o);
  });

  orderListSnapshot = next;
  orderSnapshotReady = true;

  newItems.forEach((o) => {
    const preview = o.last_message && o.last_message.length > 80 ? o.last_message.slice(0, 80) + '…' : (o.last_message || '');
    notifyNewMessage(`Pesan baru — ${o.order_code}`, `${o.buyer_name}: ${preview}`);
  });
}

// ---------- Pesanan & Chat ----------
const ORDER_STATUS_LABEL = {
  menunggu: 'Menunggu Konfirmasi',
  diproses: 'Diproses',
  dikirim: 'Dikirim',
  selesai: 'Selesai',
  dibatalkan: 'Dibatalkan',
};

function formatOrderTime(iso) {
  try {
    return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    return '';
  }
}

// Pesanan dianggap "perlu dibalas" kalau masih aktif (bukan selesai/
// dibatalkan) dan pesan terakhirnya BUKAN dari admin/CS — sama
// persis kayak logika di cs.js, biar badge-nya konsisten di kedua panel.
function orderNeedsReply(o) {
  return o.status !== 'selesai' && o.status !== 'dibatalkan' && o.last_sender_type && o.last_sender_type !== 'admin';
}

// Update badge merah di tombol "CS Panel" + judul tab browser, dipanggil
// tiap kali daftar pesanan di-refresh (termasuk pas silent-poll).
function updateUnreadBadge(orders) {
  const count = orders.filter(orderNeedsReply).length;

  document.title = count > 0 ? `(${count}) Admin — EX-SCHOOL` : 'Admin — EX-SCHOOL';

  [document.getElementById('cs-panel-link'), document.querySelector('.admin-nav-link[href="#orders-panel"]')].forEach((link) => {
    if (!link) return;
    let badge = link.querySelector('.unread-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'unread-badge';
        link.appendChild(badge);
      }
      badge.textContent = count > 99 ? '99+' : String(count);
    } else if (badge) {
      badge.remove();
    }
  });
}

async function loadOrdersAdmin() {
  const statusFilter = document.getElementById('order-status-filter')?.value || '';
  const { data: allData } = await authedFetch(`${API_BASE}/orders`);
  detectAndNotifyOrderMessages(allData);
  updateUnreadBadge(allData);

  const data = statusFilter ? allData.filter((o) => o.status === statusFilter) : allData;
  const list = document.getElementById('order-list');

  list.innerHTML = data.map((o) => `
    <div class="admin-row ${orderNeedsReply(o) ? 'needs-reply' : ''}" data-id="${o.id}" data-code="${escapeHtml(o.order_code)}" data-buyer="${escapeHtml(o.buyer_name)}" data-status="${o.status}">
      <span class="admin-row-text">
        ${orderNeedsReply(o) ? '<span class="unread-dot" title="Perlu dibalas"></span>' : ''}<span class="mono">${escapeHtml(o.order_code)}</span> — ${escapeHtml(o.product_name)} · Rp${Number(o.product_price).toLocaleString('id-ID')}
        <span class="admin-row-sub">${escapeHtml(o.buyer_name)} · ${escapeHtml(o.buyer_phone)} · ${formatOrderTime(o.created_at)}</span>
      </span>
      <select class="team-row-select order-status-select">
        ${Object.entries(ORDER_STATUS_LABEL).map(([val, label]) => `<option value="${val}" ${o.status === val ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
      <button class="mini-btn open-order-chat" type="button">${ICONS.chat} Chat</button>
    </div>
  `).join('') || '<p class="empty-msg">Belum ada pesanan masuk.</p>';

  const statEl = document.getElementById('stat-orders-new');
  if (statEl) statEl.textContent = data.filter((o) => o.status === 'menunggu').length;
}

document.getElementById('order-status-filter')?.addEventListener('change', () => loadOrdersAdmin());

document.getElementById('order-list')?.addEventListener('click', async (e) => {
  const row = e.target.closest('.admin-row');
  if (!row) return;

  if (e.target.classList.contains('open-order-chat')) {
    openOrderChat(row.dataset.id, row.dataset.code, row.dataset.buyer, row.dataset.status);
  }
});

document.getElementById('order-list')?.addEventListener('change', async (e) => {
  const select = e.target.closest('.order-status-select');
  if (!select) return;
  const row = select.closest('.admin-row');
  const id = row.dataset.id;

  try {
    await authedFetch(`${API_BASE}/orders?id=${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: select.value }),
    });
    await loadOrdersAdmin();
  } catch (err) {
    alert(err.message);
    await loadOrdersAdmin();
  }
});

// ---------- Modal chat pesanan ----------
let activeChatOrderId = null;
let chatPollTimer = null;
let chatLastCount = 0;

function renderChatMessages(messages) {
  const thread = document.getElementById('oc-thread');
  if (!messages.length) {
    thread.innerHTML = '<p class="chat-empty">Belum ada percakapan.</p>';
    return;
  }
  const wasNearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;
  thread.innerHTML = messages.map((m) => `
    <div class="chat-bubble from-${m.sender_type === 'admin' ? 'buyer' : (m.sender_type === 'buyer' ? 'admin' : 'system')}">
      <span class="chat-meta">${escapeHtml(m.sender_name)} · ${formatOrderTime(m.created_at)}</span>
      ${escapeHtml(m.message)}
    </div>
  `).join('');
  if (wasNearBottom) thread.scrollTop = thread.scrollHeight;
}

async function loadOrderChatMessages() {
  if (!activeChatOrderId) return;
  try {
    const { data } = await authedFetch(`${API_BASE}/orders?resource=messages&order_id=${activeChatOrderId}`);
    if (data.length === chatLastCount) return;
    chatLastCount = data.length;
    renderChatMessages(data);
  } catch (err) {
    // diam-diam gagal, dicoba lagi di polling berikutnya
  }
}

function updateChatLockUI(status) {
  const closed = status === 'selesai' || status === 'dibatalkan';
  document.getElementById('oc-closed-banner').classList.toggle('hidden', !closed);
  document.getElementById('oc-form').classList.toggle('is-closed', closed);
}

function openOrderChat(orderId, code, buyerName, status) {
  activeChatOrderId = orderId;
  chatLastCount = 0;
  document.getElementById('oc-code').textContent = code;
  document.getElementById('oc-buyer').textContent = `Pembeli: ${buyerName}`;
  document.getElementById('oc-thread').innerHTML = '<p class="chat-empty">Memuat percakapan...</p>';
  updateChatLockUI(status);
  document.getElementById('order-chat-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  loadOrderChatMessages();
  if (chatPollTimer) clearInterval(chatPollTimer);
  chatPollTimer = setInterval(loadOrderChatMessages, 4000);
}

function closeOrderChat() {
  document.getElementById('order-chat-modal').classList.add('hidden');
  document.body.style.overflow = '';
  activeChatOrderId = null;
  if (chatPollTimer) clearInterval(chatPollTimer);
}

document.getElementById('order-chat-close')?.addEventListener('click', closeOrderChat);
document.getElementById('order-chat-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'order-chat-modal') closeOrderChat();
});

document.getElementById('oc-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeChatOrderId) return;
  if (!document.getElementById('oc-closed-banner').classList.contains('hidden')) return; // chat ditutup
  const input = document.getElementById('oc-input');
  const message = input.value.trim();
  if (!message) return;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  input.value = '';

  try {
    await authedFetch(`${API_BASE}/orders?resource=messages`, {
      method: 'POST',
      body: JSON.stringify({ order_id: activeChatOrderId, message }),
    });
    await loadOrderChatMessages();
  } catch (err) {
    alert(err.message);
    input.value = message;
  } finally {
    submitBtn.disabled = false;
    input.focus();
  }
});

// ---------- Load semua data dashboard ----------
async function loadAllData() {
  await loadCategoriesAdmin(); // duluan, karena dropdown produk butuh ini
  await Promise.all([loadBannerAdmin(), loadProductsAdmin(), loadTeamAdmin(), loadSocialAdmin(), loadHeroBannerAdmin(), loadOrdersAdmin(), loadTestimonialsAdmin()]);
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
    if (orderListPollTimer) clearInterval(orderListPollTimer);
    orderListPollTimer = setInterval(() => loadOrdersAdmin().catch(() => {}), 8000);
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
  // Anti-kedip: kalau head-script nemu profil ke-cache yang rolenya
  // cukup (admin/owner), tampilkan dashboard-nya SEKARANG (data lama,
  // sekilas), sambil checkExistingSession() di bawah tetap verifikasi
  // ulang ke server & refresh datanya.
  if (window.__cachedProfile) showDashboard(window.__cachedProfile);

  try {
    await initSupabase();
  } catch (err) {
    if (!window.__cachedProfile) showLogin(err.message);
    return;
  }

  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('banner-form').addEventListener('submit', handleBannerSubmit);
  document.getElementById('category-form').addEventListener('submit', handleCategorySubmit);
  document.getElementById('product-form').addEventListener('submit', handleProductSubmit);
  document.getElementById('social-form').addEventListener('submit', handleSocialSubmit);
  document.getElementById('testimonial-form').addEventListener('submit', handleTestimonialSubmit);
  document.getElementById('hero-banner-form').addEventListener('submit', handleHeroBannerSubmit);
  initProductImageInput();
  initDetailEditor();
  initOptionsEditor();
  initTestimonialImageInput();
  initHeroBannerImageInput();
  initNotifyButton();

  await checkExistingSession();

  // Poin F dari audit: kalau user logout lalu pencet tombol Back browser,
  // halaman bisa ke-restore dari bfcache (menampilkan dashboard versi lama
  // tanpa re-run JS). Listener ini re-cek sesi tiap kali halaman muncul
  // lagi dari bfcache, supaya dashboard tidak nyangkut kebuka.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) checkExistingSession();
  });
});
