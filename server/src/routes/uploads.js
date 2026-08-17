import { Router } from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/requireAuth.js';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../db/supabase.js';
import { resolveConnection, requireConnection } from '../services/connectionService.js';
import { bulkCommitService } from '../services/githubService.js';
import { inspectZip, readZipEntry } from '../services/zipInspector.js';
import { stageFiles, getManifest, getFiles, deleteJob, cleanupExpiredJobsForUser } from '../services/uploadStagingService.js';
import {
  isSafeRelativePath,
  isSecretFile,
  detectProjectTypes,
  hasGitignore,
  GITIGNORE_TEMPLATES,
} from '../services/uploadSecurity.js';

const router = Router();
router.use(requireAuth);

// Two separate multer configs on purpose: `uploadFiles` enforces the
// per-file 4MB limit directly (used by analyze-files, where each
// multipart part IS one real file). `uploadZip` only caps the *archive*
// itself at maxExtractedSize — the ZIP is compressed, so a 4MB cap here
// would reject entirely reasonable archives; per-entry size is instead
// checked post-decompression by inspectZip() below, against the same
// env.upload.maxSize used for regular uploads.
const uploadFiles = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.upload.maxSize, files: env.upload.maxFiles },
});
const uploadZip = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.upload.maxExtractedSize },
});

// Staged upload *contents* live in Supabase Storage (see
// uploadStagingService.js), keyed by jobId — not in process memory. That's
// what lets the "analyze" call and the later "commit" call land on two
// different serverless instances (Netlify/Vercel Functions) and still
// work. This route file only ever holds one file's bytes in memory at a
// time (via multer), never a whole job's worth.
//
// Jobs are considered expired 30 minutes after creation (mirrors the old
// in-memory TTL). Expiry is checked lazily against upload_jobs.created_at
// wherever a job is looked up, since a serverless function has no
// guarantee it'll stay warm long enough for a setInterval sweep to fire —
// see DEPLOYMENT.md for an optional scheduled cleanup job.
const JOB_TTL_MS = 30 * 60 * 1000;

function isExpired(createdAt) {
  return Date.now() - new Date(createdAt).getTime() > JOB_TTL_MS;
}

// Loads a job's metadata row, enforcing ownership + TTL. Returns null (and
// best-effort cleans up Storage) if missing, foreign, or expired.
async function loadOwnedJob(jobId, userId) {
  const { data: job } = await supabaseAdmin
    .from('upload_jobs')
    .select('id, user_id, status, created_at')
    .eq('id', jobId)
    .maybeSingle();

  if (!job || job.user_id !== userId) return null;

  if (isExpired(job.created_at) && job.status === 'pending') {
    const manifest = await getManifest(jobId);
    await deleteJob(jobId, manifest);
    await supabaseAdmin
      .from('upload_jobs')
      .update({ status: 'cancelled', error_message: 'expired', completed_at: new Date().toISOString() })
      .eq('id', jobId);
    return null;
  }

  return job;
}

function buildAnalysis(files) {
  const paths = files.map((f) => f.path);
  return {
    files: files.map((f) => ({ path: f.path, size: f.buffer.length, secret: isSecretFile(f.path) })),
    totalSize: files.reduce((sum, f) => sum + f.buffer.length, 0),
    fileCount: files.length,
    detectedProjectTypes: detectProjectTypes(paths),
    hasGitignore: hasGitignore(paths),
    gitignoreTemplates: Object.keys(GITIGNORE_TEMPLATES),
  };
}

// ---------------- Analyze: ZIP ----------------

