import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { requireAuth } from '../middleware/requireAuth.js';
import { supabaseAdmin } from '../db/supabase.js';
import { encryptToken } from '../services/cryptoService.js';
import { resolveVercelConnection, requireVercelConnection } from '../services/connectionService.js';
import * as vercel from '../services/vercelService.js';
import { VercelApiError } from '../services/vercelService.js';
import { env } from '../config/env.js';
import { inspectZip, readZipEntry } from '../services/zipInspector.js';
import { isSecretFile } from '../services/uploadSecurity.js';

const router = Router();
router.use(requireAuth);

// Sensitive-endpoint rate limit — separate from the app-wide limiter in
// app.js, tighter because these hit an external API and/or a secret.
const sensitiveLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.upload.maxExtractedSize },
});

// Every route below funnels errors through here so a raw VercelApiError
// (or anything else) never leaks a stack trace or upstream payload.
function handleError(res, err, fallback = 'Vercel request failed.') {
  if (err instanceof VercelApiError) {
    return res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ error: err.message, code: err.code });
  }
  console.error('[vercel]', err);
  res.status(502).json({ error: fallback });
}

async function getConnection(req, res) {
  const connection = await resolveVercelConnection(req.user.id);
  if (!requireVercelConnection(connection, res)) return null;
  return connection;
}

// ================= A/V. Connection & account =================

router.post('/connect', sensitiveLimit, async (req, res) => {
  const { token } = req.body || {};
  if (!token || typeof token !== 'string' || token.length < 10) {
    return res.status(400).json({ error: 'A valid Vercel Personal Access Token is required.' });
  }
  try {
    const user = await vercel.getUser(token);
    const info = user?.user || user;
    const now = new Date().toISOString();

    const { error } = await supabaseAdmin.from('user_vercel_connections').upsert(
      {
        user_id: req.user.id,
        encrypted_token: encryptToken(token),
        vercel_user_id: info?.id || null,
        vercel_username: info?.username || null,
        vercel_email: info?.email || null,
        updated_at: now,
        last_verified_at: now,
      },
      { onConflict: 'user_id' }
    );
    if (error) throw error;

    await supabaseAdmin.from('activity_logs').insert({
      user_id: req.user.id,
      action: 'connect_vercel',
      resource_type: 'vercel_connection',
      status: 'success',
    });

    res.status(201).json({
      connected: true,
      username: info?.username || null,
      email: info?.email || null,
      user_id: info?.id || null,
      last_verified_at: now,
    });
  } catch (err) {
    if (err instanceof VercelApiError) return handleError(res, err);
    res.status(502).json({ error: 'Failed to save Vercel connection.' });
  }
});

router.get('/connection', async (req, res) => {
  const { data: conn } = await supabaseAdmin
    .from('user_vercel_connections')
    .select('vercel_user_id, vercel_username, vercel_email, last_verified_at, created_at')
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (!conn) return res.json({ connected: false });
  res.json({
    connected: true,
    username: conn.vercel_username,
    email: conn.vercel_email,
    user_id: conn.vercel_user_id,
    last_verified_at: conn.last_verified_at,
    connected_since: conn.created_at,
  });
});

router.post('/connection/test', sensitiveLimit, async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  try {
    const user = await vercel.getUser(connection.token);
    const now = new Date().toISOString();
    await supabaseAdmin.from('user_vercel_connections').update({ last_verified_at: now }).eq('user_id', req.user.id);
    res.json({ ok: true, username: (user?.user || user)?.username || null, last_verified_at: now });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/connect', async (req, res) => {
  const { error } = await supabaseAdmin.from('user_vercel_connections').delete().eq('user_id', req.user.id);
  if (error) return res.status(502).json({ error: 'Failed to disconnect Vercel.' });

  await supabaseAdmin.from('activity_logs').insert({
    user_id: req.user.id,
    action: 'disconnect_vercel',
    resource_type: 'vercel_connection',
    status: 'success',
  });

  res.json({ connected: false });
});

// ================= D. Projects =================

router.get('/projects', async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  try {
    const result = await vercel.listProjects(connection.token, { search: req.query.search });
    res.json(result);
  } catch (err) {
    handleError(res, err, 'Failed to load Vercel projects.');
  }
});

router.get('/projects/:id', async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  try {
    res.json(await vercel.getProject(connection.token, req.params.id));
  } catch (err) {
    handleError(res, err, 'Failed to load Vercel project.');
  }
});

