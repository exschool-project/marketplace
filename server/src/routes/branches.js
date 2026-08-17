import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { branchService, repositoryService } from '../services/githubService.js';
import { resolveConnection, requireConnection } from '../services/connectionService.js';
import { supabaseAdmin } from '../db/supabase.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

router.get('/:owner/:repo/branches', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;

    const branches = await branchService.list(connection.octokit, req.params.owner, req.params.repo);
    res.json({ branches });
  } catch (err) {
    res.status(502).json({ error: 'Failed to load branches.', detail: err.message });
  }
});

router.post('/:owner/:repo/branches', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;

    const { branch, from } = req.body || {};
    if (!branch || !from) return res.status(400).json({ error: 'branch and from are required.' });

    const result = await branchService.create(connection.octokit, req.params.owner, req.params.repo, branch, from);
    res.status(201).json(result);
  } catch (err) {
    if (err.status === 422) return res.status(409).json({ error: 'A branch with that name already exists.' });
    res.status(502).json({ error: 'Failed to create branch.', detail: err.message });
  }
});

router.delete('/:owner/:repo/branches/:branch', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;

    const repo = await repositoryService.get(connection.octokit, req.params.owner, req.params.repo);
    await branchService.delete(connection.octokit, req.params.owner, req.params.repo, req.params.branch, repo.default_branch);

    await supabaseAdmin.from('activity_logs').insert({
      user_id: req.user.id,
      action: 'branch_delete',
      resource_type: 'branch',
      resource_id: `${req.params.owner}/${req.params.repo}:${req.params.branch}`,
      status: 'success',
    });

    res.json({ deleted: true });
  } catch (err) {
    if (err.message?.includes('default branch')) {
      return res.status(400).json({ error: 'Cannot delete the default branch.' });
    }
    res.status(502).json({ error: 'Failed to delete branch.', detail: err.message });
  }
});

export default router;
