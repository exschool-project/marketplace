import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { supabaseAdmin } from '../db/supabase.js';

const router = Router();
router.use(requireAuth);

// This reads activity_logs, which every route in the app has been
// writing to since Phase 1-5 (logins, file edits, uploads, issue/PR
// actions, releases, workflow re-runs...). It's a real feed of what
// actually happened, not a mock timeline.
router.get('/', async (req, res) => {
  const page = Number(req.query.page || 1);
  const perPage = 30;

  const { data, error, count } = await supabaseAdmin
    .from('activity_logs')
    .select('id, action, resource_type, resource_id, status, created_at', { count: 'exact' })
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  if (error) return res.status(502).json({ error: 'Failed to load activity.' });
  res.json({ events: data, total: count, page, per_page: perPage });
});

export default router;
