const { getUserFromRequest } = require('../_lib/auth');

// Beda dengan /api/auth/me (yang wajib admin): endpoint ini boleh diakses
// SEMUA akun yang sudah login, dipakai halaman akun publik untuk menyapa
// user dan menentukan apakah perlu menampilkan tautan ke Admin Panel.
module.exports = async (req, res) => {
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
};
