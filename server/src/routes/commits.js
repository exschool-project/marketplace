import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { resolveConnection, requireConnection } from '../services/connectionService.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

router.get('/:owner/:repo/commits', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo } = req.params;
    const { branch, page = 1 } = req.query;

    const { data } = await octokit.rest.repos.listCommits({
      owner,
      repo,
      sha: branch || undefined,
      page: Number(page),
      per_page: 30,
    });

    res.json({
      commits: data.map((c) => ({
        sha: c.sha,
        message: c.commit.message,
        author: c.commit.author?.name || c.author?.login || 'unknown',
        date: c.commit.author?.date,
      })),
    });
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ error: 'This repository has no commits yet.' });
    res.status(502).json({ error: 'Failed to load commits.', detail: err.message });
  }
});

router.get('/:owner/:repo/commits/:sha', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo, sha } = req.params;

    const { data } = await octokit.rest.repos.getCommit({ owner, repo, ref: sha });

    res.json({
      sha: data.sha,
      message: data.commit.message,
      author: data.commit.author?.name || data.author?.login || 'unknown',
      date: data.commit.author?.date,
      stats: data.stats || { additions: 0, deletions: 0 },
      files: (data.files || []).map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch || null, // absent for binary files or very large diffs
      })),
    });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: 'Commit not found.' });
    res.status(502).json({ error: 'Failed to load commit.', detail: err.message });
  }
});

export default router;
