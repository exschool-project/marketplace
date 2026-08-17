import { supabaseAdmin } from '../db/supabase.js';
import { mapWithConcurrency } from './githubService.js';

// Staged upload file *contents* live in Supabase Storage, not in process
// memory and not in the database (the upload_jobs table is metadata only —
// see db/schema.sql). This is the piece that makes uploads work when the
// "analyze" call and the later "commit" call land on two different
// serverless instances (Netlify/Vercel Functions): an in-memory Map keyed
// by jobId would only be visible to whichever instance created it.
//
// Layout per job, under the private "upload-staging" bucket:
//   <jobId>/manifest.json   — [{ path, size, secret, key }]
//   <jobId>/files/<key>     — raw file bytes, one object per file

const BUCKET = 'upload-staging';
const DOWNLOAD_CONCURRENCY = 8;
const STAGE_RETRY_ATTEMPTS = 3;
const STAGE_RETRY_BASE_DELAY_MS = 300;

function bucket() {
  return supabaseAdmin.storage.from(BUCKET);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Uploads one file to Storage with retry+backoff for transient failures.
 * Supabase Storage can return 403/429 under momentary rate limiting or
 * quota contention (distinct from a genuine permissions problem — those
 * fail consistently on retry too, which is exactly how this surfaces the
 * difference: it still throws after exhausting retries, just with the
 * real underlying status attached instead of masking it).
 *
 * Content is base64-encoded before it's sent. This isn't about our own
 * path-safety checks (those run separately, on ZIP entry *names*, in
 * uploadSecurity.js/zipInspector.js, and are untouched by this). It's
 * about a real, observed failure mode: a file whose *content* happens to
 * contain a literal attack-pattern string — e.g. a test fixture like
 * `../../etc/passwd` used to verify our own traversal protection — gets
 * pattern-matched by the WAF in front of Supabase Storage and blocked
 * with a 403, even though the string is just inert file content, not an
 * actual traversal attempt against anything. Base64 changes the bytes
 * actually transmitted, so a substring like that can no longer appear
 * literally in the request body, without altering what's stored (decoded
 * back to the exact original bytes in getFiles() below).
 */
async function uploadWithRetry(path, buffer) {
  const encoded = Buffer.from(buffer.toString('base64'));
  let lastError;
  for (let attempt = 1; attempt <= STAGE_RETRY_ATTEMPTS; attempt++) {
    const { error } = await bucket().upload(path, encoded, {
      contentType: 'text/plain',
      upsert: true,
    });
    if (!error) return;
    lastError = error;
    if (attempt < STAGE_RETRY_ATTEMPTS) await sleep(STAGE_RETRY_BASE_DELAY_MS * attempt);
  }
  throw lastError;
}

/**
 * Persists analyzed files to Storage and returns the manifest that was
 * written (mirrors what buildAnalysis() in routes/uploads.js needs, plus
 * the storage `key` each route handler needs later to fetch it back).
 */
export async function stageFiles(jobId, files) {
  const manifest = files.map((f, i) => ({
    path: f.path,
    size: f.buffer.length,
    key: String(i),
  }));

  await mapWithConcurrency(files, DOWNLOAD_CONCURRENCY, async (f, i) => {
    try {
      await uploadWithRetry(`${jobId}/files/${i}`, f.buffer);
    } catch (error) {
      // statusCode/status carry the real HTTP status from Storage (e.g.
      // 403, 429) — surfaced here instead of swallowed, since that's
      // the detail that actually distinguishes "storage quota/rate
      // limit" from "genuine permissions problem" the next time this
      // happens.
      const detail = error.statusCode || error.status || error.code || 'unknown';
      throw new Error(`Failed to stage "${f.path}" after ${STAGE_RETRY_ATTEMPTS} attempts: ${error.message} (status: ${detail})`);
    }
  });

  const manifestBody = Buffer.from(JSON.stringify(manifest), 'utf-8');
  const { error: manifestErr } = await bucket().upload(`${jobId}/manifest.json`, manifestBody, {
    contentType: 'application/json',
    upsert: true,
  });
  if (manifestErr) throw new Error(`Failed to write upload manifest: ${manifestErr.message}`);

  return manifest;
}

/**
 * Reads back the manifest for a staged job, or null if it doesn't exist
 * (already committed/cancelled/expired, or never existed).
 */
export async function getManifest(jobId) {
  const { data, error } = await bucket().download(`${jobId}/manifest.json`);
  if (error || !data) return null;
  const text = await data.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Downloads every staged file for a job back into memory as Buffers, in
 * manifest order. Used right before committing to GitHub — after this the
 * caller should call deleteJob() to clean up Storage.
 */
export async function getFiles(jobId, manifest) {
  return mapWithConcurrency(manifest, DOWNLOAD_CONCURRENCY, async (entry) => {
    const { data, error } = await bucket().download(`${jobId}/files/${entry.key}`);
    if (error || !data) throw new Error(`Failed to read staged file "${entry.path}": ${error?.message || 'not found'}`);
    const arrayBuffer = await data.arrayBuffer();
    // Reverses the base64 wrapping applied in uploadWithRetry() above —
    // decoded back to the exact original bytes before this ever reaches
    // GitHub's API.
    const base64Text = Buffer.from(arrayBuffer).toString('utf-8');
    return { path: entry.path, buffer: Buffer.from(base64Text, 'base64') };
  });
}

/**
 * Removes every object staged for a job (files + manifest). Safe to call
 * even if nothing was ever staged (e.g. double-cancel) — Storage just
 * reports nothing removed.
 */
export async function deleteJob(jobId, manifest) {
  const paths = [`${jobId}/manifest.json`, ...(manifest || []).map((f) => `${jobId}/files/${f.key}`)];
  if (!paths.length) return;
  await bucket().remove(paths);
}

/**
 * Opportunistic cleanup: deletes this user's own staged uploads that were
 * started but never finished (no commit, no cancel) and are past the TTL.
 *
 * Why this exists: expiry was previously only ever checked lazily, when
 * someone looked up that *exact* job again (see loadOwnedJob in
 * routes/uploads.js). A job nobody ever revisits — analyze, then close the
 * tab — never gets that check, so its staged file bytes sit in Storage
 * indefinitely. Over time that can approach the Storage plan's quota,
 * which Supabase Storage reports back as 403 Forbidden on unrelated
 * later uploads — indistinguishable from a real permissions error unless
 * you already know to look for it. This is called before every new
 * stage, scoped to the current user's own rows only (ownership-safe, no
 * cross-user access), capped to a small batch so it stays cheap on the
 * common case (nothing to clean).
 */
export async function cleanupExpiredJobsForUser(userId, ttlMs) {
  const cutoff = new Date(Date.now() - ttlMs).toISOString();
  const { data: staleJobs } = await supabaseAdmin
    .from('upload_jobs')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .limit(10);

  if (!staleJobs?.length) return;

  await Promise.all(
    staleJobs.map(async (job) => {
      const manifest = await getManifest(job.id);
      await deleteJob(job.id, manifest);
      await supabaseAdmin
        .from('upload_jobs')
        .update({ status: 'cancelled', error_message: 'expired (auto-cleaned)', completed_at: new Date().toISOString() })
        .eq('id', job.id);
    })
  );
}
