// ---------------------------------------------------------------------
// Logic khusus HALAMAN UTAMA (index.html) — profil Yayasan Aqilah Hidayah.
// Halaman ini TIDAK ada produk/keranjang/kategori, jadi jauh lebih ringan
// dari belanja.html. Butuh common.js sudah dimuat duluan.
// ---------------------------------------------------------------------

// ---------- Statistik singkat di section Beranda ----------
async function loadIntroStats() {
  const productsEl = document.getElementById('intro-stat-products');
  const categoriesEl = document.getElementById('intro-stat-categories');
  if (!productsEl && !categoriesEl) return;

  try {
    const [{ data: products }, { data: categories }] = await Promise.all([
      fetchJSON(`${API_BASE}/products`),
      fetchJSON(`${API_BASE}/categories`),
    ]);
    if (productsEl) productsEl.textContent = `${products?.length ?? 0}+`;
    if (categoriesEl) categoriesEl.textContent = `${categories?.length ?? 0}+`;
  } catch (err) {
    if (productsEl) productsEl.textContent = '–';
    if (categoriesEl) categoriesEl.textContent = '–';
  }
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  initNavAccountButton();
  loadIntroStats();
  loadSocialLinks();
});
