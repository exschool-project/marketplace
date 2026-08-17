import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { resolveConnection, requireConnection } from '../services/connectionService.js';
import { supabaseAdmin } from '../db/supabase.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

router.get('/:owner/:repo/releases', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo } = req.params;

    const { data } = await octokit.rest.repos.listReleases({ owner, repo, per_page: 30 });
    res.json({
      releases: data.map((r) => ({
        id: r.id,
        tag_name: r.tag_name,
        name: r.name,
        body: r.body,
        prerelease: r.prerelease,
        draft: r.draft,
        created_at: r.created_at,
        html_url: r.html_url,
      })),
    });
  } catch (err) {
    res.status(502).json({ error: 'Failed to load releases.', detail: err.message });
  }
});

router.post('/:owner/:repo/releases', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo } = req.params;
    const { tag_name, name, body, prerelease } = req.body || {};
    if (!tag_name) return res.status(400).json({ error: 'tag_name is required.' });

    const { data } = await octokit.rest.repos.createRelease({
      owner,
      repo,
      tag_name,
      name: name || tag_name,
      body: body || undefined,
      prerelease: !!prerelease,
    });

    await supabaseAdmin.from('activity_logs').insert({
      user_id: req.user.id,
      action: 'release_create',
      resource_type: 'release',
      resource_id: `${owner}/${repo}:${tag_name}`,
      status: 'success',
    });

    res.status(201).json({ id: data.id, tag_name: data.tag_name });
  } catch (err) {
    if (err.status === 422) return res.status(409).json({ error: 'A release for that tag may already exist.' });
    res.status(502).json({ error: 'Failed to create release.', detail: err.message });
  }
});

router.delete('/:owner/:repo/releases/:id', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo, id } = req.params;

    await octokit.rest.repos.deleteRelease({ owner, repo, release_id: Number(id) });

    await supabaseAdmin.from('activity_logs').insert({
      user_id: req.user.id,
      action: 'release_delete',
      resource_type: 'release',
      resource_id: `${owner}/${repo}#${id}`,
      status: 'success',
    });

    res.json({ deleted: true });
  } catch (err) {
    res.status(502).json({ error: 'Failed to delete release.', detail: err.message });
  }
});

// Tags — read-only here (creating a tag is just "create a release" in the
// UI, which is what most users actually want; a lightweight tag-only
// creation path can be added later if you need annotated tags without a
// release attached).
router.get('/:owner/:repo/tags', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo } = req.params;

    const { data } = await octokit.rest.repos.listTags({ owner, repo, per_page: 30 });
    res.json({ tags: data.map((t) => ({ name: t.name, commit_sha: t.commit?.sha })) });
  } catch (err) {
    res.status(502).json({ error: 'Failed to load tags.', detail: err.message });
  }
});

export default router;
