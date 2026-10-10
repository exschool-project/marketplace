// ---------------------------------------------------------------------
// Halaman detail produk (produk.html?id=...).
// Dimuat SETELAH script.js — memakai ulang helper-nya (fetchJSON,
// escapeHtml, rupiah, productCardHTML, modal "Beli Sekarang").
// Semua konten diambil dari database; bagian yang kosong (fitur, contoh,
// FAQ, testimoni) disembunyikan, TIDAK diisi konten contoh/demo.
// ---------------------------------------------------------------------

let pdProduct = null;
let pdReviews = [];          // testimoni
let pdReviewsAreGeneral = false; // true kalau produk belum punya testimoni sendiri
let pdRelated = [];

// ---------- teks (ID / EN) ----------
const PD_TEXT = {
  id: {
    notFound: 'Produk tidak ditemukan atau sudah tidak tersedia.',
    backShop: '← Kembali ke Belanja',
    loadFail: 'Gagal memuat produk:',
    buy: 'Beli Sekarang',
    delivery: 'Estimasi pengerjaan',
    chatDirect: 'Chat langsung dengan admin',
    trackStatus: 'Pantau status pesanan',
    noAccount: 'Tanpa perlu akun',
    save: 'Hemat',
    tabDesc: 'Deskripsi',
    tabShowcase: 'Contoh & Dokumentasi',
    tabReviews: 'Testimoni',
    tabFaq: 'FAQ',
    desc: 'Deskripsi Produk',
    features: 'Yang Kamu Dapatkan',
    showcase: 'Contoh & Dokumentasi',
    showcaseSub: 'Hasil kerja dan dokumentasi nyata. Klik gambar untuk memperbesar.',
    reviews: 'Testimoni Pembeli',
    reviewsGeneral: 'Belum ada testimoni khusus untuk produk ini. Berikut testimoni dari pembeli EX-SCHOOL lainnya.',
    reviewCount: (n) => `${n} testimoni`,
    faq: 'Pertanyaan Umum',
    how: 'Cara Pemesanan',
    step1t: 'Klik Beli Sekarang', step1d: 'Isi nama dan nomor WhatsApp. Tidak perlu daftar akun.',
    step2t: 'Chat dengan admin', step2d: 'Pesanan langsung punya ruang chat untuk diskusi brief dan revisi.',
    step3t: 'Pantau sampai selesai', step3d: 'Status pesanan diperbarui: diproses, dikirim, lalu selesai.',
    related: 'Produk Lainnya',
    close: 'Tutup', prev: 'Sebelumnya', next: 'Berikutnya', zoom: 'Perbesar gambar',
    photo: 'Foto',
  },
  en: {
    notFound: 'This product was not found or is no longer available.',
    backShop: '← Back to Shop',
    loadFail: 'Failed to load product:',
    buy: 'Buy Now',
    delivery: 'Estimated delivery',
    chatDirect: 'Chat directly with admin',
    trackStatus: 'Track your order status',
    noAccount: 'No account needed',
    save: 'Save',
    tabDesc: 'Description',
    tabShowcase: 'Examples & Documentation',
    tabReviews: 'Reviews',
    tabFaq: 'FAQ',
    desc: 'Product Description',
    features: "What You'll Get",
    showcase: 'Examples & Documentation',
    showcaseSub: 'Real work and documentation. Click an image to enlarge.',
    reviews: 'Customer Reviews',
    reviewsGeneral: 'No reviews for this product yet. Here are reviews from other EX-SCHOOL customers.',
    reviewCount: (n) => `${n} review${n === 1 ? '' : 's'}`,
    faq: 'Frequently Asked Questions',
    how: 'How to Order',
    step1t: 'Click Buy Now', step1d: 'Enter your name and WhatsApp number. No account required.',
    step2t: 'Chat with admin', step2d: 'Every order gets its own chat room to discuss the brief and revisions.',
    step3t: 'Track until done', step3d: 'Order status updates: processing, shipped, then completed.',
    related: 'More Products',
    close: 'Close', prev: 'Previous', next: 'Next', zoom: 'Enlarge image',
    photo: 'Photo',
  },
};
const pt = (k) => {
  const lang = (typeof currentLang !== 'undefined' && PD_TEXT[currentLang]) ? currentLang : 'id';
  return PD_TEXT[lang][k] ?? PD_TEXT.id[k];
};

