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
  if (!ctx) {
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