router.post('/projects', sensitiveLimit, async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  const { name, framework, rootDirectory, buildCommand, outputDirectory, installCommand, nodeVersion, environmentVariables } =
    req.body || {};
  if (!name || !/^[a-z0-9._-]+$/i.test(name)) {
    return res.status(400).json({ error: 'A valid project name is required.' });
  }
  try {
    const project = await vercel.createProject(connection.token, {
      name,
      framework: framework || null,
      rootDirectory: rootDirectory || null,
      buildCommand: buildCommand || null,
      outputDirectory: outputDirectory || null,
      installCommand: installCommand || null,
      nodeVersion: nodeVersion || undefined,
      environmentVariables: Array.isArray(environmentVariables)
        ? environmentVariables.map((v) => ({ key: v.name, value: v.value, target: v.target || ['production', 'preview', 'development'], type: 'encrypted' }))
        : undefined,
    });

    await supabaseAdmin.from('activity_logs').insert({
      user_id: req.user.id,
      action: 'create_vercel_project',
      resource_type: 'vercel_project',
      resource_id: project.name,
      status: 'success',
    });

    res.status(201).json(project);
  } catch (err) {
    handleError(res, err, 'Failed to create Vercel project.');
  }
});

router.patch('/projects/:id', sensitiveLimit, async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  try {
    res.json(await vercel.updateProject(connection.token, req.params.id, req.body || {}));
  } catch (err) {
    handleError(res, err, 'Failed to update Vercel project settings.');
  }
});

// ================= I. Deployments (list/history) =================

router.get('/deployments', async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  try {
    const result = await vercel.listDeployments(connection.token, {
      projectId: req.query.projectId,
      limit: req.query.limit,
      state: req.query.state,
    });
    res.json(result);
  } catch (err) {
    handleError(res, err, 'Failed to load deployments.');
  }
});

router.get('/projects/:id/deployments', async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  try {
    const result = await vercel.listDeployments(connection.token, { projectId: req.params.id, limit: req.query.limit });
    res.json(result);
  } catch (err) {
    handleError(res, err, 'Failed to load project deployments.');
  }
});

// Powers the dashboard's "Deployment Overview" chart, "Deployment Status"
// donut, and the deployment-related stat cards — all real, computed from
// the same deployments list rather than separate calls. `days` controls
// both how far back the daily chart buckets go and, loosely, how many
// deployments we ask Vercel for (capped at the API's max of 100 per call
// — plenty for a personal/small-team dashboard's "last N days" view).
router.get('/deployments/summary', async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
  try {
    const { deployments = [] } = await vercel.listDeployments(connection.token, { limit: 100 });

    const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
    const today = new Date();
    const daily = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      daily.push({ date: d.toISOString().slice(0, 10), successful: 0, failed: 0 });
    }
    const dailyByKey = Object.fromEntries(daily.map((d) => [d.date, d]));
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    let successful = 0;
    let failed = 0;
    let building = 0;
    let other = 0;
    const deployDurationsMs = [];

    for (const d of deployments) {
      const state = String(d.state || d.readyState || '').toUpperCase();
      const createdMs = d.created || d.createdAt;

      if (state === 'READY') successful++;
      else if (state === 'ERROR' || state === 'CANCELED') failed++;
      else if (state === 'BUILDING' || state === 'QUEUED' || state === 'INITIALIZING') building++;
      else other++;

      // Vercel's list endpoint includes `ready` (ms epoch) once a
      // deployment finishes — only present on completed deployments, so
      // this naturally skips in-flight ones for the average.
      const readyMs = d.ready || d.readyAt;
      if (createdMs && readyMs && readyMs > createdMs) deployDurationsMs.push(readyMs - createdMs);

      if (createdMs && createdMs >= cutoff) {
        const key = dayKey(createdMs);
        const bucket = dailyByKey[key];
        if (bucket) {
          if (state === 'READY') bucket.successful++;
          else if (state === 'ERROR' || state === 'CANCELED') bucket.failed++;
        }
      }
    }

    const avgDeploySeconds = deployDurationsMs.length
      ? Math.round(deployDurationsMs.reduce((a, b) => a + b, 0) / deployDurationsMs.length / 1000)
      : null;

    res.json({
      total: deployments.length,
      successful,
      failed,
      building,
      other,
      avg_deploy_seconds: avgDeploySeconds,
      daily,
    });
  } catch (err) {
    handleError(res, err, 'Failed to load deployment summary.');
  }
});

