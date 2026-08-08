const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { getUserFromRequest, requireAdmin } = require('../_lib/auth');

const EDITABLE_FIELDS = [
  'name', 'shop_name', 'price', 'old_price',
  'icon', 'category_id', 'badge', 'is_active', 'sort_order',
];

module.exports = async (req, res) => {
  const { id } = req.query;
  const supabase = getSupabaseAdmin();

  if (req.method === 'GET') {
    const ctx = await getUserFromRequest(req);
    const isAdmin = ctx?.profile?.role === 'admin';

    let query = supabase
      .from('products')
      .select('*, category:categories(id, name, slug)')
      .eq('id', id);

    if (!isAdmin) query = query.eq('is_active', true);

    const { data, error } = await query.maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ error: 'Produk tidak ditemukan.' });
      return;
    }
    res.status(200).json({ data });
    return;
  }

  if (req.method === 'PUT') {
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;

    const body = req.body || {};
    const updates = {};
    EDITABLE_FIELDS.forEach((key) => {
      if (body[key] !== undefined) updates[key] = body[key];
    });

    const { data, error } = await supabase
      .from('products')
      .update(updates)
      .eq('id', id)
      .select('*, category:categories(id, name, slug)')
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ data });
    return;
  }

  if (req.method === 'DELETE') {
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;

    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(204).end();
    return;
  }

  res.setHeader('Allow', 'GET, PUT, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
};
