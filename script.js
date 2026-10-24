const API_BASE = '/api';

// Sesi login (kalau ada) — dipakai buat nandain pesanan checkout punya
// akun siapa (opsional, checkout tanpa login tetap jalan normal). Diisi
// oleh initNavAccountButton() pas halaman dimuat.
let currentSession = null;

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
  const skeleton = document.getElementById('hero-skeleton');
  if (!wrap || !img) return;

  const hideAll = () => { skeleton?.classList.add('hidden'); wrap.classList.add('hidden'); };

  // Munculkan banner dengan animasi (fade + zoom-out halus) SETELAH media
  // benar-benar siap, supaya tidak "tiba-tiba" muncul / bergeser.
  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    skeleton?.classList.add('hidden');
    wrap.classList.remove('hidden');
    // dua frame: pastikan state awal (opacity 0) sempat dirender dulu
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('is-in')));
  };

  try {
    const { data } = await fetchJSON(`${API_BASE}/hero-banners`);
    if (!data || data.length === 0) { hideAll(); return; }

    const banner = data[0]; // yang paling atas urutannya
    const video = document.getElementById('hero-banner-video');
    const isVideo = /\/video\/upload\//.test(banner.image_url) || /\.(mp4|webm|mov)(\?|$)/i.test(banner.image_url);

    if (isVideo && video) {
      // Banner video: otomatis main tanpa suara, berulang. Poster = frame
      // pertama (transformasi Cloudinary) biar tidak kosong selagi memuat.
      img.classList.add('hidden');
      video.classList.remove('hidden');
      video.addEventListener('loadeddata', reveal, { once: true });
      video.addEventListener('error', reveal, { once: true });
      video.poster = banner.image_url.replace('/video/upload/', '/video/upload/so_0/').replace(/\.(mp4|webm|mov)(\?.*)?$/i, '.jpg');
      video.src = banner.image_url;
      video.muted = true;
      video.play().catch(() => { /* autoplay diblokir (mis. mode hemat daya) -> tampil poster saja */ });
    } else {
      video?.classList.add('hidden');
      img.classList.remove('hidden');
      img.addEventListener('load', reveal, { once: true });
      img.addEventListener('error', hideAll, { once: true });
      img.src = banner.image_url;
      if (img.complete && img.naturalWidth) reveal(); // sudah ada di cache
    }
    img.alt = banner.title || 'Banner';

    if (banner.link_url) {
      wrap.style.cursor = 'pointer';
      wrap.onclick = () => window.open(banner.link_url, '_blank', 'noopener,noreferrer');
    } else {
      wrap.style.cursor = 'default';
      wrap.onclick = null;
    }

    // Jaga-jaga koneksi sangat lambat: jangan biarkan skeleton selamanya.
    setTimeout(reveal, 8000);
  } catch (err) {
    hideAll();
  }
}

// ---------- Kategori ----------
let currentCategory = 'semua';
let currentSearch = '';

async function loadCategories() {
  const nav = document.getElementById('category-nav');
  if (!nav) return;

  // Placeholder shimmer dulu selama nunggu /api/categories kejawab, biar
  // nggak ada jeda kosong sebelum chip kategori muncul.
  nav.innerHTML = Array.from({ length: 4 }, () => '<span class="chip-skeleton"></span>').join('');

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

  const hasCatalog = !!document.getElementById('product-grid');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();

    if (!hasCatalog) {
      // Halaman ini (mis. beranda) gak punya grid produk -> arahkan ke
      // halaman Belanja sambil bawa kata kuncinya.
      window.location.href = `belanja.html${q ? `?q=${encodeURIComponent(q)}` : ''}`;
      return;
    }

    currentSearch = q;
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

  // Datang dari halaman lain bawa ?q=... (mis. search di beranda diarahkan
  // ke sini) -> langsung isi kotak cari & jalanin pencariannya.
  if (hasCatalog) {
    const initialQuery = new URLSearchParams(window.location.search).get('q');
    if (initialQuery) {
      input.value = initialQuery;
      currentSearch = initialQuery;
    }
  }
}

// ---------- Harga varian (dipakai produk.js, beli.js, kartu produk) ----------
// Tiap pilihan varian boleh punya:
//   price      = HARGA SENDIRI (menggantikan harga produk), 0/kosong = pakai harga produk
//   price_add  = TAMBAHAN harga di atas harga yang berlaku
// Kalau beberapa grup punya harga sendiri, yang dipakai grup PERTAMA (admin
// dianjurkan mengisi harga sendiri di satu grup saja). Server (api/orders.js)
// memakai rumus yang sama dan menghitung ulang saat pesanan dibuat.
function variantGroups(product) {
  return (Array.isArray(product.options) ? product.options : []).filter((g) => g && Array.isArray(g.values) && g.values.length);
}

