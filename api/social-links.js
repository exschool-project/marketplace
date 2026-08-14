const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getUserFromRequest, requireOwner, roleLevel } = require('./_lib/auth');
const { withErrorHandling } = require('./_lib/http');

// Satu file untuk /api/social-links (list & create) DAN
// /api/social-links?id=xxx (update/hapus). GET boleh diakses siapa saja
// (dipakai footer beranda), tapi POST/PUT/DELETE KHUSUS OWNER — bukan
// admin biasa, sesuai permintaan ("diatur owner").
module.exports = withErrorHandling(async (req, res) => {
  const supabase = getSupabaseAdmin();
  const { id } = req.query;

  if (req.method === 'GET') {
    const ctx = await getUserFromRequest(req);
    const isOwner = roleLevel(ctx?.profile?.role) >= roleLevel('owner');

    let query = supabase
      .from('social_links')
      .select('*')
      .order('sort_order', { ascending: true });

    // Publik cuma lihat yang aktif; owner (di panel admin) lihat semua.
    if (!isOwner) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ data });
    return;
  }

  if (req.method === 'POST') {
    const ctx = await requireOwner(req, res);
    if (!ctx) return;

    const { platform, url, is_active = true, sort_order = 0 } = req.body || {};

    if (!platform || !String(platform).trim() || !url || !String(url).trim()) {
      res.status(400).json({ error: 'Nama platform dan URL wajib diisi.' });
      return;
    }

    const { data, error } = await supabase
      .from('social_links')
      .insert({
        platform: String(platform).trim(),
        url: String(url).trim(),
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
    const ctx = await requireOwner(req, res);
    if (!ctx) return;

    const { platform, url, is_active, sort_order } = req.body || {};
    const updates = {};
    if (platform !== undefined) updates.platform = String(platform).trim();
    if (url !== undefined) updates.url = String(url).trim();
    if (is_active !== undefined) updates.is_active = is_active;
    if (sort_order !== undefined) updates.sort_order = sort_order;

    const { data, error } = await supabase
      .from('social_links')
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
    const ctx = await requireOwner(req, res);
    if (!ctx) return;

    const { error } = await supabase.from('social_links').delete().eq('id', id);
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
