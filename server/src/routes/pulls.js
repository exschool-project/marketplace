import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { resolveConnection, requireConnection } from '../services/connectionService.js';
import { supabaseAdmin } from '../db/supabase.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

router.get('/:owner/:repo/pulls', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo } = req.params;
    const { state = 'open', page = 1 } = req.query;

    const { data } = await octokit.rest.pulls.list({
      owner,
      repo,
      state, // 'open' | 'closed' | 'all' — the frontend splits "closed" into closed/merged itself
      page: Number(page),
      per_page: 30,
    });

    res.json({
      pulls: data.map((p) => ({
        number: p.number,
        title: p.title,
        state: p.state,
        merged: !!p.merged_at,
        head: p.head?.ref,
        base: p.base?.ref,
        user: p.user?.login,
        created_at: p.created_at,
      })),
    });
  } catch (err) {
    res.status(502).json({ error: 'Failed to load pull requests.', detail: err.message });
  }
});

router.post('/:owner/:repo/pulls', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo } = req.params;
    const { title, body, base, head } = req.body || {};
    if (!title || !base || !head) return res.status(400).json({ error: 'title, base, and head are required.' });
    if (base === head) return res.status(400).json({ error: 'base and head branches must be different.' });

    const { data } = await octokit.rest.pulls.create({ owner, repo, title, body: body || undefined, base, head });

    await supabaseAdmin.from('activity_logs').insert({
      user_id: req.user.id,
      action: 'pr_create',
      resource_type: 'pull_request',
      resource_id: `${owner}/${repo}#${data.number}`,
      status: 'success',
    });

    res.status(201).json({ number: data.number });
  } catch (err) {
    if (err.status === 422) {
      return res.status(409).json({ error: 'Could not create the pull request — there may be no diff between these branches, or one already exists.' });
    }
    res.status(502).json({ error: 'Failed to create pull request.', detail: err.message });
  }
});

router.get('/:owner/:repo/pulls/:number', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo, number } = req.params;

    const [{ data: pr }, { data: files }, { data: commits }, { data: comments }] = await Promise.all([
      octokit.rest.pulls.get({ owner, repo, pull_number: number }),
      octokit.rest.pulls.listFiles({ owner, repo, pull_number: number, per_page: 100 }),
      octokit.rest.pulls.listCommits({ owner, repo, pull_number: number, per_page: 100 }),
      // PR conversation comments live on the *issues* endpoint — PRs are
      // issues under the hood. Line-level review comments are a separate
      // API this Phase doesn't surface (see README).
      octokit.rest.issues.listComments({ owner, repo, issue_number: number, per_page: 100 }),
    ]);

    res.json({
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      merged: !!pr.merged_at,
      mergeable: pr.mergeable,
      head: pr.head?.ref,
      base: pr.base?.ref,
      user: pr.user?.login,
      created_at: pr.created_at,
      files: files.map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions })),
      commits: commits.map((c) => ({ sha: c.sha, message: c.commit.message })),
      comments: comments.map((c) => ({ id: c.id, user: c.user?.login, body: c.body, created_at: c.created_at })),
    });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: 'Pull request not found.' });
    res.status(502).json({ error: 'Failed to load pull request.', detail: err.message });
  }
});

router.patch('/:owner/:repo/pulls/:number', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo, number } = req.params;
    const { state, title, body } = req.body || {};

    if (state && !['open', 'closed'].includes(state)) {
      return res.status(400).json({ error: 'state must be "open" or "closed".' });
    }

    const { data } = await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: number,
      state: state || undefined,
      title: title || undefined,
      body: body !== undefined ? body : undefined,
    });

    res.json({ number: data.number, state: data.state });
  } catch (err) {
    res.status(502).json({ error: 'Failed to update pull request.', detail: err.message });
  }
});

// Merging is destructive/irreversible-ish and gets its own endpoint (not
// folded into PATCH) so it's an explicit, auditable action — the
// frontend requires a confirmation modal before ever calling this.
router.put('/:owner/:repo/pulls/:number/merge', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo, number } = req.params;
    const { commit_title, merge_method = 'merge' } = req.body || {};

    if (!['merge', 'squash', 'rebase'].includes(merge_method)) {
      return res.status(400).json({ error: 'merge_method must be merge, squash, or rebase.' });
    }

    const { data } = await octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: number,
      commit_title: commit_title || undefined,
      merge_method,
    });

    await supabaseAdmin.from('activity_logs').insert({
      user_id: req.user.id,
      action: 'pr_merge',
      resource_type: 'pull_request',
      resource_id: `${owner}/${repo}#${number}`,
      status: 'success',
    });

    res.json({ merged: data.merged, sha: data.sha, message: data.message });
  } catch (err) {
    if (err.status === 405) {
      return res.status(409).json({ error: 'This pull request is not mergeable right now (conflicts or checks pending).' });
    }
    if (err.status === 409) {
      return res.status(409).json({ error: 'Merge conflict — head branch changed since this PR was loaded. Refresh and try again.' });
    }
    await supabaseAdmin.from('activity_logs').insert({
      user_id: req.user.id,
      action: 'pr_merge',
      resource_type: 'pull_request',
      resource_id: `${req.params.owner}/${req.params.repo}#${req.params.number}`,
      status: 'failed',
    });
    res.status(502).json({ error: 'Failed to merge pull request.', detail: err.message });
  }
});

router.post('/:owner/:repo/pulls/:number/comments', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo, number } = req.params;
    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: 'Comment body is required.' });

    // Same underlying endpoint as issue comments — PRs are issues.
    const { data } = await octokit.rest.issues.createComment({ owner, repo, issue_number: number, body });
    res.status(201).json({ id: data.id });
  } catch (err) {
    res.status(502).json({ error: 'Failed to post comment.', detail: err.message });
  }
});

export default router;
