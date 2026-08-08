const { getSupabaseAdmin } = require('./supabaseAdmin');

/**
 * Membaca token Bearer dari header Authorization, memverifikasinya ke
 * Supabase Auth, lalu mengambil profile (termasuk role) user tersebut.
 * Tidak menulis response apa pun — dipakai untuk pengecekan opsional
 * (mis. GET publik yang perlu tahu apakah pemanggilnya admin atau bukan).
 *
 * Mengembalikan { user, profile } atau null.
 */
async function getUserFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const supabase = getSupabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) return null;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role, full_name')
    .eq('id', userData.user.id)
    .single();

  if (profileError || !profile) return null;

  return { user: userData.user, profile };
}

/**
 * Sama seperti getUserFromRequest, tapi WAJIB admin.
 * Kalau tidak admin, langsung mengirim response 401/403 dan
 * mengembalikan null — endpoint pemanggil cukup `return` setelahnya.
 */
async function requireAdmin(req, res) {
  const ctx = await getUserFromRequest(req);

  if (!ctx) {
    res.status(401).json({ error: 'Sesi tidak valid. Silakan login kembali.' });
    return null;
  }

  if (ctx.profile.role !== 'admin') {
    res.status(403).json({ error: 'Akun ini tidak memiliki akses admin.' });
    return null;
  }

  return ctx;
}

module.exports = { getUserFromRequest, requireAdmin };
