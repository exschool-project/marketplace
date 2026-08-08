const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { requireAdmin } = require('../_lib/auth');

module.exports = async (req, res) => {
  const supabase = getSupabaseAdmin();

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

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: 'Method not allowed' });
};