import { Router } from 'express';
import { supabaseAdmin } from '../db/supabase.js';

const router = Router();

// Public, unauthenticated — this feeds the landing page's "UPGit dalam
// Angka" panel, which is shown before anyone signs in. No user-scoped
// data leaves here, only aggregate counts.
//
// "Push ke GitHub" counts activity_logs rows for the actions that
// represent an actual commit landing on GitHub (upload commits and
// single-file edits). "Deploy ke Vercel" counts the three actions
// vercel.js logs whenever a deployment is kicked off.
const PUSH_ACTIONS = ['upload_commit', 'file_update'];
const DEPLOY_ACTIONS = ['deploy_vercel', 'upload_deploy_vercel', 'redeploy_vercel'];

router.get('/', async (req, res) => {
  try {
    const [usersResult, pushesResult, deploysResult] = await Promise.all([
      supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }),
      supabaseAdmin
        .from('activity_logs')
        .select('id', { count: 'exact', head: true })
        .in('action', PUSH_ACTIONS)
        .eq('status', 'success'),
      supabaseAdmin
        .from('activity_logs')
        .select('id', { count: 'exact', head: true })
        .in('action', DEPLOY_ACTIONS)
        .eq('status', 'success'),
    ]);

    if (usersResult.error || pushesResult.error || deploysResult.error) {
      throw usersResult.error || pushesResult.error || deploysResult.error;
    }

    res.json({
      total_users: usersResult.count || 0,
      total_pushes: pushesResult.count || 0,
      total_deploys: deploysResult.count || 0,
    });
  } catch (err) {
    console.error('[stats] failed to load landing stats', err);
    res.status(502).json({ error: 'Failed to load stats.' });
  }
});

export default router;
