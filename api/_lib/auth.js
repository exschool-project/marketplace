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
  if (!token) {
    console.log('[auth] tidak ada Bearer token di header Authorization');
    return null;
  }

  const supabase = getSupabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    console.log('[auth] token tidak valid di Supabase:', userError?.message);
    return null;
  }
  console.log('[auth] user terverifikasi:', userData.user.id, userData.user.email);

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role, full_name')
    .eq('id', userData.user.id)
    .single();

  if (profileError || !profile) {
    console.log('[auth] profile TIDAK ditemukan untuk user ini:', profileError?.message);
    return null;
  }
  console.log('[auth] profile ditemukan, role mentah dari DB:', JSON.stringify(profile.role));

  return { user: userData.user, profile };
}

// Normalisasi role dari DB (jaga-jaga kalau tersimpan "OWNER", "Owner ", dst)
// supaya pencocokan ke ROLE_LEVEL tetap konsisten apapun format aslinya.
function roleLevel(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return ROLE_LEVEL[normalized] || 0;
}

/**
 * Wajib login DAN role-nya minimal `minRole` (mengikuti hierarki di atas).
 * Kalau tidak memenuhi, langsung mengirim response 401/403 dan
 * mengembalikan null — endpoint pemanggil cukup `return` setelahnya.
 */
async function requireRole(req, res, minRole) {
  const ctx = await getUserFromRequest(req);

  if (!ctx) {
    console.log('[auth] requireRole GAGAL: sesi tidak valid (auth gagal atau profile tidak ketemu)');
    res.status(401).json({ error: 'Sesi tidak valid. Silakan login kembali.' });
    return null;
  }

  const actual = roleLevel(ctx.profile.role);
  const required = roleLevel(minRole);
  console.log(`[auth] cek role: role="${ctx.profile.role}" (level ${actual}) vs minimal "${minRole}" (level ${required})`);

  if (actual < required) {
    console.log('[auth] requireRole GAGAL: role tidak cukup');
    res.status(403).json({ error: 'Akun ini tidak memiliki akses yang cukup.' });
    return null;
  }

  console.log('[auth] requireRole LOLOS');
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
