const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getUserFromRequest, requireOwner, roleLevel } = require('./_lib/auth');
const { withErrorHandling } = require('./_lib/http');

// Satu file untuk /api/hero-banners (list & create) DAN
// /api/hero-banners?id=xxx (update/hapus). GET boleh diakses siapa saja
// (dipakai gambar banner di beranda), tapi POST/PUT/DELETE KHUSUS OWNER.
module.exports = withErrorHandling(async (req, res) => {
  const supabase = getSupabaseAdmin();
  const { id } = req.query;

  if (req.method === 'GET') {
    const ctx = await getUserFromRequest(req);
    const isOwner = roleLevel(ctx?.profile?.role) >= roleLevel('owner');

    let query = supabase
      .from('hero_banners')
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

    const { image_url, link_url, title, subtitle, is_active = true, sort_order = 0 } = req.body || {};

    if (!image_url || !String(image_url).trim()) {
      res.status(400).json({ error: 'Gambar banner wajib diunggah dulu.' });
      return;
    }

    const { data, error } = await supabase
      .from('hero_banners')
      .insert({
        image_url: String(image_url).trim(),
        link_url: link_url && String(link_url).trim() ? String(link_url).trim() : null,
        title: title && String(title).trim() ? String(title).trim() : null,
        subtitle: subtitle && String(subtitle).trim() ? String(subtitle).trim() : null,
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

    const { image_url, link_url, title, subtitle, is_active, sort_order } = req.body || {};
    const updates = {};
    if (image_url !== undefined) updates.image_url = String(image_url).trim();
    if (link_url !== undefined) updates.link_url = link_url ? String(link_url).trim() : null;
    if (title !== undefined) updates.title = title ? String(title).trim() : null;
    if (subtitle !== undefined) updates.subtitle = subtitle ? String(subtitle).trim() : null;
    if (is_active !== undefined) updates.is_active = is_active;
    if (sort_order !== undefined) updates.sort_order = sort_order;

    const { data, error } = await supabase
      .from('hero_banners')
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

    const { error } = await supabase.from('hero_banners').delete().eq('id', id);
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
