const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');
const { requireOwner, ROLE_LEVEL } = require('./_lib/auth');
const { withErrorHandling } = require('./_lib/http');

// Satu file untuk /api/admin-users (list) DAN /api/admin-users?id=xxx
// (ubah role) — digabung supaya hemat kuota Vercel Functions. Semuanya
// khusus OWNER.
module.exports = withErrorHandling(async (req, res) => {
  const supabase = getSupabaseAdmin();
  const { id } = req.query;

  if (req.method === 'GET') {
    const ctx = await requireOwner(req, res);
    if (!ctx) return;

    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, role, created_at')
      .order('created_at', { ascending: true });

    if (profileError) {
      res.status(500).json({ error: profileError.message });
      return;
    }

    const { data: authList, error: authError } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (authError) {
      res.status(500).json({ error: authError.message });
      return;
    }

    const emailById = new Map((authList?.users || []).map((u) => [u.id, u.email]));

    const data = (profiles || []).map((p) => ({
      id: p.id,
      full_name: p.full_name,
      role: p.role,
      created_at: p.created_at,
      email: emailById.get(p.id) || null,
      is_self: p.id === ctx.user.id,
    }));

    res.status(200).json({ data });
    return;
  }

  if (req.method === 'PUT') {
    if (!id) {
      res.status(400).json({ error: 'Parameter id wajib diisi.' });
      return;
    }
    const ctx = await requireOwner(req, res);
    if (!ctx) return;

    const { role } = req.body || {};

    if (!role || !Object.prototype.hasOwnProperty.call(ROLE_LEVEL, role)) {
      res.status(400).json({ error: 'Role tidak valid. Gunakan member, admin, atau owner.' });
      return;
    }

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

  res.setHeader('Allow', 'GET, PUT');
  res.status(405).json({ error: 'Method not allowed' });
});
