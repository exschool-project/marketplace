const { getSupabaseAdmin } = require('../../_lib/supabaseAdmin');
const { requireOwner, ROLE_LEVEL } = require('../../_lib/auth');
const { withErrorHandling } = require('../../_lib/http');

module.exports = withErrorHandling(async (req, res) => {
  const { id } = req.query;
  const supabase = getSupabaseAdmin();

  if (req.method === 'PUT') {
    const ctx = await requireOwner(req, res);
    if (!ctx) return;

    const { role } = req.body || {};

    if (!role || !Object.prototype.hasOwnProperty.call(ROLE_LEVEL, role)) {
      res.status(400).json({ error: 'Role tidak valid. Gunakan member, admin, atau owner.' });
      return;
    }

    // Jangan sampai owner terakhir kehapus rolenya sendiri lewat panel ini.
    if (role !== 'owner') {
      const { data: target, error: targetError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', id)
        .single();

      if (targetError || !target) {
        res.status(404).json({ error: 'Akun tidak ditemukan.' });
        return;
      }

      if (target.role === 'owner') {
        const { count, error: countError } = await supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'owner');

        if (countError) {
          res.status(500).json({ error: countError.message });
          return;
        }
        if ((count || 0) <= 1) {
          res.status(400).json({ error: 'Tidak bisa menurunkan role owner terakhir. Jadikan akun lain owner dulu.' });
          return;
        }
      }
    }

    const { data, error } = await supabase
      .from('profiles')
      .update({ role })
      .eq('id', id)
      .select('id, full_name, role')
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ data });
    return;
  }

  res.setHeader('Allow', 'PUT');
  res.status(405).json({ error: 'Method not allowed' });
});
