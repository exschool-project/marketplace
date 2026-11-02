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
          // hot = kategori di-pin admin (tampil paling atas dengan label Hot)
          hot: !!x.hot,
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


// ---------------------------------------------------------------------
// Link pendek & preview link (Open Graph)
// - Produk bisa dibuka lewat 8 karakter pertama id: /produk?id=c78e415f
// - /produk dilayani fungsi ini (lihat vercel.json) supaya WhatsApp,
//   Telegram, Facebook, dll. — yang tidak menjalankan JavaScript —
//   mendapat judul, deskripsi, harga, dan foto produk di tag <meta>.
// ---------------------------------------------------------------------
const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_ID = /^[0-9a-f]{8}$/i;
const SITE_NAME = 'EX-SCHOOL';

function isValidProductId(id) {
  return FULL_UUID.test(id) || SHORT_ID.test(id);
}

// id penuh -> cocok persis; id pendek -> cocok semua uuid berawalan itu
function applyIdFilter(query, id) {
  if (SHORT_ID.test(id)) {
    const p = id.toLowerCase();
    return query.gte('id', `${p}-0000-0000-0000-000000000000`).lte('id', `${p}-ffff-ffff-ffff-ffffffffffff`);
  }
  return query.eq('id', id);
}

const escAttr = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const idr = (n) => 'Rp' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// Foto Cloudinary dijadikan JPG ringan (lebar 1200) supaya cepat & pasti muncul di preview.
function ogImage(url) {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return '';
  if (/^https?:\/\/res\.cloudinary\.com\/.+\/image\/upload\//.test(u) && !/\/image\/upload\/[^/]*(f_|w_|c_)/.test(u)) {
    return u.replace('/image/upload/', '/image/upload/f_jpg,q_auto,c_limit,w_1200/');
  }
  return u;
}

function buildProductMeta(p, origin) {
  const plain = String(p.description || '').replace(/\s+/g, ' ').trim();
  const snippet = plain.length > 110 ? `${plain.slice(0, 110).trimEnd()}…` : plain;
  const price = idr(p.price);
  const description = `${snippet || `${p.name} di ${SITE_NAME}`} • ${price}`;
  const firstGallery = Array.isArray(p.gallery) && p.gallery.length ? p.gallery[0] : '';
  return {
    title: `${p.name} — ${SITE_NAME}`,
    description,
    url: `${origin}/produk?id=${String(p.id).slice(0, 8)}`,
    image: ogImage(p.image_url || firstGallery),
    price: Math.round(Number(p.price) || 0),
    name: p.name,
  };
}

function productMetaTags(m) {
  return [
    `<meta name="description" content="${escAttr(m.description)}">`,
    `<link rel="canonical" href="${escAttr(m.url)}">`,
    `<meta property="og:type" content="product">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:locale" content="id_ID">`,
    `<meta property="og:title" content="${escAttr(m.title)}">`,
    `<meta property="og:description" content="${escAttr(m.description)}">`,
    `<meta property="og:url" content="${escAttr(m.url)}">`,
    m.image ? `<meta property="og:image" content="${escAttr(m.image)}">` : '',
    m.image ? `<meta property="og:image:alt" content="${escAttr(m.name)}">` : '',
    m.price != null ? `<meta property="product:price:amount" content="${m.price}">` : '',
    m.price != null ? `<meta property="product:price:currency" content="IDR">` : '',
    `<meta name="twitter:card" content="${m.image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${escAttr(m.title)}">`,
    `<meta name="twitter:description" content="${escAttr(m.description)}">`,
    m.image ? `<meta name="twitter:image" content="${escAttr(m.image)}">` : '',
  ].filter(Boolean).join('\n');
}

