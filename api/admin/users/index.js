const { getSupabaseAdmin } = require('../../_lib/supabaseAdmin');
const { requireOwner } = require('../../_lib/auth');
const { withErrorHandling } = require('../../_lib/http');

// Khusus OWNER: melihat semua akun (member/admin/owner) untuk dikelola.
// Email diambil dari Supabase Auth (bukan tabel profiles), lalu digabung
// dengan role dari tabel profiles.
module.exports = withErrorHandling(async (req, res) => {
  const supabase = getSupabaseAdmin();

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

  res.setHeader('Allow', 'GET');
  res.status(405).json({ error: 'Method not allowed' });
});
