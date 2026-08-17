const crypto = require('crypto');
const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { getUserFromRequest, roleLevel } = require('./_lib/auth');
const { withErrorHandling } = require('./_lib/http');

// Satu file menangani /api/orders (pesanan) DAN chat-nya sekaligus
// (?resource=messages), supaya jumlah Vercel Functions tetap hemat
// (lihat catatan yang sama di products.js).
//
// Pembeli TIDAK login (registrasi publik memang ditutup) — akses ke
// pesanan miliknya cukup dengan mencocokkan order_code + access_token
// yang dikirim balik sekali waktu pesanan dibuat. Admin/owner login
// biasa lewat Supabase Auth seperti panel lainnya.

const STATUSES = ['menunggu', 'diproses', 'dikirim', 'selesai', 'dibatalkan'];

function generateOrderCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa 0/O/1/I biar gak ketuker
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += chars[crypto.randomInt(0, chars.length)];
  }
  return `EXS-${code}`;
}

async function insertOrder(supabase, payload, attempt = 0) {
  const order_code = generateOrderCode();
  const { data, error } = await supabase
    .from('orders')
    .insert({ ...payload, order_code })
    .select('*')
    .single();

  if (error) {
    // 23505 = unique_violation di Postgres — kode kebetulan bentrok, coba lagi.
    if (error.code === '23505' && attempt < 5) {
      return insertOrder(supabase, payload, attempt + 1);
    }
    throw new Error(error.message);
  }
  return data;
}

/** Ambil ctx admin (getUserFromRequest) DAN cek levelnya, tanpa nulis response —
 * dipakai untuk endpoint yang boleh diakses admin ATAU pembeli (guest). */
async function getAdminCtxIfAny(req) {
  const ctx = await getUserFromRequest(req);
  if (ctx?.profile && roleLevel(ctx.profile.role) >= roleLevel('admin')) return ctx;
  return null;
}

/** Ambil 1 order & verifikasi akses: admin/owner (via token login) SELALU boleh;
 * pembeli guest wajib cocokkan order_code + access_token persis. */
async function loadOrderForAccess(supabase, { id, code, token }, adminCtx) {
  let query = supabase.from('orders').select('*');
  if (id) query = query.eq('id', id);
  else if (code) query = query.eq('order_code', String(code).trim().toUpperCase());
  else return { error: 'Parameter id atau code wajib diisi.', status: 400 };

  const { data: order, error } = await query.maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!order) return { error: 'Pesanan tidak ditemukan.', status: 404 };

  if (adminCtx) return { order };

  if (!token || String(token) !== String(order.access_token)) {
    return { error: 'Kode pesanan atau token akses salah.', status: 403 };
  }
  return { order };
}

