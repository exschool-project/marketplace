const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getUserFromRequest, requireAdmin, roleLevel } = require('./_lib/auth');
const { withErrorHandling } = require('./_lib/http');

const EDITABLE_FIELDS = [
  'name', 'shop_name', 'price', 'old_price',
  'icon', 'image_url', 'category_id', 'badge', 'is_active', 'sort_order', 'is_featured',
  'description', 'features', 'gallery', 'showcase', 'faq', 'delivery_time', 'options',
];

// ---------- Sanitasi field detail produk ----------
// Isi detail dikirim dari admin panel, tapi tetap divalidasi di server:
// URL harus http(s), teks dipotong, jumlah item dibatasi.
const isHttpUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v.trim());
// Batas teks dihitung dalam KATA (bukan karakter): maksimal MAX_WORDS kata untuk
// tiap kolom teks (deskripsi, tiap poin fitur, tiap FAQ, keterangan gambar, dll).
// Ubah angka ini kalau mau batas lain (mis. 2000). Melebihi batas -> ditolak
// dengan pesan jelas, TIDAK dipotong diam-diam.
const MAX_WORDS = 25000;
const MAX_CHARS_SAFETY = 500000; // pengaman teknis saja, bukan batas yang dilihat pengguna
const wordCount = (v) => (String(v ?? '').trim().match(/\S+/g) || []).length;
const clip = (v, label = 'Teks') => {
  const t = String(v ?? '').trim();
  if (wordCount(t) > MAX_WORDS) {
    const err = new Error(`${label} terlalu panjang: ${wordCount(t).toLocaleString('id-ID')} kata (maksimal ${MAX_WORDS.toLocaleString('id-ID')} kata).`);
    err.status = 400;
    throw err;
  }
  return t.slice(0, MAX_CHARS_SAFETY);
};

function cleanDetailField(key, value) {
  if (value === null || value === undefined) {
    return key === 'description' || key === 'delivery_time' ? null : [];
  }
  switch (key) {
    case 'description': return clip(value, 'Deskripsi') || null;
    case 'delivery_time': return clip(value, 'Estimasi pengerjaan') || null;
    case 'features':
      return (Array.isArray(value) ? value : []).map((x) => clip(x, 'Poin fitur')).filter(Boolean).slice(0, 100);
    case 'gallery':
      return (Array.isArray(value) ? value : []).filter(isHttpUrl).map((u) => u.trim()).slice(0, 30);
    case 'showcase':
      return (Array.isArray(value) ? value : [])
        .filter((x) => x && isHttpUrl(x.url))
        .map((x) => ({
          url: x.url.trim(),
          title: clip(x.title, 'Judul gambar'),
          // 'caption' = nama lama; dipakai sebagai deskripsi kalau belum ada
          description: clip(x.description ?? x.caption, 'Deskripsi gambar'),
          category: clip(x.category, 'Kategori dokumentasi'),
          // Sumber: hanya tautan http(s); skema lain (javascript:, data:) dibuang.
          source_url: isHttpUrl(x.source_url) ? x.source_url.trim() : '',
          source_label: clip(x.source_label, 'Nama sumber'),
        }))
        .slice(0, 50);
    case 'options': {
      // Pilihan/varian: maks 10 grup, 50 nilai per grup. Harga tambahan
      // harus angka >= 0. Nama grup & label unik (dipakai sebagai kunci saat checkout).
      const seenGroups = new Set();
      return (Array.isArray(value) ? value : []).map((g) => {
        const name = clip(g && g.name, 'Nama pilihan');
        const seen = new Set();
        const values = (Array.isArray(g && g.values) ? g.values : []).map((v) => {
          const label = clip(v && v.label, 'Label pilihan');
          const add = Number(v && v.price_add);
          const own = Number(v && v.price);
          return {
            label,
            price: Number.isFinite(own) && own > 0 ? Math.round(own) : 0,         // harga sendiri (0 = pakai harga produk)
            price_add: Number.isFinite(add) && add > 0 ? Math.round(add) : 0,     // tambahan harga
            sold_out: !!(v && v.sold_out),
          };
        }).filter((v) => v.label && !seen.has(v.label) && seen.add(v.label)).slice(0, 50);
        return { name, values };
      }).filter((g) => g.name && g.values.length && !seenGroups.has(g.name) && seenGroups.add(g.name)).slice(0, 10);
    }
    case 'faq':
      return (Array.isArray(value) ? value : [])
        .map((x) => ({ q: clip(x && x.q, 'Pertanyaan FAQ'), a: clip(x && x.a, 'Jawaban FAQ') }))
        .filter((x) => x.q && x.a)
        .slice(0, 50);
    default: return value;
  }
}
const DETAIL_FIELDS = ['description', 'features', 'gallery', 'showcase', 'faq', 'delivery_time', 'options'];

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
    try {
      EDITABLE_FIELDS.forEach((key) => {
        if (body[key] === undefined) return;
        updates[key] = DETAIL_FIELDS.includes(key) ? cleanDetailField(key, body[key]) : body[key];
      });
    } catch (e) {
      res.status(e.status || 400).json({ error: e.message });
      return;
    }

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