// ---------- util ----------
const pdRupiah = (v) => 'Rp' + Number(v).toLocaleString('id-ID');
const pdArr = (v) => (Array.isArray(v) ? v : []);

function starsHTML(rating) {
  const r = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return '★'.repeat(r) + '☆'.repeat(5 - r);
}

function paragraphsHTML(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function galleryImages(p) {
  const list = [];
  if (p.image_url) list.push(p.image_url);
  pdArr(p.gallery).forEach((u) => { if (u && !list.includes(u)) list.push(u); });
  return list;
}

// ---------- render ----------
function renderProduct() {
  const root = document.getElementById('pd-root');
  const p = pdProduct;
  if (!root || !p) return;

  document.title = `${p.name} — EX-SCHOOL`;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.content = (p.description || `${p.name} — ${p.shop_name} di EX-SCHOOL`).replace(/\s+/g, ' ').slice(0, 160);
  const crumb = document.getElementById('pd-crumb-name');
  if (crumb) crumb.textContent = p.name;

  const images = galleryImages(p);
  const features = pdArr(p.features);
  const showcase = pdArr(p.showcase);
  const faq = pdArr(p.faq);
  const hasDesc = !!(p.description && p.description.trim());
  const ownReviews = !pdReviewsAreGeneral ? pdReviews : [];
  const avg = ownReviews.length ? ownReviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / ownReviews.length : 0;
  const discount = p.old_price && Number(p.old_price) > Number(p.price)
    ? Math.round((1 - Number(p.price) / Number(p.old_price)) * 100) : 0;

  const tabs = [];
  if (hasDesc || features.length) tabs.push(['pd-desc', pt('tabDesc')]);
  if (showcase.length) tabs.push(['pd-showcase', pt('tabShowcase')]);
  if (pdReviews.length) tabs.push(['pd-reviews', pt('tabReviews')]);
  if (faq.length) tabs.push(['pd-faq', pt('tabFaq')]);

  const mainMedia = images.length
    ? `<button type="button" class="pd-main-img" id="pd-main-btn" aria-label="${escapeHtml(pt('zoom'))}"><img id="pd-main-photo" src="${escapeHtml(images[0])}" alt="${escapeHtml(p.name)}"></button>`
    : `<div class="pd-main-img pd-main-fallback">${p.icon ? escapeHtml(p.icon) : ICONS.box}</div>`;

  root.innerHTML = `
    <section class="pd-top">
      <div class="pd-gallery">
        ${mainMedia}
        ${images.length > 1 ? `<div class="pd-thumbs" id="pd-thumbs">${images.map((u, i) =>
          `<button type="button" class="pd-thumb${i === 0 ? ' active' : ''}" data-index="${i}" aria-label="${escapeHtml(pt('photo'))} ${i + 1}"><img src="${escapeHtml(u)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
      </div>

      <div class="pd-info">
        <p class="pd-shop">${escapeHtml(p.shop_name)}${p.category ? ` · <a href="belanja.html">${escapeHtml(p.category.name)}</a>` : ''}</p>
        <h1 class="pd-title">${escapeHtml(p.name)}${p.badge ? ` <span class="pd-badge">${escapeHtml(p.badge)}</span>` : ''}</h1>
        ${ownReviews.length ? `<a class="pd-rating" href="#pd-reviews"><span class="pd-stars">${starsHTML(avg)}</span> <strong>${avg.toFixed(1)}</strong> <span>(${escapeHtml(pt('reviewCount')(ownReviews.length))})</span></a>` : ''}

        <div class="pd-price-row">
          <span class="pd-price">${pdRupiah(p.price)}</span>
          ${p.old_price ? `<span class="pd-old">${pdRupiah(p.old_price)}</span>` : ''}
          ${discount ? `<span class="pd-save">${escapeHtml(pt('save'))} ${discount}%</span>` : ''}
        </div>

        ${p.delivery_time ? `<p class="pd-delivery">${ICONS.check} ${escapeHtml(pt('delivery'))}: <strong>${escapeHtml(p.delivery_time)}</strong></p>` : ''}

        ${features.length ? `<ul class="pd-checks">${features.slice(0, 4).map((f) => `<li>${ICONS.check}<span>${escapeHtml(f)}</span></li>`).join('')}</ul>` : ''}

        <button type="button" class="btn btn-green brutal-sm hover-lift-sm addbtn pd-buy" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}" data-price="${Number(p.price)}">${escapeHtml(pt('buy'))}</button>

        <ul class="pd-trust">
          <li>${ICONS.chat}<span>${escapeHtml(pt('chatDirect'))}</span></li>
          <li>${ICONS.box}<span>${escapeHtml(pt('trackStatus'))}</span></li>
          <li>${ICONS.user}<span>${escapeHtml(pt('noAccount'))}</span></li>
        </ul>
      </div>
    </section>

    ${tabs.length ? `<nav class="pd-tabs" id="pd-tabs" aria-label="Bagian halaman"><div class="pd-tabs-inner">${tabs.map(([id, label]) => `<a href="#${id}" data-target="${id}">${escapeHtml(label)}</a>`).join('')}</div></nav>` : ''}

    <div class="pd-body">
      ${(hasDesc || features.length) ? `
      <section class="pd-section" id="pd-desc">
        <div class="pd-desc-grid">
          ${hasDesc ? `<div><h2>${escapeHtml(pt('desc'))}</h2><div class="pd-prose">${paragraphsHTML(p.description)}</div></div>` : ''}
          ${features.length ? `<aside class="pd-features brutal-sm"><h3>${escapeHtml(pt('features'))}</h3><ul>${features.map((f) => `<li>${ICONS.check}<span>${escapeHtml(f)}</span></li>`).join('')}</ul></aside>` : ''}
        </div>
      </section>` : ''}

      ${showcase.length ? `
      <section class="pd-section" id="pd-showcase">
        <h2>${escapeHtml(pt('showcase'))}</h2>
        <p class="pd-sub">${escapeHtml(pt('showcaseSub'))}</p>
        <div class="pd-showcase-grid">${showcase.map((s, i) => `
          <figure class="pd-showcase-item" data-index="${i}">
            <button type="button" class="pd-showcase-btn" aria-label="${escapeHtml(pt('zoom'))}"><img src="${escapeHtml(s.url)}" alt="${escapeHtml(s.caption || p.name)}" loading="lazy"></button>
            ${s.caption ? `<figcaption>${escapeHtml(s.caption)}</figcaption>` : ''}
          </figure>`).join('')}</div>
      </section>` : ''}

      <section class="pd-section" id="pd-how">
        <h2>${escapeHtml(pt('how'))}</h2>
        <ol class="pd-steps">
          <li><span class="pd-step-num">1</span><div><h4>${escapeHtml(pt('step1t'))}</h4><p>${escapeHtml(pt('step1d'))}</p></div></li>
          <li><span class="pd-step-num">2</span><div><h4>${escapeHtml(pt('step2t'))}</h4><p>${escapeHtml(pt('step2d'))}</p></div></li>
          <li><span class="pd-step-num">3</span><div><h4>${escapeHtml(pt('step3t'))}</h4><p>${escapeHtml(pt('step3d'))}</p></div></li>
        </ol>
      </section>

      ${pdReviews.length ? reviewsSectionHTML(ownReviews, avg) : ''}

      ${faq.length ? `
      <section class="pd-section" id="pd-faq">
        <h2>${escapeHtml(pt('faq'))}</h2>
        <div class="pd-faq">${faq.map((f) => `
          <details class="pd-faq-item"><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a).replace(/\n/g, '<br>')}</p></details>`).join('')}</div>
      </section>` : ''}

      ${pdRelated.length ? `
      <section class="pd-section" id="pd-related">
        <h2>${escapeHtml(pt('related'))}</h2>
        <div class="grid pd-related-grid">${pdRelated.map(productCardHTML).join('')}</div>
      </section>` : ''}
    </div>

    <div class="pd-sticky-buy" id="pd-sticky-buy">
      <div><strong>${pdRupiah(p.price)}</strong>${p.old_price ? `<small>${pdRupiah(p.old_price)}</small>` : ''}</div>
      <button type="button" class="btn btn-green addbtn" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}" data-price="${Number(p.price)}">${escapeHtml(pt('buy'))}</button>
    </div>
  `;

  bindGallery(images);
  bindShowcase(showcase);
  bindTabs();
}

function reviewsSectionHTML(ownReviews, avg) {
  // Ringkasan rating hanya kalau testimoni memang milik produk ini.
  let summary = '';
  if (ownReviews.length) {
    const rows = [5, 4, 3, 2, 1].map((star) => {
      const n = ownReviews.filter((r) => Math.round(Number(r.rating)) === star).length;
      const pct = Math.round((n / ownReviews.length) * 100);
      return `<div class="pd-bar-row"><span>${star}★</span><div class="pd-bar"><i style="width:${pct}%"></i></div><span>${n}</span></div>`;
    }).join('');
    summary = `
      <div class="pd-rating-summary brutal-sm">
        <div class="pd-avg"><strong>${avg.toFixed(1)}</strong><span class="pd-stars">${starsHTML(avg)}</span><small>${escapeHtml(pt('reviewCount')(ownReviews.length))}</small></div>
        <div class="pd-bars">${rows}</div>
      </div>`;
  }
  return `
    <section class="pd-section" id="pd-reviews">
      <h2>${escapeHtml(pt('reviews'))}</h2>
      ${pdReviewsAreGeneral ? `<p class="pd-sub">${escapeHtml(pt('reviewsGeneral'))}</p>` : ''}
      ${summary}
      <div class="testi-grid pd-review-grid">${pdReviews.map(reviewCardHTML).join('')}</div>
    </section>`;
}

function reviewCardHTML(item) {
  const base = testimonialCardHTML(item); // dari script.js
  if (!item.image_url) return base;
  // sisipkan foto bukti sebelum blok penulis
  const photo = `<button type="button" class="testi-photo" data-photo="${escapeHtml(item.image_url)}" aria-label="${escapeHtml(pt('zoom'))}"><img src="${escapeHtml(item.image_url)}" alt="" loading="lazy"></button>`;
  return base.replace('<div class="testi-author">', `${photo}<div class="testi-author">`);
}

// ---------- interaksi ----------
function bindGallery(images) {
  const mainBtn = document.getElementById('pd-main-btn');
  const mainImg = document.getElementById('pd-main-photo');
  const thumbs = document.getElementById('pd-thumbs');
  let current = 0;

  thumbs?.addEventListener('click', (e) => {
    const btn = e.target.closest('.pd-thumb');
    if (!btn) return;
    current = Number(btn.dataset.index);
    mainImg.src = images[current];
    thumbs.querySelectorAll('.pd-thumb').forEach((b) => b.classList.toggle('active', b === btn));
  });
  mainBtn?.addEventListener('click', () => openLightbox(images.map((u) => ({ url: u, caption: '' })), current));
}

function bindShowcase(showcase) {
  document.querySelectorAll('.pd-showcase-item').forEach((fig) => {
    fig.querySelector('.pd-showcase-btn')?.addEventListener('click', () => openLightbox(showcase, Number(fig.dataset.index)));
  });
  document.querySelectorAll('.testi-photo').forEach((btn) => {
    btn.addEventListener('click', () => openLightbox([{ url: btn.dataset.photo, caption: '' }], 0));
  });
}

function bindTabs() {
  const nav = document.getElementById('pd-tabs');
  if (!nav) return;
  const links = [...nav.querySelectorAll('a')];
  const targets = links.map((a) => document.getElementById(a.dataset.target)).filter(Boolean);

  if (!('IntersectionObserver' in window)) return;
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) {
        links.forEach((a) => a.classList.toggle('active', a.dataset.target === en.target.id));
      }
    });
  }, { rootMargin: '-35% 0px -55% 0px' });
  targets.forEach((t) => obs.observe(t));
}