// ================= F. Deploy =================
// Git-based deploy: deploy an existing Vercel project from a connected
// GitHub repo + branch. GitHub connectivity is resolved independently
// (never required just to use Vercel) — see connectionService.js.
router.post('/deploy', sensitiveLimit, async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;

  const { projectId, projectName, repoFullName, branch, target } = req.body || {};
  if (!projectId && !projectName) {
    return res.status(400).json({ error: 'A target Vercel project is required.' });
  }

  try {
    const body = { name: projectName || undefined, project: projectId || projectName, target: target === 'production' ? 'production' : undefined };
    if (repoFullName && branch) {
      const [owner, repo] = String(repoFullName).split('/');
      if (!owner || !repo) return res.status(400).json({ error: 'Invalid repository.' });
      body.gitSource = { type: 'github', org: owner, repo, ref: branch };
    } else if (repoFullName || branch) {
      return res.status(400).json({ error: 'Both a repository and a branch are required to deploy from GitHub.' });
    }

    const deployment = await vercel.createDeployment(connection.token, body);

    await supabaseAdmin.from('activity_logs').insert({
      user_id: req.user.id,
      action: 'deploy_vercel',
      resource_type: 'vercel_deployment',
      resource_id: deployment.id || deployment.uid,
      status: 'success',
    });

    res.status(201).json(deployment);
  } catch (err) {
    handleError(res, err, 'Deployment failed. Open deployment details for more information.');
  }
});

// ================= G. Upload & Deploy (ZIP / folder / files → Vercel) =================
// Independent of the existing GitHub upload/staging flow in uploads.js —
// this never touches upload_jobs or Supabase Storage, and the existing
// ZIP/folder/file upload feature is untouched.
router.post('/upload-deploy', sensitiveLimit, upload.single('file'), async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const { projectName, target } = req.body || {};
  if (!projectName || !/^[a-z0-9._-]+$/i.test(projectName)) {
    return res.status(400).json({ error: 'A valid target project name is required.' });
  }

  try {
    let safeEntries;
    try {
      ({ safeEntries } = inspectZip(req.file.buffer, {
        maxFiles: env.upload.maxFiles,
        maxExtractedSize: env.upload.maxExtractedSize,
        maxFileSize: env.upload.maxSize,
      }));
    } catch (zipErr) {
      return res.status(400).json({ error: zipErr.message });
    }

    const files = [];
    for (const entry of safeEntries) {
      if (isSecretFile(entry.path)) continue; // never ship .env/secret files to Vercel from a raw upload
      const content = readZipEntry(entry);
      const uploaded = await vercel.uploadFile(connection.token, content);
      files.push({ file: entry.path, sha: uploaded.sha, size: uploaded.size });
    }

    if (!files.length) {
      return res.status(400).json({ error: 'No deployable files found in the upload.' });
    }

    const deployment = await vercel.createDeployment(connection.token, {
      name: projectName,
      project: projectName,
      target: target === 'production' ? 'production' : undefined,
      files,
    });

    await supabaseAdmin.from('activity_logs').insert({
      user_id: req.user.id,
      action: 'upload_deploy_vercel',
      resource_type: 'vercel_deployment',
      resource_id: deployment.id || deployment.uid,
      status: 'success',
    });

    res.status(201).json(deployment);
  } catch (err) {
    handleError(res, err, 'Upload & deploy failed. Open deployment details for more information.');
  }
});

// ================= H/J. Deployment status & detail =================

router.get('/deployments/:id', async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  try {
    res.json(await vercel.getDeployment(connection.token, req.params.id));
  } catch (err) {
    handleError(res, err, 'Failed to load deployment.');
  }
});

// ================= K. Redeploy =================

router.post('/deployments/:id/redeploy', sensitiveLimit, async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  try {
    const deployment = await vercel.redeploy(connection.token, req.params.id, { target: req.body?.target });

    await supabaseAdmin.from('activity_logs').insert({
      user_id: req.user.id,
      action: 'redeploy_vercel',
      resource_type: 'vercel_deployment',
      resource_id: deployment.id || deployment.uid,
      status: 'success',
    });

    res.status(201).json(deployment);
  } catch (err) {
    handleError(res, err, 'Redeploy failed.');
  }
});

// ================= S. Cancel deployment =================

router.post('/deployments/:id/cancel', sensitiveLimit, async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  try {
    res.json(await vercel.cancelDeployment(connection.token, req.params.id));
  } catch (err) {
    handleError(res, err, 'Failed to cancel deployment.');
  }
});

// ================= R. Promote to production =================

