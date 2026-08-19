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
  const titleEl = document.getElementById('hero-banner-title');
  const subtitleEl = document.getElementById('hero-banner-subtitle');
  if (!wrap || !img) return;

  try {
    const { data } = await fetchJSON(`${API_BASE}/hero-banners`);
    if (!data || data.length === 0) {
      wrap.classList.add('hidden');
      return;
    }
    const banner = data[0]; // yang paling atas urutannya
    img.src = banner.image_url;
    img.alt = banner.title || 'Banner';
    if (titleEl) titleEl.textContent = banner.title || '';
    if (subtitleEl) subtitleEl.textContent = banner.subtitle || '';
    if (banner.link_url) {
      wrap.style.cursor = 'pointer';
      wrap.onclick = () => window.open(banner.link_url, '_blank', 'noopener,noreferrer');
    } else {
      wrap.style.cursor = 'default';
      wrap.onclick = null;
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
        <button class="addbtn" type="button" data-id="${p.id}" data-name="${escapeHtml(p.name)}" data-price="${p.price}">Beli Sekarang</button>
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
  const cardsWrap = document.getElementById('hero-visual-cards');
  if (!cardsWrap) return;

  try {
    const { data } = await fetchJSON(`${API_BASE}/products?featured=true`);
    renderHeroPicks((data || []).slice(0, 3));
  } catch (err) {
    cardsWrap.innerHTML = '';
  }
}

// ---------- Hero visual (produk unggulan) ----------
function renderHeroPicks(products) {
  const cardsWrap = document.getElementById('hero-visual-cards');
  if (!cardsWrap) return;

  if (!products || products.length === 0) {
    cardsWrap.innerHTML = '';
    return;
  }

  const classes = ['c1', 'c2', 'c3'];
  cardsWrap.innerHTML = products.map((p, i) => `
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

// ---------- Beli Sekarang (modal) ----------
// Menggantikan sistem keranjang lama: klik "Beli Sekarang" di kartu produk
// langsung buka modal ini, isi nama + WhatsApp, sistem bikin ID pesanan +
// ruang chat dengan admin — tidak perlu login/akun.
function saveOrderToLocal(order) {
  try {
    const list = JSON.parse(localStorage.getItem('exschool_orders') || '[]');
    list.unshift({
      code: order.order_code,
      token: order.access_token,
      product_name: order.product_name,
      created_at: order.created_at,
    });
    localStorage.setItem('exschool_orders', JSON.stringify(list.slice(0, 20)));
  } catch (err) {
    // localStorage penuh/diblokir browser — tidak fatal, pembeli masih
    // punya kode pesanan yang ditampilkan di layar.
  }
}

function initOrderModal() {
  const overlay = document.getElementById('order-modal');
  const closeBtn = document.getElementById('order-modal-close');
  const stepForm = document.getElementById('order-step-form');
  const stepSuccess = document.getElementById('order-step-success');
  const form = document.getElementById('order-form');
  const errEl = document.getElementById('order-form-error');
  const nameEl = document.getElementById('order-product-name');
  const priceEl = document.getElementById('order-product-price');
  if (!overlay || !form) return;

  let selectedProductId = null;

  function openModal(productId, productName, productPrice) {
    selectedProductId = productId;
    nameEl.textContent = productName;
    priceEl.textContent = rupiah(productPrice);
    errEl.classList.add('hidden');
    form.reset();
    stepForm.classList.remove('hidden');
    stepSuccess.classList.add('hidden');
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.addbtn');
    if (!btn) return;
    openModal(btn.dataset.id, btn.dataset.name, btn.dataset.price);
  });

  closeBtn?.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.classList.add('hidden');
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Memproses...';

    try {
      const payload = {
        product_id: selectedProductId,
        buyer_name: document.getElementById('order-buyer-name').value.trim(),
        buyer_phone: document.getElementById('order-buyer-phone').value.trim(),
        buyer_note: document.getElementById('order-buyer-note').value.trim(),
      };
      const res = await fetch(`${API_BASE}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Gagal membuat pesanan.');

      const order = body.data;
      saveOrderToLocal(order);

      document.getElementById('order-success-code').textContent = order.order_code;
      const chatLink = document.getElementById('order-success-chat-link');
      chatLink.href = `pesanan.html?code=${encodeURIComponent(order.order_code)}&token=${encodeURIComponent(order.access_token)}`;

      stepForm.classList.add('hidden');
      stepSuccess.classList.remove('hidden');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Buat Pesanan';
    }
  });
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', async () => {
  initCategoryFilter();
  initSearch();
  initOrderModal();
  await loadHeroBannerImage();
  await loadBanner();
  await loadCategories();
  await loadProducts();
  await loadFeaturedProducts();
  await loadSocialLinks();
});