// ---------- lightbox ----------
let lbList = [];
let lbIndex = 0;

function ensureLightbox() {
  let el = document.getElementById('pd-lightbox');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'pd-lightbox';
  el.className = 'pd-lightbox hidden';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <button type="button" class="pd-lb-close" aria-label="${escapeHtml(pt('close'))}">${ICONS.close}</button>
    <button type="button" class="pd-lb-nav pd-lb-prev" aria-label="${escapeHtml(pt('prev'))}">‹</button>
    <figure><img alt=""><figcaption></figcaption></figure>
    <button type="button" class="pd-lb-nav pd-lb-next" aria-label="${escapeHtml(pt('next'))}">›</button>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('.pd-lb-close')) closeLightbox();
    else if (e.target.closest('.pd-lb-prev')) stepLightbox(-1);
    else if (e.target.closest('.pd-lb-next')) stepLightbox(1);
  });
  return el;
}

function paintLightbox() {
  const el = ensureLightbox();
  const item = lbList[lbIndex];
  if (!item) return;
  el.querySelector('img').src = item.url;
  el.querySelector('figcaption').textContent = item.caption || '';
  const multi = lbList.length > 1;
  el.querySelector('.pd-lb-prev').classList.toggle('hidden', !multi);
  el.querySelector('.pd-lb-next').classList.toggle('hidden', !multi);
}