// Halaman mungil khusus bot pembuat preview (WhatsApp, Telegram, Facebook, dll.).
// Tidak membaca file apa pun: cukup tag <meta> + sedikit teks. Orang biasa yang
// kebetulan mampir langsung diarahkan ke halaman produk lewat JavaScript.
function buildSharePage(m, humanPath) {
  const body = m.found
    ? `<h1>${escAttr(m.name)}</h1><p>${escAttr(m.description)}</p><p><a href="${escAttr(humanPath)}">Buka produk</a></p>`
    : `<h1>${escAttr(m.title)}</h1><p><a href="/">Ke beranda</a></p>`;
  const redirect = m.found
    ? `<script>if(!/bot|crawl|spider|facebook|whatsapp|telegram|twitter|slack|discord|preview|embed/i.test(navigator.userAgent)){location.replace(${JSON.stringify(humanPath)});}</script>`
    : '';
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escAttr(m.title)}</title>
${productMetaTags(m)}
</head>
<body style="font-family:system-ui,sans-serif;padding:24px;max-width:560px;margin:0 auto">
${body}
${redirect}
</body>
</html>`;
}

// Dilayani untuk bot lewat redirect di vercel.json (/produk -> /api/products?view=page&id=...)
// Tambahkan &debug=1 untuk melihat JSON diagnosa (apakah produk ditemukan, tag apa yang dibuat).
async function serveProductPage(req, res, supabase) {
  const id = String(req.query.id || '');
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0];
  const origin = `${proto}://${host}`;
  const diag = { idValid: isValidProductId(id), productFound: false, error: null };

  let meta = {
    found: false,
    title: `Produk tidak ditemukan — ${SITE_NAME}`,
    description: `Produk ini tidak tersedia di ${SITE_NAME}.`,
    url: `${origin}/produk${id ? `?id=${encodeURIComponent(id)}` : ''}`,
    image: '', price: null, name: SITE_NAME,
  };

  try {
    if (diag.idValid) {
      let query = supabase.from('products').select('*').eq('is_active', true);
      query = applyIdFilter(query, id);
      const { data, error } = await query.limit(1);
      if (error) diag.error = error.message;
      const product = data && data[0];
      if (product) {
        diag.productFound = true;
        meta = { ...buildProductMeta(product, origin), found: true };
      }
    }
  } catch (err) {
    diag.error = String(err && err.message || err);
    console.error('[produk page meta]', err);
  }

  if (req.query.debug === '1') {
    res.status(200).json({ ...diag, title: meta.title, description: meta.description, image: meta.image, url: meta.url });
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // cache singkat di CDN: bot preview tidak membebani database
  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
  res.status(200).send(buildSharePage(meta, `/produk?id=${String(id).slice(0, 8)}`));
}

// Satu file menangani /api/products (list & create) DAN /api/products?id=xxx
// (ambil satu, update, hapus) — digabung supaya jumlah Vercel Functions
// tetap di bawah batas 12 pada paket Hobby.
module.exports = withErrorHandling(async (req, res) => {
  const supabase = getSupabaseAdmin();
  const { id } = req.query;

  // ---------- Halaman /produk (di-rewrite dari vercel.json) ----------
  if (req.method === 'GET' && req.query.view === 'page') {
    await serveProductPage(req, res, supabase);
    return;
  }

  // ---------- GET satu produk (?id=xxx — id penuh atau 8 karakter pertama) ----------
  if (req.method === 'GET' && id) {
    if (!isValidProductId(String(id))) {
      res.status(404).json({ error: 'Produk tidak ditemukan.' });
      return;
    }
    const ctx = await getUserFromRequest(req);
    const isAdmin = roleLevel(ctx?.profile?.role) >= roleLevel('admin');

    let query = supabase
      .from('products')
      .select('*, category:categories(id, name, slug)');
    query = applyIdFilter(query, String(id));

    if (!isAdmin) query = query.eq('is_active', true);

    const { data: rows, error } = await query.limit(1);
    const data = rows && rows[0];
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

// dipakai untuk pengujian lokal
module.exports._test = { buildProductMeta, buildSharePage, applyIdFilter, isValidProductId, ogImage };
