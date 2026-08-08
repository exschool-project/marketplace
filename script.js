const API_BASE = '/api';

// ---------- Util ----------
function rupiah(value) {
  return 'Rp' + Math.round(Number(value) / 1000) + 'rb';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Terjadi kesalahan saat memuat data.');
  return body;
}

// ---------- Banner ----------
async function loadBanner() {
  const wrap = document.querySelector('.banner');
  const track = document.getElementById('banner-track');
  if (!track) return;

  try {
    const { data } = await fetchJSON(`${API_BASE}/banner`);
    if (!data || data.length === 0) {
      wrap.style.display = 'none';
      return;
    }
    const spans = data.map((b) => `<span>${escapeHtml(b.message)}</span>`);
    // digandakan supaya animasi marquee terlihat menyambung tanpa jeda
    track.innerHTML = spans.join('') + spans.join('');
  } catch (err) {
    wrap.style.display = 'none';
  }
}

// ---------- Kategori ----------
async function loadCategories() {
  const nav = document.getElementById('category-nav');
  if (!nav) return;

  try {
    const { data } = await fetchJSON(`${API_BASE}/categories`);
    const chips = [`<span class="chip active" data-cat="semua">Semua</span>`]
      .concat(data.map((c) => `<span class="chip" data-cat="${escapeHtml(c.slug)}">${escapeHtml(c.name)}</span>`));
    nav.innerHTML = chips.join('');
  } catch (err) {
    nav.innerHTML = `<span class="chip active" data-cat="semua">Semua</span>`;
  }
}

function initCategoryFilter() {
  const nav = document.getElementById('category-nav');
  if (!nav) return;
  nav.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    nav.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    loadProducts(chip.dataset.cat);
  });
}

// ---------- Produk ----------
function productCardHTML(p) {
  return `
    <div class="pcard">
      <div class="hole"></div>
      ${p.badge ? `<span class="badge">${escapeHtml(p.badge)}</span>` : ''}
      <div class="thumb">${escapeHtml(p.icon || '📦')}</div>
      <div class="body">
        <div class="shop">${escapeHtml(p.shop_name)}</div>
        <div class="name">${escapeHtml(p.name)}</div>
        <div class="price-row">
          <span class="price">${rupiah(p.price)}</span>
          ${p.old_price ? `<span class="old">${rupiah(p.old_price)}</span>` : ''}
        </div>
        <button class="addbtn" data-id="${p.id}">+ Keranjang</button>
      </div>
    </div>
  `;
}

async function loadProducts(categorySlug = 'semua') {
  const grid = document.getElementById('product-grid');
  if (!grid) return;

  grid.innerHTML = `<p class="grid-msg">Memuat produk...</p>`;

  try {
    const qs = categorySlug && categorySlug !== 'semua' ? `?category=${encodeURIComponent(categorySlug)}` : '';
    const { data } = await fetchJSON(`${API_BASE}/products${qs}`);

    if (!data || data.length === 0) {
      grid.innerHTML = `<p class="grid-msg">Belum ada produk di kategori ini.</p>`;
      return;
    }

    grid.innerHTML = data.map(productCardHTML).join('');
    if (categorySlug === 'semua') renderHeroPicks(data.slice(0, 3));
  } catch (err) {
    grid.innerHTML = `<p class="grid-msg">Gagal memuat produk: ${escapeHtml(err.message)}</p>`;
  }
}

// ---------- Hero visual (produk unggulan) ----------
function renderHeroPicks(products) {
  const visual = document.getElementById('hero-visual');
  if (!visual) return;

  if (!products || products.length === 0) {
    visual.innerHTML = '';
    return;
  }

  const classes = ['c1', 'c2', 'c3'];
  visual.innerHTML = products.map((p, i) => `
    <div class="float-card ${classes[i] || ''}">
      <div class="tag-hole"></div>
      <div class="ttl">${escapeHtml(p.name)}</div>
      <div class="prc">
        ${p.old_price ? `<del>${rupiah(p.old_price)}</del>` : ''}${rupiah(p.price)}
      </div>
    </div>
  `).join('');
}

// ---------- Keranjang (sisi klien, sederhana) ----------
function initCart() {
  let cartCount = 0;
  const cartButton = document.getElementById('cart-button');
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.addbtn');
    if (!btn) return;
    cartCount += 1;
    if (cartButton) cartButton.textContent = `🛒 Keranjang (${cartCount})`;
  });
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', async () => {
  initCategoryFilter();
  initCart();
  await loadBanner();
  await loadCategories();
  await loadProducts();
});
