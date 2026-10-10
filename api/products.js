const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getUserFromRequest, requireAdmin, roleLevel } = require('./_lib/auth');
const { withErrorHandling } = require('./_lib/http');

const EDITABLE_FIELDS = [
  'name', 'shop_name', 'price', 'old_price',
  'icon', 'image_url', 'category_id', 'badge', 'is_active', 'sort_order', 'is_featured',
  'description', 'features', 'gallery', 'showcase', 'faq', 'delivery_time',
];

// ---------- Sanitasi field detail produk ----------
// Isi detail dikirim dari admin panel, tapi tetap divalidasi di server:
// URL harus http(s), teks dipotong, jumlah item dibatasi.
const isHttpUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v.trim());
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

function cleanDetailField(key, value) {
  if (value === null || value === undefined) {
    return key === 'description' || key === 'delivery_time' ? null : [];
  }
  switch (key) {
    case 'description': return clip(value, 5000) || null;
    case 'delivery_time': return clip(value, 80) || null;
    case 'features':
      return (Array.isArray(value) ? value : []).map((x) => clip(x, 160)).filter(Boolean).slice(0, 20);
    case 'gallery':
      return (Array.isArray(value) ? value : []).filter(isHttpUrl).map((u) => u.trim()).slice(0, 8);
    case 'showcase':
      return (Array.isArray(value) ? value : [])
        .filter((x) => x && isHttpUrl(x.url))
        .map((x) => ({ url: x.url.trim(), caption: clip(x.caption, 160) }))
        .slice(0, 12);
    case 'faq':
      return (Array.isArray(value) ? value : [])
        .map((x) => ({ q: clip(x && x.q, 200), a: clip(x && x.a, 800) }))
        .filter((x) => x.q && x.a)
        .slice(0, 12);
    default: return value;
  }
}
const DETAIL_FIELDS = ['description', 'features', 'gallery', 'showcase', 'faq', 'delivery_time'];

// Satu file menangani /api/products (list & create) DAN /api/products?id=xxx
// (ambil satu, update, hapus) — digabung supaya jumlah Vercel Functions
// tetap di bawah batas 12 pada paket Hobby.
module.exports = withErrorHandling(async (req, res) => {
  const supabase = getSupabaseAdmin();
  const { id } = req.query;

  // ---------- GET satu produk (?id=xxx) ----------
  if (req.method === 'GET' && id) {
    const ctx = await getUserFromRequest(req);
    const isAdmin = roleLevel(ctx?.profile?.role) >= roleLevel('admin');

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

  // ---------- GET list produk ----------
  if (req.method === 'GET') {
    const ctx = await getUserFromRequest(req);
    const isAdmin = roleLevel(ctx?.profile?.role) >= roleLevel('admin');
    const categorySlug = req.query.category;
    const onlyFeatured = req.query.featured === 'true';

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
    if (onlyFeatured) query = query.eq('is_featured', true);

    const { data, error } = await query;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ data });
    return;
  }

  // ---------- POST — buat produk baru ----------
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
        icon: icon && String(icon).trim() ? String(icon).trim() : '',
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

  // ---------- PUT — update produk (?id=xxx) ----------
  if (req.method === 'PUT') {
    if (!id) {
      res.status(400).json({ error: 'Parameter id wajib diisi.' });
      return;
    }
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;

    const body = req.body || {};
    const updates = {};
    EDITABLE_FIELDS.forEach((key) => {
      if (body[key] === undefined) return;
      updates[key] = DETAIL_FIELDS.includes(key) ? cleanDetailField(key, body[key]) : body[key];
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

  // ---------- DELETE — hapus produk (?id=xxx) ----------
  if (req.method === 'DELETE') {
    if (!id) {
      res.status(400).json({ error: 'Parameter id wajib diisi.' });
      return;
    }
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

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
});