function variantUnitPrice(product, selection) {
  let own = null;
  let add = 0;
  variantGroups(product).forEach((g) => {
    const v = g.values.find((x) => x.label === (selection || {})[g.name]);
    if (!v) return;
    if (own === null && Number(v.price) > 0) own = Number(v.price);
    add += Number(v.price_add) || 0;
  });
  return (own === null ? Number(product.price) : own) + add;
}

function variantOverridesPrice(product, selection) {
  return variantGroups(product).some((g) => {
    const v = g.values.find((x) => x.label === (selection || {})[g.name]);
    return v && Number(v.price) > 0;
  });
}

// { min, max } harga yang mungkin (hanya pilihan yang belum habis)
function variantPriceRange(product) {
  const groups = variantGroups(product);
  const base = Number(product.price);
  const usable = (g) => {
    const ok = g.values.filter((v) => !v.sold_out);
    return ok.length ? ok : g.values;
  };
  const ownGroup = groups.find((g) => g.values.some((v) => Number(v.price) > 0));
  const baseCandidates = ownGroup ? usable(ownGroup).map((v) => (Number(v.price) > 0 ? Number(v.price) : base)) : [base];
  let addMin = 0;
  let addMax = 0;
  groups.forEach((g) => {
    const adds = usable(g).map((v) => Number(v.price_add) || 0);
    addMin += Math.min(...adds);
    addMax += Math.max(...adds);
  });
  return { min: Math.min(...baseCandidates) + addMin, max: Math.max(...baseCandidates) + addMax };
}

// ---------- Produk ----------
function productCardHTML(p) {
  const range = variantPriceRange(p);
  const ranged = range.min !== range.max;
  return `
    <div class="pcard">
      <div class="hole"></div>
      ${p.badge ? `<span class="badge">${escapeHtml(p.badge)}</span>` : ''}
      <a class="thumb" href="produk.html?id=${encodeURIComponent(p.id)}" aria-label="${escapeHtml(p.name)}">${p.image_url ? `<img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}" loading="lazy">` : (p.icon ? escapeHtml(p.icon) : ICONS.box)}</a>
      <div class="body">
        <div class="shop">${escapeHtml(p.shop_name)}</div>
        <a class="name" href="produk.html?id=${encodeURIComponent(p.id)}">${escapeHtml(p.name)}</a>
        <div class="price-row">
          ${ranged ? '<span class="from">dari</span>' : ''}<span class="price">${rupiah(range.min)}</span>
          ${p.old_price && !ranged ? `<span class="old">${rupiah(p.old_price)}</span>` : ''}
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

  const countEl = document.getElementById('shop-result-count');
  if (countEl) countEl.textContent = '';

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
      if (countEl) countEl.textContent = currentSearch ? `0 hasil untuk "${currentSearch}"` : '';
      return;
    }

    grid.innerHTML = filtered.map(productCardHTML).join('');
    if (countEl) {
      countEl.textContent = currentSearch
        ? `${filtered.length} hasil untuk "${currentSearch}"`
        : `${filtered.length} produk`;
    }
  } catch (err) {
    grid.innerHTML = `<p class="grid-msg">Gagal memuat produk: ${escapeHtml(err.message)}</p>`;
  }
}

// ---------- Produk Populer (pilihan owner) ----------
// Dulu juga dipakai buat kartu melayang dekoratif di hero — sekarang
// SENGAJA cuma satu tempat: grid produk nyata yang bisa diklik "Beli
// Sekarang" di section "Produk Unggulan" (#featured-grid). Kalau
// elemennya nggak ada di halaman ini (mis. belanja.html), dilewatin.
async function loadFeaturedProducts() {
  const gridWrap = document.getElementById('featured-grid');
  if (!gridWrap) return;

  try {
    const { data } = await fetchJSON(`${API_BASE}/products?featured=true`);
    renderFeaturedGrid((data || []).slice(0, 8));
  } catch (err) {
    document.getElementById('featured-section')?.classList.add('hidden');
  }
}

function renderFeaturedGrid(products) {
  const gridWrap = document.getElementById('featured-grid');
  if (!gridWrap) return;
  const section = document.getElementById('featured-section');

  if (!products || products.length === 0) {
    // Belum ada produk yang ditandai "populer" di Admin Panel -> section
    // ini disembunyikan seluruhnya, bukan ditampilkan kosong.
    section?.classList.add('hidden');
    return;
  }
  section?.classList.remove('hidden');
  gridWrap.innerHTML = products.map(productCardHTML).join('');
}

// ---------- Testimoni (beranda) ----------
// Diisi dari database lewat Admin Panel — SENGAJA nggak ada konten
// contoh/demo. Kalau belum ada testimoni aktif, section-nya disembunyikan
// seluruhnya (bukan ditampilkan kosong).
async function loadTestimonials() {
  const wrap = document.getElementById('testi-grid');
  const section = document.getElementById('testimonials-section');
  if (!wrap || !section) return;

  try {
    const { data } = await fetchJSON(`${API_BASE}/testimonials`);
    const items = data || [];
    if (items.length === 0) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');
    wrap.innerHTML = items.map(testimonialCardHTML).join('');
  } catch (err) {
    section.classList.add('hidden');
  }
}