module.exports = withErrorHandling(async (req, res) => {
  const supabase = getSupabaseAdmin();
  const isMessages = req.query.resource === 'messages';

  // =====================================================================
  // CHAT (/api/orders?resource=messages)
  // =====================================================================
  if (isMessages) {
    if (req.method === 'GET') {
      const { order_id, code, token } = req.query;
      const adminCtx = await getAdminCtxIfAny(req);

      const access = await loadOrderForAccess(supabase, { id: order_id, code, token }, adminCtx);
      if (access.error) {
        res.status(access.status).json({ error: access.error });
        return;
      }

      const { data, error } = await supabase
        .from('order_messages')
        .select('*')
        .eq('order_id', access.order.id)
        .order('created_at', { ascending: true });

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }
      res.status(200).json({ data, order: access.order });
      return;
    }

    if (req.method === 'POST') {
      const { order_id, code, token, message } = req.body || {};
      const text = String(message || '').trim();
      if (!text) {
        res.status(400).json({ error: 'Pesan tidak boleh kosong.' });
        return;
      }
      if (text.length > 2000) {
        res.status(400).json({ error: 'Pesan terlalu panjang (maks 2000 karakter).' });
        return;
      }

      const adminCtx = await getAdminCtxIfAny(req);
      const access = await loadOrderForAccess(supabase, { id: order_id, code, token }, adminCtx);
      if (access.error) {
        res.status(access.status).json({ error: access.error });
        return;
      }

      const sender_type = adminCtx ? 'admin' : 'buyer';
      const sender_name = adminCtx
        ? (adminCtx.profile.full_name || 'Admin')
        : access.order.buyer_name;

      const { data, error } = await supabase
        .from('order_messages')
        .insert({ order_id: access.order.id, sender_type, sender_name, message: text })
        .select('*')
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
    return;
  }

  // =====================================================================
  // PESANAN (/api/orders)
  // =====================================================================

  // ---------- GET satu pesanan (admin via ?id=, atau pembeli via ?code=&token=) ----------
  if (req.method === 'GET' && (req.query.id || req.query.code)) {
    const { id, code, token } = req.query;
    const adminCtx = await getAdminCtxIfAny(req);

    const access = await loadOrderForAccess(supabase, { id, code, token }, adminCtx);
    if (access.error) {
      res.status(access.status).json({ error: access.error });
      return;
    }
    res.status(200).json({ data: access.order });
    return;
  }

  // ---------- GET daftar pesanan (khusus admin/owner) ----------
  if (req.method === 'GET') {
    const adminCtx = await getAdminCtxIfAny(req);
    if (!adminCtx) {
      res.status(401).json({ error: 'Sesi tidak valid. Silakan login kembali.' });
      return;
    }

    let query = supabase.from('orders').select('*').order('created_at', { ascending: false });
    if (req.query.status) query = query.eq('status', req.query.status);

    const { data, error } = await query;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ data });
    return;
  }

  // ---------- POST — buat pesanan baru (publik, tanpa login) ----------
  if (req.method === 'POST') {
    const { product_id, buyer_name, buyer_phone, buyer_note } = req.body || {};

    if (!product_id) {
      res.status(400).json({ error: 'Produk wajib dipilih.' });
      return;
    }
    if (!buyer_name || !String(buyer_name).trim()) {
      res.status(400).json({ error: 'Nama wajib diisi.' });
      return;
    }
    if (!buyer_phone || !String(buyer_phone).trim()) {
      res.status(400).json({ error: 'Nomor WhatsApp wajib diisi.' });
      return;
    }

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, price, shop_name, is_active')
      .eq('id', product_id)
      .maybeSingle();

    if (productError) {
      res.status(500).json({ error: productError.message });
      return;
    }
    if (!product || !product.is_active) {
      res.status(404).json({ error: 'Produk tidak ditemukan atau sudah tidak tersedia.' });
      return;
    }

    const order = await insertOrder(supabase, {
      product_id: product.id,
      product_name: product.name,
      product_price: product.price,
      shop_name: product.shop_name,
      buyer_name: String(buyer_name).trim(),
      buyer_phone: String(buyer_phone).trim(),
      buyer_note: buyer_note && String(buyer_note).trim() ? String(buyer_note).trim() : null,
      status: 'menunggu',
    });

    await supabase.from('order_messages').insert({
      order_id: order.id,
      sender_type: 'system',
      sender_name: 'Sistem',
      message: `Pesanan ${order.order_code} dibuat untuk "${product.name}". Admin akan segera menghubungi kamu di sini.`,
    });

    res.status(201).json({ data: order });
    return;
  }

  // ---------- PUT — update status pesanan (khusus admin/owner) ----------
  if (req.method === 'PUT') {
    const { id } = req.query;
    if (!id) {
      res.status(400).json({ error: 'Parameter id wajib diisi.' });
      return;
    }
    const adminCtx = await getAdminCtxIfAny(req);
    if (!adminCtx) {
      res.status(401).json({ error: 'Sesi tidak valid. Silakan login kembali.' });
      return;
    }

    const { status } = req.body || {};
    if (!STATUSES.includes(status)) {
      res.status(400).json({ error: `Status harus salah satu dari: ${STATUSES.join(', ')}.` });
      return;
    }

    const { data, error } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    await supabase.from('order_messages').insert({
      order_id: id,
      sender_type: 'system',
      sender_name: 'Sistem',
      message: `Status pesanan diubah jadi "${status}" oleh ${adminCtx.profile.full_name || 'admin'}.`,
    });

    res.status(200).json({ data });
    return;
  }

  res.setHeader('Allow', 'GET, POST, PUT');
  res.status(405).json({ error: 'Method not allowed' });
});
