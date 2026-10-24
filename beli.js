// ---------------------------------------------------------------------
// Halaman beli (beli.html?id=...): pilih varian (diatur admin), jumlah,
// isi data pembeli, buat pesanan. Dimuat SETELAH script.js.
// Harga di sini hanya tampilan — server menghitung ulang total dari data
// produk saat pesanan dibuat (api/orders.js).
// ---------------------------------------------------------------------
let buyProduct = null;
const buySel = {};      // { namaGrup: label }
let buyQty = 1;

const idr = (v) => 'Rp' + Math.round(Number(v) || 0).toLocaleString('id-ID');
const optGroups = () => variantGroups(buyProduct);

const unitPrice = () => variantUnitPrice(buyProduct, buySel);

function renderBuy() {
  const p = buyProduct;
  document.title = `Beli ${p.name} — EX-SCHOOL`;
  const crumb = document.getElementById('buy-crumb-product');
  crumb.textContent = p.name;
  crumb.href = `produk.html?id=${encodeURIComponent(p.id)}`;

  const groups = optGroups();
  const saved = loadBuyer();

  document.getElementById('buy-root').innerHTML = `
    <div class="buy-wrap">
      <a class="buy-back" href="produk.html?id=${encodeURIComponent(p.id)}">← Kembali ke detail produk</a>

      <form id="buy-form" class="buy-grid" novalidate>
        <div class="buy-main">
          <section class="buy-card buy-product">
            <div class="buy-thumb">${p.image_url ? `<img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}">` : (p.icon ? escapeHtml(p.icon) : ICONS.box)}</div>
            <div class="buy-product-info">
              <p class="buy-shop">${escapeHtml(p.shop_name)}</p>
              <h1>${escapeHtml(p.name)}</h1>
              <p class="buy-price"><strong id="buy-unit">${idr(unitPrice())}</strong>${p.old_price && !variantOverridesPrice(p, buySel) ? ` <s id="buy-old">${idr(p.old_price)}</s>` : ''}</p>
              ${p.delivery_time ? `<p class="buy-delivery">${ICONS.check} ${escapeHtml(p.delivery_time)}</p>` : ''}
            </div>
          </section>

          ${groups.map((g, gi) => `
          <section class="buy-card" data-group="${gi}">
            <h2>${escapeHtml(g.name)}</h2>
            <div class="buy-chips" role="radiogroup" aria-label="${escapeHtml(g.name)}">
              ${g.values.map((v, vi) => `<button type="button" class="buy-chip${buySel[g.name] === v.label ? ' active' : ''}" role="radio" aria-checked="${buySel[g.name] === v.label}" data-g="${gi}" data-v="${vi}" ${v.sold_out ? 'disabled' : ''}>${escapeHtml(v.label)}${v.sold_out ? ' <em>habis</em>' : (Number(v.price) > 0 ? ` <em>${idr(v.price)}</em>` : (Number(v.price_add) > 0 ? ` <em>+${idr(v.price_add)}</em>` : ''))}</button>`).join('')}
            </div>
            <p class="buy-field-error hidden" data-err="${gi}">Pilih ${escapeHtml(g.name)} dulu.</p>
          </section>`).join('')}

          <section class="buy-card buy-qty-row">
            <h2>Jumlah</h2>
            <div class="buy-qty">
              <button type="button" id="qty-minus" aria-label="Kurangi">−</button>
              <input type="number" id="buy-qty" value="${buyQty}" min="1" max="99" inputmode="numeric" aria-label="Jumlah">
              <button type="button" id="qty-plus" aria-label="Tambah">+</button>
            </div>
          </section>

          <section class="buy-card">
            <h2>Data pemesan</h2>
            <label class="field"><span>Nama kamu</span><input type="text" id="buy-name" required autocomplete="name" placeholder="Nama lengkap" value="${escapeHtml(saved.name)}"></label>
            <label class="field"><span>Nomor WhatsApp</span><input type="tel" id="buy-phone" required autocomplete="tel" placeholder="08xxxxxxxxxx" value="${escapeHtml(saved.phone)}"></label>
            <label class="field"><span>Catatan (opsional)</span><textarea id="buy-note" rows="3" placeholder="Detail brief, permintaan khusus, dll"></textarea></label>
          </section>
        </div>

        <aside class="buy-side">
          <section class="buy-card buy-summary">
            <h2>Ringkasan</h2>
            <dl>
              <div><dt>Harga satuan</dt><dd id="sum-unit"></dd></div>
              <div><dt>Jumlah</dt><dd id="sum-qty"></dd></div>
              ${groups.map((g) => `<div><dt>${escapeHtml(g.name)}</dt><dd data-sum-group="${escapeHtml(g.name)}"></dd></div>`).join('')}
              <div class="buy-total"><dt>Total</dt><dd id="sum-total"></dd></div>
            </dl>
            <p id="buy-error" class="order-form-error hidden"></p>
            <button type="submit" id="buy-submit" class="btn btn-green brutal-sm hover-lift-sm buy-submit">Buat Pesanan</button>
            <p class="buy-note">Tanpa akun. Setelah pesanan dibuat, kamu langsung masuk ke ruang chat dengan admin.</p>
          </section>
        </aside>
      </form>
    </div>`;
  bindBuy();
  updateSummary();
}

function loadBuyer() {
  try { return Object.assign({ name: '', phone: '' }, JSON.parse(localStorage.getItem('exschool_buyer') || '{}')); }
  catch (e) { return { name: '', phone: '' }; }
}
function saveBuyer(name, phone) {
  try { localStorage.setItem('exschool_buyer', JSON.stringify({ name, phone })); } catch (e) { /* abaikan */ }
}

function updateSummary() {
  const unit = unitPrice();
  document.getElementById('buy-unit').textContent = idr(unit);
  const oldEl = document.getElementById('buy-old');
  if (oldEl) oldEl.classList.toggle('hidden', variantOverridesPrice(buyProduct, buySel));
  document.getElementById('sum-unit').textContent = idr(unit);
  document.getElementById('sum-qty').textContent = `× ${buyQty}`;
  document.getElementById('sum-total').textContent = idr(unit * buyQty);
  document.getElementById('buy-submit').textContent = `Buat Pesanan · ${idr(unit * buyQty)}`;
  document.querySelectorAll('[data-sum-group]').forEach((el) => { el.textContent = buySel[el.dataset.sumGroup] || '—'; });
}

function setQty(n) {
  buyQty = Math.max(1, Math.min(99, Math.floor(Number(n)) || 1));
  document.getElementById('buy-qty').value = buyQty;
  updateSummary();
}

function bindBuy() {
  const groups = optGroups();
  document.querySelectorAll('.buy-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const g = groups[Number(chip.dataset.g)];
      const v = g.values[Number(chip.dataset.v)];
      buySel[g.name] = v.label;
      chip.parentElement.querySelectorAll('.buy-chip').forEach((c) => {
        const on = c === chip;
        c.classList.toggle('active', on);
        c.setAttribute('aria-checked', String(on));
      });
      document.querySelector(`[data-err="${chip.dataset.g}"]`)?.classList.add('hidden');
      updateSummary();
    });
  });

  document.getElementById('qty-minus').addEventListener('click', () => setQty(buyQty - 1));
  document.getElementById('qty-plus').addEventListener('click', () => setQty(buyQty + 1));
  document.getElementById('buy-qty').addEventListener('change', (e) => setQty(e.target.value));

  document.getElementById('buy-form').addEventListener('submit', submitBuy);
}

async function submitBuy(e) {
  e.preventDefault();
  const errEl = document.getElementById('buy-error');
  errEl.classList.add('hidden');

  const groups = optGroups();
  const missing = groups.findIndex((g) => !buySel[g.name]);
  if (missing !== -1) {
    const box = document.querySelector(`[data-err="${missing}"]`);
    box?.classList.remove('hidden');
    box?.closest('.buy-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const name = document.getElementById('buy-name').value.trim();
  const phone = document.getElementById('buy-phone').value.trim();
  if (!name || !phone) {
    errEl.textContent = 'Nama dan nomor WhatsApp wajib diisi.';
    errEl.classList.remove('hidden');
    (name ? document.getElementById('buy-phone') : document.getElementById('buy-name')).focus();
    return;
  }

  const btn = document.getElementById('buy-submit');
  btn.disabled = true;
  btn.textContent = 'Memproses...';
  try {
    const res = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        currentSession?.access_token ? { Authorization: `Bearer ${currentSession.access_token}` } : {}
      ),
      body: JSON.stringify({
        product_id: buyProduct.id,
        quantity: buyQty,
        selected: buySel,
        buyer_name: name,
        buyer_phone: phone,
        buyer_note: document.getElementById('buy-note').value.trim(),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Gagal membuat pesanan.');

    saveBuyer(name, phone);
    saveOrderToLocal(body.data);
    showBuySuccess(body.data);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
    btn.disabled = false;
    updateSummary();
  }
}

function showBuySuccess(order) {
  const link = `pesanan.html?code=${encodeURIComponent(order.order_code)}&token=${encodeURIComponent(order.access_token)}`;
  document.getElementById('buy-root').innerHTML = `
    <div class="buy-wrap buy-done">
      <div class="buy-card buy-done-card">
        <span class="eyebrow">◆ Pesanan Dibuat</span>
        <h1>${ICONS.checkCircle} Pesanan kamu berhasil dibuat</h1>
        <p class="order-code-label">Kode pesanan kamu:</p>
        <p class="order-code-value mono">${escapeHtml(order.order_code)}</p>
        <p class="buy-done-item">${escapeHtml(order.product_name)} — <strong>${idr(order.product_price)}</strong></p>
        <p class="order-success-note">Simpan kode ini. Lanjutkan pesanan lewat chat langsung dengan admin.</p>
        <a class="btn btn-green brutal-sm hover-lift-sm" href="${link}">Buka Ruang Chat →</a>
        <a class="buy-back" href="belanja.html">Lanjut belanja</a>
      </div>
    </div>`;
  window.scrollTo({ top: 0 });
}

async function loadBuyPage() {
  const root = document.getElementById('buy-root');
  const id = new URLSearchParams(location.search).get('id');
  const fail = (msg) => {
    root.innerHTML = `<div class="pd-error"><p>${escapeHtml(msg)}</p><a class="btn btn-green brutal-sm" href="belanja.html">← Kembali ke Belanja</a></div>`;
  };
  if (!id) return fail('Produk tidak ditemukan.');
  try {
    const { data } = await fetchJSON(`${API_BASE}/products?id=${encodeURIComponent(id)}`);
    buyProduct = data;
  } catch (err) {
    return fail(/tidak ditemukan/i.test(err.message) ? 'Produk tidak ditemukan atau sudah tidak tersedia.' : `Gagal memuat produk: ${err.message}`);
  }
  // pra-pilih opsi pertama yang tersedia di tiap grup (seperti marketplace pada umumnya)
  optGroups().forEach((g) => {
    const first = g.values.find((v) => !v.sold_out);
    if (first) buySel[g.name] = first.label;
  });
  renderBuy();
}

document.addEventListener('DOMContentLoaded', loadBuyPage);