function openLightbox(list, index) {
  if (!list.length) return;
  lbList = list;
  lbIndex = Math.max(0, Math.min(index, list.length - 1));
  const el = ensureLightbox();
  paintLightbox();
  el.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  document.getElementById('pd-lightbox')?.classList.add('hidden');
  document.body.style.overflow = '';
}

function stepLightbox(dir) {
  lbIndex = (lbIndex + dir + lbList.length) % lbList.length;
  paintLightbox();
}

document.addEventListener('keydown', (e) => {
  const el = document.getElementById('pd-lightbox');
  if (!el || el.classList.contains('hidden')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') stepLightbox(-1);
  if (e.key === 'ArrowRight') stepLightbox(1);
});

// ---------- load ----------
function showError(message) {
  const root = document.getElementById('pd-root');
  root.innerHTML = `
    <div class="pd-error">
      <p>${escapeHtml(message)}</p>
      <a class="btn btn-green brutal-sm" href="belanja.html">${escapeHtml(pt('backShop'))}</a>
    </div>`;
}

async function loadProductPage() {
  const id = new URLSearchParams(window.location.search).get('id');
  if (!id) { showError(pt('notFound')); return; }

  try {
    const { data } = await fetchJSON(`${API_BASE}/products?id=${encodeURIComponent(id)}`);
    pdProduct = data;
  } catch (err) {
    showError(/tidak ditemukan/i.test(err.message) ? pt('notFound') : `${pt('loadFail')} ${err.message}`);
    return;
  }

  // Testimoni & produk terkait dimuat paralel; kegagalannya tidak boleh
  // menggagalkan halaman produk.
  const catSlug = pdProduct.category?.slug;
  const [own, related] = await Promise.all([
    fetchJSON(`${API_BASE}/testimonials?product_id=${encodeURIComponent(id)}`).catch(() => ({ data: [] })),
    catSlug
      ? fetchJSON(`${API_BASE}/products?category=${encodeURIComponent(catSlug)}`).catch(() => ({ data: [] }))
      : fetchJSON(`${API_BASE}/products?featured=true`).catch(() => ({ data: [] })),
  ]);

  pdReviews = own.data || [];
  pdReviewsAreGeneral = false;
  if (!pdReviews.length) {
    // Belum ada testimoni khusus produk -> tampilkan testimoni umum yang
    // ADA di database (diberi label jelas), bukan karangan.
    const general = await fetchJSON(`${API_BASE}/testimonials`).catch(() => ({ data: [] }));
    pdReviews = (general.data || []).filter((r) => !r.product_id).slice(0, 6);
    pdReviewsAreGeneral = pdReviews.length > 0;
  }
  pdRelated = (related.data || []).filter((x) => x.id !== pdProduct.id).slice(0, 4);

  renderProduct();
}

document.addEventListener('DOMContentLoaded', loadProductPage);
document.addEventListener('exschool:langchange', () => { if (pdProduct) renderProduct(); });
