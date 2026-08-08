const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');

// Endpoint publik untuk daftar akun baru (calon pembeli).
// SELALU membuat akun dengan role 'member' — tidak pernah admin/owner.
// Role admin/owner hanya bisa diberikan lewat panel Manajemen Tim (owner).
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { email, password, full_name } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();

  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    res.status(400).json({ error: 'Masukkan alamat email yang valid.' });
    return;
  }
  if (!password || String(password).length < 6) {
    res.status(400).json({ error: 'Kata sandi minimal 6 karakter.' });
    return;
  }

  const supabase = getSupabaseAdmin();

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: cleanEmail,
    password: String(password),
    email_confirm: true,
    user_metadata: { full_name: full_name ? String(full_name).trim() : null },
  });

  if (createError) {
    const message = /already registered|already exists|duplicate/i.test(createError.message)
      ? 'Email ini sudah terdaftar. Coba masuk saja.'
      : createError.message;
    res.status(400).json({ error: message });
    return;
  }

  const userId = created.user.id;

  const { error: profileError } = await supabase
    .from('profiles')
    .upsert({
      id: userId,
      full_name: full_name ? String(full_name).trim() : null,
      role: 'member',
    });

  if (profileError) {
    res.status(500).json({ error: `Akun dibuat, tapi profil gagal disimpan: ${profileError.message}` });
    return;
  }

  res.status(201).json({ message: 'Akun berhasil dibuat. Silakan masuk.' });
};
