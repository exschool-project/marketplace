const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { getUserFromRequest, requireAdmin, roleLevel } = require('../_lib/auth');
const { withErrorHandling } = require('../_lib/http');

module.exports = withErrorHandling(async (req, res) => {
  const supabase = getSupabaseAdmin();

  if (req.method === 'GET') {
    const ctx = await getUserFromRequest(req);
    const isAdmin = roleLevel(ctx?.profile?.role) >= roleLevel('admin');

    let query = supabase
      .from('banner_messages')
      .select('*')
      .order('sort_order', { ascending: true });

    if (!isAdmin) query = query.eq('is_active', true);

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

    const { message, is_active = true, sort_order = 0 } = req.body || {};

    if (!message || !String(message).trim()) {
      res.status(400).json({ error: 'Isi pesan banner wajib diisi.' });
      return;
    }

    const { data, error } = await supabase
      .from('banner_messages')
      .insert({ message: String(message).trim(), is_active, sort_order })
      .select()
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
});
