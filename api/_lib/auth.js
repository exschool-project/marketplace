const { getSupabaseAdmin } = require('./supabaseAdmin');

// Hierarki role: makin besar angkanya, makin tinggi aksesnya.
// member = akun publik biasa (pembeli), tanpa akses panel
// cs     = customer service — cuma boleh balas chat pesanan & ubah
//          status transaksi (lewat cs.html), TIDAK bisa kelola
//          produk/kategori/banner/tim (itu tetap khusus admin+)
// admin  = kelola konten (banner/kategori/produk) + semua akses cs
// owner  = pemilik tertinggi, bisa kelola admin & owner lain
const ROLE_LEVEL = { member: 1, cs: 2, admin: 3, owner: 4 };

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
    return { reason: 'no_token' };
  }

  const supabase = getSupabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    console.log('[auth] token tidak valid di Supabase:', userError?.message);
    return { reason: 'invalid_token' };
  }
  console.log('[auth] user terverifikasi:', userData.user.id, userData.user.email);

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role, full_name')
    .eq('id', userData.user.id)
    .single();

  if (profileError || !profile) {
    // Auth berhasil (token valid), tapi baris di tabel profiles tidak ada.
    // Ini beda kasus dari "belum login" — jangan disamakan pesannya.
    console.log('[auth] profile TIDAK ditemukan untuk user ini:', profileError?.message);
    return { reason: 'no_profile', user: userData.user };
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

  if (!ctx.profile) {
    if (ctx.reason === 'no_profile') {
      console.log('[auth] requireRole GAGAL: token valid tapi profile tidak ada di DB');
      res.status(401).json({
        error: 'Akun ini terverifikasi tapi datanya tidak ditemukan di tabel profiles. Hubungi owner untuk perbaikan data.',
      });
      return null;
    }
    console.log('[auth] requireRole GAGAL: sesi tidak valid (belum login / token tidak valid)');
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

/** Wajib cs, admin, ATAU owner (level cs ke atas) — dipakai endpoint
 * pesanan & chat (cs.html), yang boleh diakses tim CS tanpa perlu akses
 * penuh admin panel. */
async function requireCs(req, res) {
  return requireRole(req, res, 'cs');
}

/** Wajib owner — dipakai untuk endpoint sensitif seperti manajemen akun admin. */
async function requireOwner(req, res) {
  return requireRole(req, res, 'owner');
}

module.exports = {
  getUserFromRequest,
  requireAdmin,
  requireCs,
  requireOwner,
  requireRole,
  roleLevel,
  ROLE_LEVEL,
};
