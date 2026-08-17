import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { supabaseAdmin } from '../db/supabase.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('user_settings')
    .select('theme, default_branch, default_commit_message')
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (error) return res.status(502).json({ error: 'Failed to load settings.' });

  // No row yet (first visit) — return sane defaults rather than an error.
  res.json(
    data || {
      theme: 'dark',
      default_branch: 'main',
      default_commit_message: 'Update via UPGit',
    }
  );
});

router.put('/', async (req, res) => {
  const { default_branch, default_commit_message } = req.body || {};

  // theme is intentionally NOT accepted here yet — see README: only one
  // theme (dark neobrutalist) currently exists, so exposing a theme
  // switch that doesn't switch anything would be a fake control.
  const patch = { user_id: req.user.id, updated_at: new Date().toISOString() };
  if (default_branch !== undefined) patch.default_branch = default_branch || 'main';
  if (default_commit_message !== undefined) patch.default_commit_message = default_commit_message || 'Update via UPGit';

  const { data, error } = await supabaseAdmin
    .from('user_settings')
    .upsert(patch, { onConflict: 'user_id' })
    .select('theme, default_branch, default_commit_message')
    .single();

  if (error) return res.status(502).json({ error: 'Failed to save settings.' });
  res.json(data);
});

export default router;