router.post('/analyze-zip', uploadZip.single('zip'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No ZIP file received.' });

    const { safeEntries } = inspectZip(req.file.buffer, {
      maxFiles: env.upload.maxFiles,
      maxExtractedSize: env.upload.maxExtractedSize,
      maxFileSize: env.upload.maxSize,
    });

    const files = safeEntries.map((e) => ({ path: e.path, buffer: readZipEntry(e) }));
    const jobId = nanoid(24);

    // Best-effort — never let a cleanup hiccup block the actual upload.
    await cleanupExpiredJobsForUser(req.user.id, JOB_TTL_MS).catch((err) => {
      console.warn('[uploads] stale job cleanup failed (non-fatal):', err.message);
    });

    const { error: insertErr } = await supabaseAdmin.from('upload_jobs').insert({
      id: jobId,
      user_id: req.user.id,
      repository_owner: '',
      repository_name: '',
      branch: '',
      target_path: '',
      status: 'pending',
      file_count: files.length,
      total_size: files.reduce((s, f) => s + f.buffer.length, 0),
    });
    if (insertErr) throw new Error(`Failed to create upload job record: ${insertErr.message}`);

    await stageFiles(jobId, files);

    res.json({ jobId, ...buildAnalysis(files) });
  } catch (err) {
    // Security rejections (zip slip, zip bomb, symlink, etc.) land here
    // as 400 — the message is safe to show since it just describes which
    // check failed. Storage-side failures (status: 403/429 embedded in
    // the message by stageFiles) are surfaced as 502 instead, since
    // those aren't the user's fault and a 400 would wrongly suggest
    // their ZIP itself was invalid.
    const isStorageFailure = /status: (403|429)/.test(err.message);
    res.status(isStorageFailure ? 502 : 400).json({ error: err.message });
  }
});

// ---------------- Analyze: individual files / folder ----------------
// Client sends `files` (multipart array) + `paths` (JSON array of
// relative paths, same order as files — the browser's File API doesn't
// transmit webkitRelativePath automatically, so the client sends it
// explicitly).

router.post('/analyze-files', uploadFiles.array('files', env.upload.maxFiles), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'No files received.' });

    let relPaths;
    try {
      relPaths = JSON.parse(req.body.paths || '[]');
    } catch {
      return res.status(400).json({ error: 'Malformed "paths" field.' });
    }
    if (relPaths.length !== req.files.length) {
      return res.status(400).json({ error: 'paths array length must match the number of uploaded files.' });
    }

    let totalSize = 0;
    const files = req.files.map((f, i) => {
      const relPath = relPaths[i];
      if (!isSafeRelativePath(relPath)) {
        throw new Error(`Unsafe path: "${relPath}" — path traversal attempt. Whole upload rejected.`);
      }
      totalSize += f.buffer.length;
      if (totalSize > env.upload.maxExtractedSize) {
        throw new Error(`Total upload size exceeds the ${(env.upload.maxExtractedSize / 1_000_000).toFixed(0)}MB limit.`);
      }
      return { path: relPath, buffer: f.buffer };
    });

    const jobId = nanoid(24);

    // Best-effort — never let a cleanup hiccup block the actual upload.
    await cleanupExpiredJobsForUser(req.user.id, JOB_TTL_MS).catch((err) => {
      console.warn('[uploads] stale job cleanup failed (non-fatal):', err.message);
    });

    const { error: insertErr } = await supabaseAdmin.from('upload_jobs').insert({
      id: jobId,
      user_id: req.user.id,
      repository_owner: '',
      repository_name: '',
      branch: '',
      target_path: '',
      status: 'pending',
      file_count: files.length,
      total_size: totalSize,
    });
    if (insertErr) {
      // id here is our own nanoid, not a uuid — upload_jobs.id must accept
      // text for this path. See note in db/schema.sql.
      throw new Error(`Failed to create upload job record: ${insertErr.message}`);
    }

    await stageFiles(jobId, files);

    res.json({ jobId, ...buildAnalysis(files) });
  } catch (err) {
    const isStorageFailure = /status: (403|429)/.test(err.message);
    res.status(isStorageFailure ? 502 : 400).json({ error: err.message });
  }
});

// ---------------- Commit a staged upload ----------------

