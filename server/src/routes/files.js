import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { fileService } from '../services/githubService.js';
import { resolveConnection, requireConnection } from '../services/connectionService.js';
import { supabaseAdmin } from '../db/supabase.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

// GitHub's Contents API only reliably returns file content for files up
// to ~1MB. Above that we tell the frontend to show a warning instead of
// silently truncating or crashing the editor.
const MAX_INLINE_FILE_SIZE = 1_000_000;

router.get('/:owner/:repo/tree', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;

    const branch = req.query.branch || 'main';
    const tree = await fileService.getTree(connection.octokit, req.params.owner, req.params.repo, branch);

    if (tree.truncated) {
      // GitHub truncates trees over ~100k entries / 7MB — flag it so the
      // frontend can tell the user the tree view is incomplete rather
      // than silently showing a partial repo.
      res.set('X-Tree-Truncated', 'true');
    }
    res.json(tree);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: 'Branch or repository not found.' });
    res.status(502).json({ error: 'Failed to load file tree.', detail: err.message });
  }
});

router.get('/:owner/:repo/file', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;

    const { path, ref } = req.query;
    if (!path) return res.status(400).json({ error: 'Missing "path" query parameter.' });

    const data = await fileService.getFile(connection.octokit, req.params.owner, req.params.repo, path, ref);

    if (Array.isArray(data)) {
      return res.status(400).json({ error: 'That path is a directory, not a file.' });
    }

    if (data.size > MAX_INLINE_FILE_SIZE) {
      return res.json({
        path: data.path,
        sha: data.sha,
        size: data.size,
        tooLarge: true,
        message: `File is ${(data.size / 1_000_000).toFixed(2)}MB — too large to view or edit inline (limit 1MB).`,
      });
    }

    const content = data.content ? Buffer.from(data.content, 'base64').toString('utf-8') : '';
    res.json({ path: data.path, sha: data.sha, size: data.size, content, tooLarge: false });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: 'File not found.' });
    res.status(502).json({ error: 'Failed to load file.', detail: err.message });
  }
});

router.put('/:owner/:repo/file', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;

    const { path, content, message, branch, sha } = req.body || {};
    if (!path || content === undefined || !message || !branch) {
      return res.status(400).json({ error: 'path, content, message, and branch are required.' });
    }

    const encoded = Buffer.from(content, 'utf-8').toString('base64');
    const result = await fileService.putFile(connection.octokit, req.params.owner, req.params.repo, path, {
      content: encoded,
      message,
      branch,
      sha, // omit for new file creation, required when overwriting
    });

    await supabaseAdmin.from('activity_logs').insert({
      user_id: req.user.id,
      action: sha ? 'file_update' : 'file_create',
      resource_type: 'file',
      resource_id: `${req.params.owner}/${req.params.repo}:${path}`,
      status: 'success',
    });

    res.json({
      commit_sha: result.commit.sha,
      content_sha: result.content.sha,
      path,
    });
  } catch (err) {
    if (err.status === 409) {
      // sha mismatch — someone else changed the file since it was loaded.
      return res.status(409).json({
        error: 'This file changed on GitHub since you opened it. Reload before saving to avoid overwriting someone else\u2019s change.',
      });
    }
    await supabaseAdmin.from('activity_logs').insert({
      user_id: req.user.id,
      action: 'file_update',
      resource_type: 'file',
      resource_id: `${req.params.owner}/${req.params.repo}:${req.body?.path || ''}`,
      status: 'failed',
    });
    res.status(502).json({ error: 'Failed to save file to GitHub.', detail: err.message });
  }
});

router.delete('/:owner/:repo/file', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;

    const { path, message, branch, sha } = req.body || {};
    if (!path || !message || !branch || !sha) {
      return res.status(400).json({ error: 'path, message, branch, and sha are all required to delete a file.' });
    }

    await fileService.deleteFile(connection.octokit, req.params.owner, req.params.repo, path, { message, branch, sha });

    await supabaseAdmin.from('activity_logs').insert({
      user_id: req.user.id,
      action: 'file_delete',
      resource_type: 'file',
      resource_id: `${req.params.owner}/${req.params.repo}:${path}`,
      status: 'success',
    });

    res.json({ deleted: true });
  } catch (err) {
    res.status(502).json({ error: 'Failed to delete file.', detail: err.message });
  }
});

export default router;
