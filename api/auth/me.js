const { requireAdmin } = require('../_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const ctx = await requireAdmin(req, res);
  if (!ctx) return; // requireAdmin sudah mengirim 401/403

  res.status(200).json({
    id: ctx.user.id,
    email: ctx.user.email,
    full_name: ctx.profile.full_name,
    role: ctx.profile.role,
  });
};