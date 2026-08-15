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

// ---------- Banner Gambar (upload, diatur owner) ----------
async function loadHeroBannerImage() {
  const wrap = document.getElementById('hero-banner-wrap');
  const img = document.getElementById('hero-banner-img');
  if (!wrap || !img) return;

  try {
    const { data } = await fetchJSON(`${API_BASE}/hero-banners`);
    if (!data || data.length === 0) {
      wrap.classList.add('hidden');
      return;
    }
    const banner = data[0]; // yang paling atas urutannya
    img.src = banner.image_url;
    if (banner.link_url) {
      img.style.cursor = 'pointer';
      img.onclick = () => window.open(banner.link_url, '_blank', 'noopener,noreferrer');
    } else {
      img.style.cursor = 'default';
      img.onclick = null;
    }
    wrap.classList.remove('hidden');
  } catch (err) {
    wrap.classList.add('hidden');
  }
}

// ---------- Kategori ----------
let currentCategory = 'semua';
let currentSearch = '';

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
    currentCategory = chip.dataset.cat;
    loadProducts();
  });
}

function initSearch() {
  const form = document.getElementById('search-form');
  const input = document.getElementById('search-input');
  if (!form || !input) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    currentSearch = input.value.trim();
    // Pencarian nyari lintas kategori — reset chip ke "Semua" biar hasilnya
    // tidak kelihatan kosong padahal produknya ada di kategori lain.
    if (currentSearch) {
      currentCategory = 'semua';
      const nav = document.getElementById('category-nav');
      nav?.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.cat === 'semua'));
    }
    loadProducts();
    document.getElementById('produk')?.scrollIntoView({ behavior: 'smooth' });
  });
}

// ---------- Produk ----------
function productCardHTML(p) {
  return `
    <div class="pcard">
      <div class="hole"></div>
      ${p.badge ? `<span class="badge">${escapeHtml(p.badge)}</span>` : ''}
      <div class="thumb">${p.image_url ? `<img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}" loading="lazy">` : escapeHtml(p.icon || '📦')}</div>
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

// Kotak kosong berbentuk sama persis kayak kartu produk asli, dipakai
// selagi /api/products masih dimuat — biar tidak cuma teks "Memuat..."
function skeletonCardHTML() {
  return `
    <div class="pcard-skeleton">
      <div class="hole"></div>
      <div class="thumb"></div>
      <div class="body">
        <div class="sk-line sk-shop"></div>
        <div class="sk-line sk-name"></div>
        <div class="sk-line sk-price"></div>
        <div class="sk-btn"></div>
      </div>
    </div>
  `;
}

function renderProductSkeletons(grid, count = 8) {
  grid.innerHTML = Array.from({ length: count }, skeletonCardHTML).join('');
}

async function loadProducts(categorySlug = currentCategory) {
  const grid = document.getElementById('product-grid');
  if (!grid) return;

  renderProductSkeletons(grid);

  try {
    const qs = categorySlug && categorySlug !== 'semua' ? `?category=${encodeURIComponent(categorySlug)}` : '';
    const { data } = await fetchJSON(`${API_BASE}/products${qs}`);

    let filtered = data || [];
    if (currentSearch) {
      const q = currentSearch.toLowerCase();
      filtered = filtered.filter((p) =>
        p.name.toLowerCase().includes(q) || p.shop_name.toLowerCase().includes(q)
      );
    }

    if (filtered.length === 0) {
      grid.innerHTML = currentSearch
        ? `<p class="grid-msg">Tidak ada produk yang cocok dengan "${escapeHtml(currentSearch)}".</p>`
        : `<p class="grid-msg">Belum ada produk di kategori ini.</p>`;
      return;
    }

    grid.innerHTML = filtered.map(productCardHTML).join('');
  } catch (err) {
    grid.innerHTML = `<p class="grid-msg">Gagal memuat produk: ${escapeHtml(err.message)}</p>`;
  }
}

// ---------- Produk Populer (pilihan owner, dipasang di hero-visual) ----------
async function loadFeaturedProducts() {
  const visual = document.getElementById('hero-visual');
  if (!visual) return;

  try {
    const { data } = await fetchJSON(`${API_BASE}/products?featured=true`);
    renderHeroPicks((data || []).slice(0, 3));
  } catch (err) {
    visual.innerHTML = '';
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

// ---------- Media Sosial (diatur owner lewat admin panel) ----------
async function loadSocialLinks() {
  const wrap = document.getElementById('social-links');
  if (!wrap) return;

  try {
    const { data } = await fetchJSON(`${API_BASE}/social-links`);
    if (!data || data.length === 0) {
      wrap.innerHTML = '';
      return;
    }
    wrap.innerHTML = data
      .map((s) => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.platform)}</a>`)
      .join('');
  } catch (err) {
    wrap.innerHTML = '';
  }
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
  initSearch();
  initCart();
  await loadHeroBannerImage();
  await loadBanner();
  await loadCategories();
  await loadProducts();
  await loadFeaturedProducts();
  await loadSocialLinks();
});