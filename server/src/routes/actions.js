import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { resolveConnection, requireConnection } from '../services/connectionService.js';
import { supabaseAdmin } from '../db/supabase.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

router.get('/:owner/:repo/actions/workflows', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo } = req.params;

    const { data } = await octokit.rest.actions.listRepoWorkflows({ owner, repo, per_page: 50 });
    res.json({
      workflows: data.workflows.map((w) => ({ id: w.id, name: w.name, path: w.path, state: w.state })),
    });
  } catch (err) {
    if (err.status === 404) return res.status(409).json({ error: 'Actions is not enabled for this repository, or no permission.' });
    res.status(502).json({ error: 'Failed to load workflows.', detail: err.message });
  }
});

router.get('/:owner/:repo/actions/runs', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo } = req.params;
    const { workflow_id, page = 1 } = req.query;

    const params = { owner, repo, page: Number(page), per_page: 30 };
    const { data } = workflow_id
      ? await octokit.rest.actions.listWorkflowRuns({ ...params, workflow_id })
      : await octokit.rest.actions.listWorkflowRunsForRepo(params);

    res.json({
      runs: data.workflow_runs.map((r) => ({
        id: r.id,
        name: r.name,
        workflow_id: r.workflow_id,
        branch: r.head_branch,
        status: r.status, // queued | in_progress | completed
        conclusion: r.conclusion, // success | failure | cancelled | null
        event: r.event,
        created_at: r.created_at,
        html_url: r.html_url, // logs are viewed on GitHub directly — see README on why
      })),
    });
  } catch (err) {
    res.status(502).json({ error: 'Failed to load workflow runs.', detail: err.message });
  }
});

router.post('/:owner/:repo/actions/runs/:runId/retry', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo, runId } = req.params;

    await octokit.rest.actions.reRunWorkflow({ owner, repo, run_id: Number(runId) });

    await supabaseAdmin.from('activity_logs').insert({
      user_id: req.user.id,
      action: 'workflow_rerun',
      resource_type: 'workflow_run',
      resource_id: `${owner}/${repo}#${runId}`,
      status: 'success',
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: 'Failed to re-run workflow.', detail: err.message });
  }
});

router.post('/:owner/:repo/actions/runs/:runId/cancel', async (req, res) => {
  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;
    const { octokit } = connection;
    const { owner, repo, runId } = req.params;

    await octokit.rest.actions.cancelWorkflowRun({ owner, repo, run_id: Number(runId) });

    await supabaseAdmin.from('activity_logs').insert({
      user_id: req.user.id,
      action: 'workflow_cancel',
      resource_type: 'workflow_run',
      resource_id: `${owner}/${repo}#${runId}`,
      status: 'success',
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: 'Failed to cancel workflow run.', detail: err.message });
  }
});

export default router;
