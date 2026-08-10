const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { requireAdmin } = require('../_lib/auth');
const { withErrorHandling } = require('../_lib/http');

// Satu file untuk /api/categories (list & create) DAN /api/categories?id=xxx
// (update/hapus) — digabung supaya hemat kuota Vercel Functions.
module.exports = withErrorHandling(async (req, res) => {
  const supabase = getSupabaseAdmin();
  const { id } = req.query;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ data });
    return;
  }

  if (req.method === 'POST') {
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;

    const { name, slug, sort_order = 0 } = req.body || {};

    if (!name || !String(name).trim() || !slug || !String(slug).trim()) {
      res.status(400).json({ error: 'Nama dan slug kategori wajib diisi.' });
      return;
    }

    const { data, error } = await supabase
      .from('categories')
      .insert({ name: String(name).trim(), slug: String(slug).trim(), sort_order })
      .select()
      .single();

    if (error) {
      const message = error.code === '23505'
        ? 'Slug kategori sudah dipakai, gunakan nama lain.'
        : error.message;
      res.status(400).json({ error: message });
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

    const { name, slug, sort_order } = req.body || {};
    const updates = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (slug !== undefined) updates.slug = String(slug).trim();
    if (sort_order !== undefined) updates.sort_order = sort_order;

    const { data, error } = await supabase
      .from('categories')
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

    const { error } = await supabase.from('categories').delete().eq('id', id);
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
