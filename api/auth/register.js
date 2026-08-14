const { withErrorHandling } = require('../_lib/http');

// PENDAFTARAN MANDIRI DITUTUP atas permintaan owner. Endpoint ini sengaja
// selalu menolak, supaya tidak ada yang bisa bikin akun sendiri lewat
// website — baik lewat form di akun.html maupun langsung panggil API ini.
//
// Akun baru sekarang HANYA bisa dibuat manual oleh owner lewat Supabase
// Dashboard (Authentication > Users > Add user), lalu insert baris di
// tabel `profiles` dengan role yang sesuai (member/admin/owner).
//
// Kalau nanti pendaftaran mau dibuka lagi, ganti REGISTRATION_OPEN
// jadi true dan kembalikan logic pembuatan akun (lihat riwayat git/versi
// sebelumnya untuk kode lengkapnya).
const REGISTRATION_OPEN = false;

module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!REGISTRATION_OPEN) {
    res.status(403).json({
      error: 'Pendaftaran akun baru saat ini ditutup. Hubungi admin/owner untuk dibuatkan akun.',
    });
    return;
  }
});
