import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { repositoryService } from '../services/githubService.js';
import { resolveConnection, requireConnection } from '../services/connectionService.js';
import { supabaseAdmin } from '../db/supabase.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;

    const page = Number(req.query.page || 1);
    const perPage = Math.min(Number(req.query.per_page || 30), 100);

    const result = await repositoryService.list(connection.octokit, connection.authMode, { page, perPage });
    res.json({
      total_count: result.total_count,
      page,
      per_page: perPage,
      repositories: result.repositories,
    });
  } catch (err) {
    res.status(502).json({ error: 'Failed to load repositories from GitHub.', detail: err.message });
  }
});

router.get('/:owner/:repo', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const repo = await repositoryService.get(connection.octokit, req.params.owner, req.params.repo);
    res.json(repo);
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ error: 'Repository not found or not accessible.' });
    }
    res.status(502).json({ error: 'Failed to load repository.', detail: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;

    const { name, description, private: isPrivate } = req.body || {};
    if (!name || !/^[\w.-]+$/.test(name)) {
      return res.status(400).json({ error: 'A valid repository name is required (letters, numbers, ., _, - only).' });
    }

    const repo = await repositoryService.create(connection.octokit, connection.authMode, {
      name,
      description,
      isPrivate,
      installationId: connection.installationId,
    });

    await supabaseAdmin.from('activity_logs').insert({
      user_id: req.user.id,
      action: 'create_repo',
      resource_type: 'repository',
      resource_id: repo.full_name,
      status: 'success',
    });

    res.status(201).json(repo);
  } catch (err) {
    if (err.code === 'personal_account_unsupported') {
      return res.status(422).json({ error: err.message, code: err.code });
    }
    if (err.status === 422) {
      return res.status(422).json({ error: 'A repository with that name already exists.' });
    }
    res.status(502).json({ error: 'Failed to create repository on GitHub.', detail: err.message });
  }
});

export default router;
