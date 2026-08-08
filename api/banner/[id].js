const { getSupabaseAdmin } = require('../_lib/supabaseAdmin');
const { requireAdmin } = require('../_lib/auth');

module.exports = async (req, res) => {
  const { id } = req.query;
  const supabase = getSupabaseAdmin();

  if (req.method === 'PUT') {
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;

    const { message, is_active, sort_order } = req.body || {};
    const updates = {};
    if (message !== undefined) updates.message = String(message).trim();
    if (is_active !== undefined) updates.is_active = is_active;
    if (sort_order !== undefined) updates.sort_order = sort_order;

    const { data, error } = await supabase
      .from('banner_messages')
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
    const ctx = await requireAdmin(req, res);
    if (!ctx) return;

    const { error } = await supabase.from('banner_messages').delete().eq('id', id);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(204).end();
    return;
  }

  res.setHeader('Allow', 'PUT, DELETE');
  res.status(405).json({ error: 'Method not allowed' });
};