function testimonialCardHTML(item) {
  const rating = Math.max(1, Math.min(5, Number(item.rating) || 5));
  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
  const initial = (item.author_name || '?').trim().charAt(0).toUpperCase();
  return `
    <div class="testi-card">
      <div class="testi-stars">${stars}</div>
      <p class="testi-quote">"${escapeHtml(item.quote)}"</p>
      <div class="testi-author">
        <div class="testi-avatar">${escapeHtml(initial)}</div>
        <div><strong>${escapeHtml(item.author_name)}</strong>${item.author_role ? `<span>${escapeHtml(item.author_role)}</span>` : ''}</div>
      </div>
    </div>
  `;
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
  // "Beli Sekarang" sekarang membuka HALAMAN beli sendiri (beli.html),
  // bukan popup mengambang. Nama fungsi dipertahankan biar init lama tetap jalan.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.addbtn');
    if (!btn || !btn.dataset.id) return;
    window.location.href = `beli.html?id=${encodeURIComponent(btn.dataset.id)}`;
  });
}

// ---------- Nav: tombol Masuk -> Profil kalau udah login ----------
// Status login (buat teks tombol nav yang gabung sama bahasa aktif — lihat
// updateNavAccountButtonText()). Terpisah dari currentSession di atas biar
// jelas: currentSession dipakai checkout, ini cuma buat teks tombol.
let isLoggedIn = false;

function updateNavAccountButtonText() {
  const btn = document.getElementById('nav-account-btn');
  if (!btn || typeof t !== 'function') return;
  if (isLoggedIn) {
    btn.innerHTML = `${ICONS.user} ${t('nav.profile')}`;
    btn.setAttribute('aria-label', t('nav.profile'));
  } else {
    btn.textContent = t('nav.login');
  }
}
document.addEventListener('exschool:langchange', updateNavAccountButtonText);

async function initNavAccountButton() {
  const btn = document.getElementById('nav-account-btn');
  if (!window.supabase) return;

  try {
    const config = await fetchJSON(`${API_BASE}/config`);
    const supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    const { data } = await supabaseClient.auth.getSession();

    if (data.session) {
      currentSession = data.session;
      isLoggedIn = true;
      updateNavAccountButtonText();
    }
  } catch (err) {
    // Gagal cek sesi (mis. offline) -> biarkan tombol default "Masuk",
    // klik ke akun.html tetap kerja normal (dia cek sesi ulang di sana).
    // currentSession tetap null -> checkout jalan seperti biasa (guest).
  }
}

// ---------- Animasi: scroll-reveal, shadow nav, count-up angka ----------
// Semua "no-op" dengan aman kalau elemennya nggak ada di halaman ini
// (mis. belanja.html nggak punya .reveal/.stat-item sama sekali).
function initScrollReveal() {
  const targets = document.querySelectorAll('.reveal, .reveal-stagger');
  if (!targets.length) return;

  if (!('IntersectionObserver' in window)) {
    // Browser lama tanpa dukungan IO -> langsung tampilkan semua, jangan
    // sampai kontennya ketutup opacity:0 selamanya.
    targets.forEach((el) => el.classList.add('in-view'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

  targets.forEach((el) => observer.observe(el));
}

function initNavScrollShadow() {
  const header = document.querySelector('header.site');
  if (!header) return;
  const update = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  update();
  window.addEventListener('scroll', update, { passive: true });
}

function initStatsCountUp() {
  const items = document.querySelectorAll('[data-count-to]');
  if (!items.length) return;

  const animateCount = (el) => {
    const target = Number(el.dataset.countTo);
    const decimals = Number(el.dataset.decimals || 0);
    const suffix = el.dataset.suffix || '';
    const duration = 1100;
    const start = performance.now();

    // Pastikan node teks pertama ada (elemen ini punya child <span> ★).
    if (!el.childNodes.length || el.childNodes[0].nodeType !== Node.TEXT_NODE) {
      el.insertBefore(document.createTextNode(''), el.firstChild);
    }

    function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const value = target * eased;
      const text = decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString();
      el.childNodes[0].nodeValue = text + suffix;
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  };

  if (!('IntersectionObserver' in window)) {
    items.forEach(animateCount);
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        animateCount(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });
  items.forEach((el) => observer.observe(el));
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', async () => {
  initCategoryFilter();
  initSearch();
  initOrderModal();
  initNavAccountButton();
  initScrollReveal();
  initNavScrollShadow();
  initStatsCountUp();
  await loadHeroBannerImage();
  await loadBanner();
  await loadCategories();
  await loadProducts();
  await loadFeaturedProducts();
  await loadTestimonials();
  await loadSocialLinks();
});