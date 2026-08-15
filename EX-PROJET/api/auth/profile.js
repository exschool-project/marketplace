const { getUserFromRequest } = require('../_lib/auth');
const { withErrorHandling } = require('../_lib/http');

// Endpoint ini boleh diakses SEMUA akun yang sudah login (bukan cuma
// admin/owner) — dipakai baik oleh akun.html (halaman publik) maupun
// admin.html. Pengecekan "role-nya cukup atau tidak untuk buka panel
// admin" dilakukan di sisi client (admin.js), BUKAN di endpoint ini —
// supaya satu function ini bisa dipakai bersama & hemat kuota Vercel
// Functions. Ini aman karena semua endpoint yang benar-benar mengubah
// data (produk/kategori/banner/dll) tetap divalidasi role-nya sendiri
// di server lewat requireAdmin/requireOwner.
module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const ctx = await getUserFromRequest(req);

  if (!ctx.profile) {
    // Beda pesan tergantung penyebabnya, biar jelas di sisi client:
    // - belum login sama sekali / token expired -> minta login lagi
    // - token valid tapi baris di tabel profiles tidak ada -> masalah data,
    //   bukan masalah sesi, jadi jangan minta "login lagi" (bakal loop sia-sia)
    if (ctx.reason === 'no_profile') {
      res.status(401).json({
        error: 'Akun ini terverifikasi tapi datanya tidak ditemukan di tabel profiles. Hubungi owner untuk perbaikan data.',
      });
      return;
    }
    res.status(401).json({ error: 'Sesi tidak valid. Silakan masuk kembali.' });
    return;
  }

  res.status(200).json({
    id: ctx.user.id,
    email: ctx.user.email,
    full_name: ctx.profile.full_name,
    role: ctx.profile.role,
  });
});