router.post('/:jobId/commit', async (req, res) => {
  const { jobId } = req.params;

  const job = await loadOwnedJob(jobId, req.user.id);
  if (!job) {
    return res.status(404).json({ error: 'Upload not found or already committed/expired. Re-upload and try again.' });
  }

  const manifest = await getManifest(jobId);
  if (!manifest) {
    return res.status(404).json({ error: 'Upload not found or already committed/expired. Re-upload and try again.' });
  }

  try {
    const connection = await resolveConnection(req.user.id);
    if (!requireConnection(connection, res)) return;

    const { owner, repo, branch, targetPath = '', message, excludePaths = [], gitignoreTemplate } = req.body || {};
    if (!owner || !repo || !branch || !message) {
      return res.status(400).json({ error: 'owner, repo, branch, and message are required.' });
    }

    const excludeSet = new Set(excludePaths);
    const cleanTargetPath = targetPath.replace(/^\/+|\/+$/g, ''); // trim leading/trailing slashes
    if (targetPath && !isSafeRelativePath(targetPath)) {
      return res.status(400).json({ error: 'Invalid target path.' });
    }

    const keptManifest = manifest.filter((f) => !excludeSet.has(f.path));
    const staged = await getFiles(jobId, keptManifest);

    let files = staged.map((f) => ({
      path: cleanTargetPath ? `${cleanTargetPath}/${f.path}` : f.path,
      content: f.buffer,
    }));

    if (gitignoreTemplate) {
      const template = GITIGNORE_TEMPLATES[gitignoreTemplate];
      if (!template) return res.status(400).json({ error: `Unknown gitignore template "${gitignoreTemplate}".` });
      const gitignorePath = cleanTargetPath ? `${cleanTargetPath}/.gitignore` : '.gitignore';
      if (!files.some((f) => f.path === gitignorePath)) {
        files.push({ path: gitignorePath, content: Buffer.from(template, 'utf-8') });
      }
    }

    if (!files.length) {
      return res.status(400).json({ error: 'No files left to commit after exclusions.' });
    }

    await supabaseAdmin
      .from('upload_jobs')
      .update({ status: 'processing', progress_stage: 'blobs', progress_completed: 0, progress_total: files.length })
      .eq('id', jobId);

    // Persists real progress as it happens so the client (polling GET
    // /:jobId) can render an accurate bar — throttled so a 200-file
    // upload doesn't fire 200 writes; every stage change always writes.
    let lastWrite = 0;
    const writeInterval = Math.max(1, Math.ceil(files.length / 20));
    let lastStage = null;
    const onProgress = ({ stage, completed, total }) => {
      const stageChanged = stage !== lastStage;
      lastStage = stage;
      if (!stageChanged && completed - lastWrite < writeInterval && completed !== total) return;
      lastWrite = completed;
      supabaseAdmin
        .from('upload_jobs')
        .update({ progress_stage: stage, progress_completed: completed, progress_total: total })
        .eq('id', jobId)
        .then(() => {});
    };

    const result = await bulkCommitService.commitFiles(connection.octokit, owner, repo, branch, files, message, onProgress);

    await supabaseAdmin
      .from('upload_jobs')
      .update({
        repository_owner: owner,
        repository_name: repo,
        branch,
        target_path: cleanTargetPath,
        status: 'success',
        file_count: files.length,
        commit_sha: result.commit_sha,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    await supabaseAdmin.from('activity_logs').insert({
      user_id: req.user.id,
      action: 'upload_commit',
      resource_type: 'upload',
      resource_id: `${owner}/${repo}:${branch}`,
      status: 'success',
    });

    await deleteJob(jobId, manifest);
    res.json({ commit_sha: result.commit_sha, file_count: files.length });
  } catch (err) {
    await supabaseAdmin
      .from('upload_jobs')
      .update({ status: 'failed', error_message: err.message, completed_at: new Date().toISOString() })
      .eq('id', jobId);
    res.status(502).json({ error: 'Failed to commit upload to GitHub.', detail: err.message });
  }
});

router.post('/:jobId/cancel', async (req, res) => {
  const { jobId } = req.params;

  const job = await loadOwnedJob(jobId, req.user.id);
  if (job) {
    const manifest = await getManifest(jobId);
    await deleteJob(jobId, manifest);
  }

  await supabaseAdmin
    .from('upload_jobs')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('user_id', req.user.id);

  res.json({ cancelled: true });
});

router.get('/:jobId', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('upload_jobs')
    .select('*')
    .eq('id', req.params.jobId)
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (error || !data) return res.status(404).json({ error: 'Upload job not found.' });
  res.json(data);
});

router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('upload_jobs')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return res.status(502).json({ error: 'Failed to load upload history.' });
  res.json({ jobs: data });
});

export default router;
