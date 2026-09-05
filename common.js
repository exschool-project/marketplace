// ---------------------------------------------------------------------
// Util & fungsi yang dipakai BERSAMA oleh halaman utama (index.html) dan
// halaman belanja (belanja.html) — supaya kode-nya nggak dobel di dua
// tempat. Load file ini SETELAH icons.js dan SEBELUM landing.js / script.js
// di halaman manapun yang butuh.
// ---------------------------------------------------------------------
const API_BASE = '/api';

// Sesi login (kalau ada) — dipakai buat nandain pesanan checkout punya
// akun siapa (opsional, checkout tanpa login tetap jalan normal). Diisi
// oleh initNavAccountButton() pas halaman dimuat. Cuma relevan di halaman
// belanja, tapi variabelnya global biar gampang diakses dari script manapun.
let currentSession = null;

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

// ---------- Nav: tombol Masuk -> Profil kalau udah login (dipakai di header
// index.html DAN belanja.html) ----------
async function initNavAccountButton() {
  const btn = document.getElementById('nav-account-btn');
  if (!window.supabase) return;

  try {
    const config = await fetchJSON(`${API_BASE}/config`);
    const supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    const { data } = await supabaseClient.auth.getSession();

    if (data.session) {
      currentSession = data.session;
      if (btn) {
        btn.innerHTML = `${ICONS.user} Profil`;
        btn.setAttribute('aria-label', 'Profil akun saya');
      }
    }
  } catch (err) {
    // Gagal cek sesi (mis. offline) -> biarkan tombol default "Masuk",
    // klik ke akun.html tetap kerja normal (dia cek sesi ulang di sana).
    // currentSession tetap null -> checkout jalan seperti biasa (guest).
  }
}

// ---------- Media Sosial (diatur owner lewat admin panel) — dipakai di
// footer kedua halaman ----------
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
