import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { resolveConnection, requireConnection } from '../services/connectionService.js';
import { supabaseAdmin } from '../db/supabase.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

function normalizeLabels(labels) {
  return (labels || []).map((l) => (typeof l === 'string' ? l : l.name));
}

router.get('/:owner/:repo/issues', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo } = req.params;
    const { state = 'open', page = 1 } = req.query;

    const { data } = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state,
      page: Number(page),
      per_page: 30,
    });

    // GitHub's "issues" endpoint also returns pull requests — filter them
    // out since PRs have their own dedicated endpoint/UI.
    const issues = data.filter((i) => !i.pull_request);

    res.json({
      issues: issues.map((i) => ({
        number: i.number,
        title: i.title,
        state: i.state,
        user: i.user?.login,
        created_at: i.created_at,
        comments: i.comments,
        labels: normalizeLabels(i.labels),
      })),
    });
  } catch (err) {
    if (err.status === 410) return res.status(409).json({ error: 'Issues are disabled for this repository.' });
    res.status(502).json({ error: 'Failed to load issues.', detail: err.message });
  }
});

router.post('/:owner/:repo/issues', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo } = req.params;
    const { title, body, labels, assignee } = req.body || {};
    if (!title) return res.status(400).json({ error: 'Title is required.' });

    const { data } = await octokit.rest.issues.create({
      owner,
      repo,
      title,
      body: body || undefined,
      labels: labels
        ? String(labels)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
      assignees: assignee ? [assignee] : undefined,
    });

    await supabaseAdmin.from('activity_logs').insert({
      user_id: req.user.id,
      action: 'issue_create',
      resource_type: 'issue',
      resource_id: `${owner}/${repo}#${data.number}`,
      status: 'success',
    });

    res.status(201).json({ number: data.number });
  } catch (err) {
    res.status(502).json({ error: 'Failed to create issue.', detail: err.message });
  }
});

router.get('/:owner/:repo/issues/:number', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo, number } = req.params;

    const [{ data: issue }, { data: comments }] = await Promise.all([
      octokit.rest.issues.get({ owner, repo, issue_number: number }),
      octokit.rest.issues.listComments({ owner, repo, issue_number: number, per_page: 100 }),
    ]);

    res.json({
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      user: issue.user?.login,
      created_at: issue.created_at,
      labels: normalizeLabels(issue.labels),
      comments: comments.map((c) => ({ id: c.id, user: c.user?.login, body: c.body, created_at: c.created_at })),
    });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: 'Issue not found.' });
    res.status(502).json({ error: 'Failed to load issue.', detail: err.message });
  }
});

router.patch('/:owner/:repo/issues/:number', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo, number } = req.params;
    const { state, title, body } = req.body || {};

    if (state && !['open', 'closed'].includes(state)) {
      return res.status(400).json({ error: 'state must be "open" or "closed".' });
    }

    const { data } = await octokit.rest.issues.update({
      owner,
      repo,
      issue_number: number,
      state: state || undefined,
      title: title || undefined,
      body: body !== undefined ? body : undefined,
    });

    await supabaseAdmin.from('activity_logs').insert({
      user_id: req.user.id,
      action: state === 'closed' ? 'issue_close' : state === 'open' ? 'issue_reopen' : 'issue_edit',
      resource_type: 'issue',
      resource_id: `${owner}/${repo}#${number}`,
      status: 'success',
    });

    res.json({ number: data.number, state: data.state });
  } catch (err) {
    res.status(502).json({ error: 'Failed to update issue.', detail: err.message });
  }
});

router.post('/:owner/:repo/issues/:number/comments', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo, number } = req.params;
    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: 'Comment body is required.' });

    const { data } = await octokit.rest.issues.createComment({ owner, repo, issue_number: number, body });
    res.status(201).json({ id: data.id });
  } catch (err) {
    res.status(502).json({ error: 'Failed to post comment.', detail: err.message });
  }
});

export default router;