router.post('/projects/:id/promote/:deploymentId', sensitiveLimit, async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  try {
    res.json(await vercel.promoteDeployment(connection.token, req.params.id, req.params.deploymentId));
  } catch (err) {
    handleError(res, err, 'Failed to promote deployment to production.');
  }
});

// ================= T. Logs (sanitized) =================

const SECRET_KEY_PATTERN = /(authoriz|token|secret|password|api[_-]?key|bearer)/i;

// Strips anything that looks like it could contain a credential before it
// ever reaches the frontend, per the "never show tokens/secrets in logs"
// requirement — applied regardless of what Vercel itself returns.
function sanitizeEvents(events) {
  if (!Array.isArray(events)) return [];
  return events
    .map((e) => {
      let text = typeof e.payload?.text === 'string' ? e.payload.text : typeof e.text === 'string' ? e.text : '';
      if (SECRET_KEY_PATTERN.test(text)) text = '[redacted]';
      return { type: e.type, created: e.created || e.payload?.created, text };
    })
    .filter((e) => e.text);
}

router.get('/deployments/:id/events', sensitiveLimit, async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  try {
    const events = await vercel.getDeploymentEvents(connection.token, req.params.id);
    res.json({ events: sanitizeEvents(events) });
  } catch (err) {
    handleError(res, err, 'Failed to load deployment logs.');
  }
});

// ================= L/M. Domains =================

router.get('/projects/:id/domains', async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  try {
    res.json(await vercel.listDomains(connection.token, req.params.id));
  } catch (err) {
    handleError(res, err, 'Failed to load domains.');
  }
});

router.post('/projects/:id/domains', sensitiveLimit, async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'A domain name is required.' });
  try {
    res.status(201).json(await vercel.addDomain(connection.token, req.params.id, name));
  } catch (err) {
    handleError(res, err, 'Failed to add domain.');
  }
});

router.delete('/projects/:id/domains/:domain', sensitiveLimit, async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  try {
    res.json(await vercel.removeDomain(connection.token, req.params.id, req.params.domain));
  } catch (err) {
    handleError(res, err, 'Failed to remove domain.');
  }
});

router.post('/projects/:id/domains/:domain/verify', sensitiveLimit, async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  try {
    res.json(await vercel.verifyDomain(connection.token, req.params.id, req.params.domain));
  } catch (err) {
    handleError(res, err, 'Domain verification failed.');
  }
});

// ================= N. Environment variables =================

router.get('/projects/:id/env', async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  try {
    const result = await vercel.listEnv(connection.token, req.params.id);
    // Never forward decrypted values — the UI only ever shows a masked
    // placeholder for existing secrets (see AE/N requirements).
    const envs = (result?.envs || []).map((e) => ({
      id: e.id,
      key: e.key,
      target: e.target,
      type: e.type,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    }));
    res.json({ envs });
  } catch (err) {
    handleError(res, err, 'Failed to load environment variables.');
  }
});

router.post('/projects/:id/env', sensitiveLimit, async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  const { key, value, target } = req.body || {};
  if (!key || value === undefined) return res.status(400).json({ error: 'Both a name and a value are required.' });
  try {
    const result = await vercel.createEnv(connection.token, req.params.id, {
      key,
      value,
      target: Array.isArray(target) && target.length ? target : ['production', 'preview', 'development'],
      type: 'encrypted',
    });
    res.status(201).json({ ok: true, key: result?.key || key });
  } catch (err) {
    handleError(res, err, 'Failed to add environment variable.');
  }
});

router.patch('/projects/:id/env/:envId', sensitiveLimit, async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  const { value, target } = req.body || {};
  const patch = {};
  if (value !== undefined) patch.value = value;
  if (target !== undefined) patch.target = target;
  try {
    await vercel.updateEnv(connection.token, req.params.id, req.params.envId, patch);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err, 'Failed to update environment variable.');
  }
});

router.delete('/projects/:id/env/:envId', sensitiveLimit, async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  try {
    await vercel.deleteEnv(connection.token, req.params.id, req.params.envId);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err, 'Failed to delete environment variable.');
  }
});

// ================= U. Usage =================
// Vercel does not expose a stable, generally-available "usage" REST
// endpoint for personal accounts — rather than guess at an undocumented
// one, this is honest about that instead of fabricating numbers.
router.get('/usage', async (req, res) => {
  const connection = await getConnection(req, res);
  if (!connection) return;
  res.json({ available: false, message: 'Usage information is not available for this Vercel account.' });
});

export default router;
