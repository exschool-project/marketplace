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
    'nav.search_placeholder': 'Cari produk atau jasa digital...',
    'nav.search_btn': 'CARI',
    'nav.shop': 'Belanja',
    'nav.login': 'Masuk',
    'nav.profile': 'Profil',
    'nav.history': 'Riwayat',

    'hero.eyebrow': '◆ Beranda',
    'hero.title': 'Selamat Datang di <span class="hl">EX-SCHOOL</span>',
    'hero.lead': 'Marketplace jasa & produk digital pilihan — desain, website, dan karya digital lainnya dari kreator terpercaya, dikerjakan cepat dan hasilnya sesuai brief.',
    'hero.cta': 'Mulai Belanja',

    'stats.item1_label': 'Kreator terpercaya',
    'stats.item2_label': 'Produk digital',
    'stats.item3_label': 'Chat langsung',
    'stats.item4_label': 'Rating rata-rata',

    'intro.eyebrow': '◆ Tentang Kami',
    'intro.title': 'Marketplace jasa & produk digital tepercaya',
    'intro.p1': 'EX-SCHOOL dibangun oleh Yayasan Aqilah Hidayah jadi tempat cari jasa & produk digital berkualitas — dari desain logo, pembuatan website, sampai karya digital lainnya, langsung dari kreator terpercaya.',
    'intro.p2': 'Setiap transaksi langsung ke kreator, tanpa potongan berlapis dan tanpa proses ribet — pesan, chat langsung sama admin/kreator, dan pantau statusnya sampai selesai di satu tempat.',
    'intro.point1_title': 'Kurasi ketat',
    'intro.point1_desc': 'Setiap kreator & jasa yang tayang sudah diverifikasi dulu, jadi kualitasnya terjaga.',
    'intro.point2_title': 'Chat langsung',
    'intro.point2_desc': 'Nggak perlu pindah aplikasi — tanya, revisi, sampai lacak pesanan lewat chat di sini.',
    'intro.point3_title': 'Transparan',
    'intro.point3_desc': 'Harga jujur, status pesanan jelas, dan riwayat pesanan tersimpan rapi di akun kamu.',

    'featured.eyebrow': '◆ Produk Unggulan',
    'featured.title': 'Produk paling laris',
    'featured.sub': 'Pilihan produk digital dengan permintaan tertinggi.',
    'featured.cta': 'Lihat Semua Produk →',
    'featured.empty': 'Belum ada produk unggulan saat ini.',

    'why.title': 'Kenapa pakai EX-SCHOOL',
    'why.sub': 'Bukan cuma marketplace, ini rumah buat kreator digital lokal.',
    'why.card1_num': '01 / Kecepatan',
    'why.card1_title': 'Pengerjaan cepat',
    'why.card1_desc': 'Sebagian besar pesanan jasa digital selesai dalam hitungan hari, bukan minggu.',
    'why.card2_num': '02 / Jaminan',
    'why.card2_title': 'Uang kembali 100%',
    'why.card2_desc': 'Hasil nggak sesuai brief? Ajukan komplain dan dana otomatis balik ke kamu.',
    'why.card3_num': '03 / Kreator',
    'why.card3_title': 'Kreator terverifikasi',
    'why.card3_desc': 'Setiap kreator & jasa yang tayang sudah lewat proses verifikasi kami.',

    'testi.title': 'Kata mereka yang udah pakai jasa kami',
    'testi.sub': 'Testimoni asli dari pembeli EX-SCHOOL.',

    'cta.title': 'Siap belanja?',
    'cta.sub': 'Ratusan jasa & produk digital dari kreator terpercaya nunggu buat kamu jelajahi.',
    'cta.btn': 'Lihat Semua Produk →',

    'footer.desc': 'Marketplace jasa & produk digital dari kreator-kreator terpercaya.',
    'footer.shop_heading': 'Belanja',
    'footer.category': 'Kategori',
    'footer.all_products': 'Semua Produk',
    'footer.help_heading': 'Bantuan',
    'footer.help_center': 'Pusat Bantuan',
    'footer.order_history': 'Riwayat Pesanan',
    'footer.company_heading': 'Perusahaan',
    'footer.about': 'Tentang Kami',
    'footer.copyright': '© 2026 EX-SCHOOL — Yayasan Aqilah Hidayah. Semua hak dilindungi.',
    'footer.credit': 'Dibuat exschool-project',

    'shop.breadcrumb_home': 'Beranda',
    'shop.breadcrumb_current': 'Belanja',
    'shop.title': 'Belanja',
    'shop.sub': 'Semua jasa & produk digital dari kreator terpercaya — kualitas terjamin, harga jujur.',
  },
  en: {
    'nav.search_placeholder': 'Search digital products or services...',
    'nav.search_btn': 'SEARCH',
    'nav.shop': 'Shop',
    'nav.login': 'Sign In',
    'nav.profile': 'Profile',
    'nav.history': 'Orders',

    'hero.eyebrow': '◆ Home',
    'hero.title': 'Welcome to <span class="hl">EX-SCHOOL</span>',
    'hero.lead': 'A curated marketplace for digital products & services — design, websites, and more from trusted creators, delivered fast and exactly to brief.',
    'hero.cta': 'Start Shopping',

    'stats.item1_label': 'Trusted creators',
    'stats.item2_label': 'Digital products',
    'stats.item3_label': 'Live chat',
    'stats.item4_label': 'Average rating',

    'intro.eyebrow': '◆ About Us',
    'intro.title': 'A trusted marketplace for digital products & services',
    'intro.p1': 'EX-SCHOOL was built by Yayasan Aqilah Hidayah as a place to find quality digital products & services — from logo design to website development and more, straight from trusted creators.',
    'intro.p2': 'Every transaction goes straight to the creator, with no hidden fees and no complicated process — order, chat directly with the admin/creator, and track your order status all in one place.',
    'intro.point1_title': 'Strict curation',
    'intro.point1_desc': 'Every creator & service listed is verified first, so quality stays consistent.',
    'intro.point2_title': 'Direct chat',
    'intro.point2_desc': 'No need to switch apps — ask questions, request revisions, and track orders right here.',
    'intro.point3_title': 'Transparent',
    'intro.point3_desc': 'Honest pricing, clear order status, and your order history neatly saved in your account.',

    'featured.eyebrow': '◆ Featured',
    'featured.title': 'Top products',
    'featured.sub': 'Our most in-demand digital products.',
    'featured.cta': 'View All Products →',
    'featured.empty': 'No featured products yet.',

    'why.title': 'Why choose EX-SCHOOL',
    'why.sub': 'Not just a marketplace — a home for local digital creators.',
    'why.card1_num': '01 / Speed',
    'why.card1_title': 'Fast turnaround',
    'why.card1_desc': 'Most digital service orders are completed in days, not weeks.',
    'why.card2_num': '02 / Guarantee',
    'why.card2_title': '100% money back',
    'why.card2_desc': "Result doesn't match the brief? File a complaint and your money is refunded automatically.",
    'why.card3_num': '03 / Creators',
    'why.card3_title': 'Verified creators',
    'why.card3_desc': 'Every creator & service listed has passed our verification process.',

    'testi.title': 'What our customers say',
    'testi.sub': 'Real testimonials from EX-SCHOOL customers.',

    'cta.title': 'Ready to shop?',
    'cta.sub': 'Hundreds of digital products & services from trusted creators are waiting for you.',
    'cta.btn': 'View All Products →',

    'footer.desc': 'A marketplace for digital products & services from trusted creators.',
    'footer.shop_heading': 'Shop',
    'footer.category': 'Categories',
    'footer.all_products': 'All Products',
    'footer.help_heading': 'Help',
    'footer.help_center': 'Help Center',
    'footer.order_history': 'Order History',
    'footer.company_heading': 'Company',
    'footer.about': 'About Us',
    'footer.copyright': '© 2026 EX-SCHOOL — Yayasan Aqilah Hidayah. All rights reserved.',
    'footer.credit': 'Made by exschool-project',

    'shop.breadcrumb_home': 'Home',
    'shop.breadcrumb_current': 'Shop',
    'shop.title': 'Shop',
    'shop.sub': 'All digital products & services from trusted creators — guaranteed quality, honest pricing.',
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
