const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { withErrorHandling } = require('../_lib/http');

// Pendaftaran akun publik — DIBUKA lagi atas permintaan owner.
// Akun baru selalu dibuat dengan role 'member' (paling rendah); kalau
// perlu jadi cs/admin/owner, naikkan manual lewat panel Manajemen Tim
// di admin.html (khusus owner).
//
// Pakai Supabase Admin API (service role) supaya akun langsung
// ter-konfirmasi (email_confirm: true) — situs ini belum ada setup
// SMTP custom, jadi kalau pakai signUp() biasa dari client, orang harus
// klik link verifikasi email yang templatenya masih default Supabase.
module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { full_name, email, password } = req.body || {};

  const trimmedName = String(full_name || '').trim();
  const trimmedEmail = String(email || '').trim().toLowerCase();

  if (!trimmedName) {
    res.status(400).json({ error: 'Nama lengkap wajib diisi.' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    res.status(400).json({ error: 'Format email tidak valid.' });
    return;
  }
  if (!password || String(password).length < 6) {
    res.status(400).json({ error: 'Kata sandi minimal 6 karakter.' });
    return;
  }

  const supabase = getSupabaseAdmin();

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: trimmedEmail,
    password: String(password),
    email_confirm: true,
    user_metadata: { full_name: trimmedName },
  });

  if (createError) {
    const msg = /already.*registered|already exists/i.test(createError.message)
      ? 'Email ini sudah terdaftar. Coba masuk lewat form Masuk.'
      : createError.message;
    res.status(400).json({ error: msg });
    return;
  }

  const userId = created.user.id;

  // Upsert (bukan insert biasa) — jaga-jaga kalau ada trigger Supabase lain
  // yang sudah bikin baris profiles kosong duluan begitu auth user dibuat.
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .upsert({ id: userId, full_name: trimmedName, role: 'member' }, { onConflict: 'id' })
    .select('id, full_name, role')
    .single();

  if (profileError) {
    // Akun auth-nya sudah terlanjur dibuat tapi baris profiles gagal —
    // hapus lagi akun auth-nya biar tidak jadi akun "nyangkut" tanpa profil.
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    res.status(500).json({ error: `Gagal menyimpan profil: ${profileError.message}` });
    return;
  }

  res.status(201).json({
    data: { id: profile.id, full_name: profile.full_name, role: profile.role, email: trimmedEmail },
  });
});
