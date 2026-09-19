const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getUserFromRequest, requireAdmin, roleLevel } = require('./_lib/auth');
const { withErrorHandling } = require('./_lib/http');

// Satu file untuk /api/testimonials (list & create) DAN
// /api/testimonials?id=xxx (update/hapus). GET boleh diakses siapa saja
// (dipakai section testimoni di beranda), tapi POST/PUT/DELETE khusus
// admin/owner. Kalau tabel belum ada (migrasi ADD_TESTIMONIALS.sql belum
// dijalankan), GET tetap balikin data kosong daripada bikin beranda error.
module.exports = withErrorHandling(async (req, res) => {
  const supabase = getSupabaseAdmin();
  const { id } = req.query;

  if (req.method === 'GET') {
    const ctx = await getUserFromRequest(req);
    const isStaff = roleLevel(ctx?.profile?.role) >= roleLevel('admin');

    let query = supabase
      .from('testimonials')
      .select('*')
      .order('sort_order', { ascending: true });

    // Publik cuma lihat yang aktif; admin/owner (di panel admin) lihat semua.
    if (!isStaff) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) {
      // 42P01 = undefined_table -> migrasi belum dijalankan. Jangan bikin
      // beranda error, anggap aja belum ada testimoni sama sekali.
      if (error.code === '42P01') {
        res.status(200).json({ data: [], migration_pending: true });
        return;
      }
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ data });
    return;
  }

  if (req.method === 'POST') {
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;

    const { author_name, author_role, quote, rating = 5, is_active = true, sort_order = 0 } = req.body || {};

    if (!author_name || !String(author_name).trim() || !quote || !String(quote).trim()) {
      res.status(400).json({ error: 'Nama & isi testimoni wajib diisi.' });
      return;
    }
    const ratingNum = Number(rating);
    if (!Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      res.status(400).json({ error: 'Rating harus angka 1–5.' });
      return;
    }

    const { data, error } = await supabase
      .from('testimonials')
      .insert({
        author_name: String(author_name).trim(),
        author_role: author_role && String(author_role).trim() ? String(author_role).trim() : null,
        quote: String(quote).trim(),
        rating: ratingNum,
        is_active,
        sort_order,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(201).json({ data });
    return;
  }

  if (req.method === 'PUT') {
    if (!id) {
      res.status(400).json({ error: 'Parameter id wajib diisi.' });
      return;
    }
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;

    const { author_name, author_role, quote, rating, is_active, sort_order } = req.body || {};
    const updates = {};
    if (author_name !== undefined) updates.author_name = String(author_name).trim();
    if (author_role !== undefined) updates.author_role = author_role && String(author_role).trim() ? String(author_role).trim() : null;
    if (quote !== undefined) updates.quote = String(quote).trim();
    if (rating !== undefined) {
      const ratingNum = Number(rating);
      if (!Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        res.status(400).json({ error: 'Rating harus angka 1–5.' });
        return;
      }
      updates.rating = ratingNum;
    }
    if (is_active !== undefined) updates.is_active = is_active;
    if (sort_order !== undefined) updates.sort_order = sort_order;

    const { data, error } = await supabase
      .from('testimonials')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ data });
    return;
  }

  if (req.method === 'DELETE') {
    if (!id) {
      res.status(400).json({ error: 'Parameter id wajib diisi.' });
      return;
    }
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;

    const { error } = await supabase.from('testimonials').delete().eq('id', id);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(204).end();
    return;
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
});
