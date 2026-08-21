const { getUserFromRequest } = require('../_lib/auth');
const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { withErrorHandling } = require('../_lib/http');

// Endpoint ini boleh diakses SEMUA akun yang sudah login (bukan cuma
// admin/owner) — dipakai baik oleh akun.html (halaman publik) maupun
// admin.html. Pengecekan "role-nya cukup atau tidak untuk buka panel
// admin" dilakukan di sisi client (admin.js), BUKAN di endpoint ini —
// supaya satu function ini bisa dipakai bersama & hemat kuota Vercel
// Functions. Ini aman karena semua endpoint yang benar-benar mengubah
// data (produk/kategori/banner/dll) tetap divalidasi role-nya sendiri
// di server lewat requireAdmin/requireOwner.
//
// GET   -> ambil profil (nama, email, role, kontak opsional)
// PATCH -> user login mengubah profilnya SENDIRI: nama, email, dan
//          kontak opsional (WhatsApp / kontak lain). Ganti email pakai
//          Supabase Admin API (service role) langsung dengan
//          email_confirm:true — situs ini belum ada SMTP custom, jadi
//          samain polanya dengan register.js supaya nggak nyangkut di
//          alur verifikasi email default Supabase.
//
// CATATAN: kolom phone & other_contact query-nya TERPISAH dari
// getUserFromRequest (yang dipakai HAMPIR SEMUA endpoint lain di situs
// ini buat cek role). Sengaja dipisah supaya kalau migrasi
// ADD_PROFILE_CONTACT.sql belum dijalankan, yang error cuma fitur
// kontak opsional di halaman Profil ini — BUKAN seluruh sistem login.
async function getContactFields(userId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('profiles')
    .select('phone, other_contact')
    .eq('id', userId)
    .single();
  if (error) {
    // Kolom belum ada (migrasi belum jalan) atau error lain -> jangan
    // bikin seluruh halaman Profil gagal, cukup kosongkan kontaknya.
    return { phone: '', other_contact: '' };
  }
  return { phone: data.phone || '', other_contact: data.other_contact || '' };
}

module.exports = withErrorHandling(async (req, res) => {
  if (req.method === 'GET') {
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

    const contact = await getContactFields(ctx.user.id);

    res.status(200).json({
      id: ctx.user.id,
      email: ctx.user.email,
      full_name: ctx.profile.full_name,
      role: ctx.profile.role,
      phone: contact.phone,
      other_contact: contact.other_contact,
    });
    return;
  }

  if (req.method === 'PATCH') {
    const ctx = await getUserFromRequest(req);

    if (!ctx.profile) {
      if (ctx.reason === 'no_profile') {
        res.status(401).json({
          error: 'Akun ini terverifikasi tapi datanya tidak ditemukan di tabel profiles. Hubungi owner untuk perbaikan data.',
        });
        return;
      }
      res.status(401).json({ error: 'Sesi tidak valid. Silakan masuk kembali.' });
      return;
    }

    const { full_name, email, phone, other_contact } = req.body || {};

    const trimmedName = String(full_name ?? '').trim();
    const trimmedEmail = String(email ?? '').trim().toLowerCase();
    const trimmedPhone = String(phone ?? '').trim();
    const trimmedOtherContact = String(other_contact ?? '').trim();

    if (!trimmedName) {
      res.status(400).json({ error: 'Nama lengkap wajib diisi.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      res.status(400).json({ error: 'Format email tidak valid.' });
      return;
    }

    const supabase = getSupabaseAdmin();
    const userId = ctx.user.id;
    const emailChanged = trimmedEmail !== String(ctx.user.email || '').trim().toLowerCase();

    // Ganti email dulu (kalau berubah) SEBELUM update tabel profiles,
    // supaya kalau email-nya ternyata sudah dipakai akun lain, tabel
    // profiles nggak keburu ke-update jadi data nggak sinkron.
    if (emailChanged) {
      const { error: emailError } = await supabase.auth.admin.updateUserById(userId, {
        email: trimmedEmail,
        email_confirm: true,
      });
      if (emailError) {
        const msg = /already.*registered|already exists|already been registered/i.test(emailError.message)
          ? 'Email ini sudah dipakai akun lain.'
          : emailError.message;
        res.status(400).json({ error: msg });
        return;
      }
    }

    // Update nama selalu jalan. Update phone/other_contact dicoba
    // terpisah & gagalnya "silent" kalau kolomnya belum ada di DB
    // (migrasi ADD_PROFILE_CONTACT.sql belum dijalankan) — biar ganti
    // nama & email tetap sukses walau kontak opsional belum bisa disimpan.
    const { error: nameError } = await supabase
      .from('profiles')
      .update({ full_name: trimmedName })
      .eq('id', userId);

    if (nameError) {
      res.status(500).json({ error: `Gagal menyimpan profil: ${nameError.message}` });
      return;
    }

    let contactSaved = true;
    const { error: contactError } = await supabase
      .from('profiles')
      .update({ phone: trimmedPhone || null, other_contact: trimmedOtherContact || null })
      .eq('id', userId);
    if (contactError) contactSaved = false;

    const contact = contactSaved
      ? { phone: trimmedPhone, other_contact: trimmedOtherContact }
      : await getContactFields(userId);

    res.status(200).json({
      id: userId,
      email: trimmedEmail,
      full_name: trimmedName,
      role: ctx.profile.role,
      phone: contact.phone,
      other_contact: contact.other_contact,
      email_changed: emailChanged,
      contact_saved: contactSaved,
    });
    return;
  }

  res.setHeader('Allow', 'GET, PATCH');
  res.status(405).json({ error: 'Method not allowed' });
});
