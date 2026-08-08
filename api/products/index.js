const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { getUserFromRequest, requireAdmin, roleLevel } = require('../_lib/auth');

module.exports = async (req, res) => {
  const supabase = getSupabaseAdmin();

  if (req.method === 'GET') {
    const ctx = await getUserFromRequest(req);
    const isAdmin = roleLevel(ctx?.profile?.role) >= roleLevel('admin');
    const categorySlug = req.query.category;

    let categoryId = null;
    if (categorySlug && categorySlug !== 'semua') {
      const { data: cat } = await supabase
        .from('categories')
        .select('id')
        .eq('slug', categorySlug)
        .maybeSingle();

      if (!cat) {
        res.status(200).json({ data: [] });
        return;
      }
      categoryId = cat.id;
    }

    let query = supabase
      .from('products')
      .select('*, category:categories(id, name, slug)')
      .order('sort_order', { ascending: true });

    if (!isAdmin) query = query.eq('is_active', true);
    if (categoryId) query = query.eq('category_id', categoryId);

    const { data, error } = await query;
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

    const {
      name, shop_name, price, old_price,
      icon, image_url, category_id, badge, is_active, sort_order,
    } = req.body || {};

    if (!name || !String(name).trim() || !shop_name || !String(shop_name).trim() || price === undefined || price === '') {
      res.status(400).json({ error: 'Nama produk, nama toko, dan harga wajib diisi.' });
      return;
    }

    const { data, error } = await supabase
      .from('products')
      .insert({
        name: String(name).trim(),
        shop_name: String(shop_name).trim(),
        price: Number(price),
        old_price: old_price === undefined || old_price === '' ? null : Number(old_price),
        icon: icon && String(icon).trim() ? String(icon).trim() : '📦',
        image_url: image_url && String(image_url).trim() ? String(image_url).trim() : null,
        category_id: category_id || null,
        badge: badge && String(badge).trim() ? String(badge).trim() : null,
        is_active: is_active ?? true,
        sort_order: sort_order ?? 0,
      })
      .select('*, category:categories(id, name, slug)')
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(201).json({ data });
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: 'Method not allowed' });
};