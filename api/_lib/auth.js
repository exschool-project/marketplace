const { getSupabaseAdmin } = require('./supabaseAdmin');

// Hierarki role: makin besar angkanya, makin tinggi aksesnya.
// owner  = pemilik tertinggi, bisa kelola admin & owner lain
// admin  = kelola konten (banner/kategori/produk)
// member = akun publik biasa (pembeli), tanpa akses panel
const ROLE_LEVEL = { member: 1, admin: 2, owner: 3 };

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

function roleLevel(role) {
  return ROLE_LEVEL[role] || 0;
}

/**
 * Wajib login DAN role-nya minimal `minRole` (mengikuti hierarki di atas).
 * Kalau tidak memenuhi, langsung mengirim response 401/403 dan
 * mengembalikan null — endpoint pemanggil cukup `return` setelahnya.
 */
async function requireRole(req, res, minRole) {
  const ctx = await getUserFromRequest(req);

  if (!ctx) {
    res.status(401).json({ error: 'Sesi tidak valid. Silakan login kembali.' });
    return null;
  }

  if (roleLevel(ctx.profile.role) < roleLevel(minRole)) {
    res.status(403).json({ error: 'Akun ini tidak memiliki akses yang cukup.' });
    return null;
  }

  return ctx;
}

/** Wajib admin ATAU owner (level admin ke atas). */
async function requireAdmin(req, res) {
  return requireRole(req, res, 'admin');
}

/** Wajib owner — dipakai untuk endpoint sensitif seperti manajemen akun admin. */
async function requireOwner(req, res) {
  return requireRole(req, res, 'owner');
}

module.exports = {
  getUserFromRequest,
  requireAdmin,
  requireOwner,
  requireRole,
  roleLevel,
  ROLE_LEVEL,
};
