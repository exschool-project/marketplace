// ---------------------------------------------------------------------
// i18n ringan buat teks statis (marketing copy) — bukan sistem
// penerjemah penuh. Cuma nerjemahin elemen yang dikasih atribut
// data-i18n / data-i18n-html / data-i18n-placeholder. Konten yang
// diisi dari database (nama produk, testimoni, dll) TIDAK ikut
// diterjemahkan otomatis — itu tetap bahasa apapun yang diketik owner.
//
// Load file ini SEBELUM script.js di halaman manapun yang punya
// elemen data-i18n / tombol .lang-switch.
// ---------------------------------------------------------------------
const I18N = {
  id: {
    'nav.search_placeholder': 'Cari produk atau jasa...',
    'nav.search_btn': 'Cari',
    'nav.shop': 'Belanja',
    'nav.login': 'Masuk',
    'nav.profile': 'Profil',
    'nav.history': 'Pesanan',

    'hero.title': 'EX-SCHOOL',
    'hero.cta': 'Mulai belanja',

    'trust.1_title': 'Kreator terverifikasi',
    'trust.1_desc': 'Dikurasi sebelum tayang',
    'trust.2_title': 'Chat langsung',
    'trust.2_desc': 'Tanya dan pantau pesanan',
    'trust.3_title': 'Uang kembali',
    'trust.3_desc': 'Jika hasil tak sesuai brief',

    'featured.title': 'Produk unggulan',
    'featured.cta': 'Lihat semua',
    'featured.empty': 'Belum ada produk unggulan.',

    'testi.title': 'Kata pembeli',

    'footer.shop': 'Belanja',
    'footer.order_history': 'Riwayat pesanan',
    'footer.copyright': '© 2026 EX-SCHOOL · Yayasan Aqilah Hidayah',

    'shop.breadcrumb_home': 'Beranda',
    'shop.title': 'Belanja',
  },
  en: {
    'nav.search_placeholder': 'Search products or services...',
    'nav.search_btn': 'Search',
    'nav.shop': 'Shop',
    'nav.login': 'Sign in',
    'nav.profile': 'Profile',
    'nav.history': 'Orders',

    'hero.title': 'EX-SCHOOL',
    'hero.cta': 'Start shopping',

    'trust.1_title': 'Verified creators',
    'trust.1_desc': 'Curated before listing',
    'trust.2_title': 'Direct chat',
    'trust.2_desc': 'Ask and track your order',
    'trust.3_title': 'Money back',
    'trust.3_desc': 'If the result misses the brief',

    'featured.title': 'Featured',
    'featured.cta': 'View all',
    'featured.empty': 'No featured products yet.',

    'testi.title': 'Customer reviews',

    'footer.shop': 'Shop',
    'footer.order_history': 'Order history',
    'footer.copyright': '© 2026 EX-SCHOOL · Yayasan Aqilah Hidayah',

    'shop.breadcrumb_home': 'Home',
    'shop.title': 'Shop',
  },
};

let currentLang = 'id';
try {
  const saved = localStorage.getItem('exschool_lang');
  if (saved === 'id' || saved === 'en') currentLang = saved;
} catch (e) { /* localStorage diblokir -> default ke id */ }

function t(key) {
  return (I18N[currentLang] && I18N[currentLang][key]) || I18N.id[key] || key;
}

function applyI18n() {
  document.documentElement.lang = currentLang;

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  document.querySelectorAll('.lang-switch button').forEach((b) => {
    b.classList.toggle('active', b.dataset.lang === currentLang);
  });
}

function setLang(lang) {
  if (lang !== 'id' && lang !== 'en') return;
  currentLang = lang;
  try { localStorage.setItem('exschool_lang', lang); } catch (e) { /* abaikan */ }
  applyI18n();
  // Kasih tau bagian lain (mis. script.js, buat teks tombol Profil/Masuk
  // yang gabung sama status login) kalau bahasa baru saja diganti.
  document.dispatchEvent(new CustomEvent('exschool:langchange', { detail: { lang } }));
}

document.addEventListener('DOMContentLoaded', () => {
  applyI18n();
  document.querySelectorAll('.lang-switch button').forEach((b) => {
    b.addEventListener('click', () => setLang(b.dataset.lang));
  });
});
