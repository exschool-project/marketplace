import crypto from 'crypto';

// Thin wrapper around the real Vercel REST API (https://vercel.com/docs/rest-api).
// Deliberately kept separate from githubService.js — a GitHub token and a
// Vercel token must never mix or be resolved by the same code path (see
// connectionService.js for GitHub, resolveVercelConnection() in routes for
// Vercel). Every function here takes the caller's Vercel token explicitly;
// nothing in this file ever reads it from an env var or a global.

const BASE_URL = 'https://api.vercel.com';

// A structured error carrying the upstream HTTP status + a message that's
// already safe to show a user (no stack trace, no raw Vercel payload,
// never a token). Routes translate this into the right response code.
export class VercelApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'VercelApiError';
    this.status = status;
    this.code = code;
  }
}

function friendlyMessage(status, body) {
  const upstreamCode = body?.error?.code;
  if (status === 401 || upstreamCode === 'forbidden' || upstreamCode === 'not_authorized') {
    return 'Vercel token invalid or revoked.';
  }
  if (status === 403) {
    return "You don't have permission to access this Vercel resource.";
  }
  if (status === 404) {
    return 'Vercel resource not found.';
  }
  if (status === 409) {
    return 'This Vercel resource already exists or is in a conflicting state.';
  }
  if (status === 429) {
    return 'Vercel API rate limit reached. Please try again shortly.';
  }
  if (status >= 500) {
    return 'Vercel is currently unavailable. Please try again shortly.';
  }
  return body?.error?.message || 'Vercel API request failed.';
}

async function vercelFetch(token, path, { method = 'GET', query, body, headers, rawBody } = {}) {
  const url = new URL(path.startsWith('http') ? path : `${BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, value);
    }
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(rawBody ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // Network-level failure (DNS, timeout, etc) — never surface err.message
    // raw since it can include local paths/host details.
    throw new VercelApiError(502, 'Could not reach Vercel. Please try again.', 'network_error');
  }

  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    throw new VercelApiError(res.status, friendlyMessage(res.status, json), json?.error?.code);
  }
  return json ?? {};
}

// ---------------- Account ----------------

export function getUser(token) {
  return vercelFetch(token, '/v2/user');
}

// ---------------- Projects ----------------

export function listProjects(token, { limit = 100, search, teamId } = {}) {
  return vercelFetch(token, '/v9/projects', { query: { limit, search, teamId } });
}

export function getProject(token, idOrName, { teamId } = {}) {
  return vercelFetch(token, `/v9/projects/${encodeURIComponent(idOrName)}`, { query: { teamId } });
}

export function createProject(token, body, { teamId } = {}) {
  return vercelFetch(token, '/v10/projects', { method: 'POST', query: { teamId }, body });
}

export function updateProject(token, idOrName, patch, { teamId } = {}) {
  return vercelFetch(token, `/v9/projects/${encodeURIComponent(idOrName)}`, {
    method: 'PATCH',
    query: { teamId },
    body: patch,
  });
}

// ---------------- Deployments ----------------

export function listDeployments(token, { projectId, limit = 20, since, until, state, teamId } = {}) {
  return vercelFetch(token, '/v6/deployments', {
    query: { projectId, limit, since, until, state, teamId },
  });
}

export function getDeployment(token, id, { teamId } = {}) {
  return vercelFetch(token, `/v13/deployments/${encodeURIComponent(id)}`, { query: { teamId } });
}

export function createDeployment(token, body, { teamId, forceNew } = {}) {
  return vercelFetch(token, '/v13/deployments', {
    method: 'POST',
    query: { teamId, forceNew: forceNew ? 1 : undefined, skipAutoDetectionConfirmation: 1 },
    body,
  });
}

// A "redeploy" on Vercel is just a new deployment created from an existing
// one's id — all settings are inherited unless overridden.
export function redeploy(token, deploymentId, { name, target, teamId } = {}) {
  return vercelFetch(token, '/v13/deployments', {
    method: 'POST',
    query: { teamId },
    body: { deploymentId, name, target },
  });
}

export function cancelDeployment(token, id, { teamId } = {}) {
  return vercelFetch(token, `/v12/deployments/${encodeURIComponent(id)}/cancel`, {
    method: 'PATCH',
    query: { teamId },
  });
}

export function promoteDeployment(token, projectIdOrName, deploymentId, { teamId } = {}) {
  return vercelFetch(token, `/v10/projects/${encodeURIComponent(projectIdOrName)}/promote/${encodeURIComponent(deploymentId)}`, {
    method: 'POST',
    query: { teamId },
  });
}

// Build/deployment events (logs). Sanitized by the caller (routes/vercel.js)
// before anything reaches the frontend — this just returns the raw events.
export function getDeploymentEvents(token, id, { teamId, builds = 1 } = {}) {
  return vercelFetch(token, `/v3/deployments/${encodeURIComponent(id)}/events`, {
    query: { teamId, builds, direction: 'forward' },
  });
}

// ---------------- File upload (for non-git deployments) ----------------
// Two-step flow per Vercel's docs: upload each file's raw bytes here first
// (identified by its own SHA1), then reference { file, sha, size } in
// createDeployment()'s `files` array.
export function uploadFile(token, buffer, { teamId } = {}) {
  const sha = crypto.createHash('sha1').update(buffer).digest('hex');
  return vercelFetch(token, '/v2/files', {
    method: 'POST',
    query: { teamId },
    rawBody: buffer,
    headers: {
      'x-vercel-digest': sha,
      'Content-Length': String(buffer.length),
    },
  }).then((res) => ({ ...res, sha, size: buffer.length }));
}

// ---------------- Domains ----------------

export function listDomains(token, projectIdOrName, { teamId } = {}) {
  return vercelFetch(token, `/v9/projects/${encodeURIComponent(projectIdOrName)}/domains`, { query: { teamId } });
}

export function addDomain(token, projectIdOrName, name, { teamId } = {}) {
  return vercelFetch(token, `/v10/projects/${encodeURIComponent(projectIdOrName)}/domains`, {
    method: 'POST',
    query: { teamId },
    body: { name },
  });
}

export function removeDomain(token, projectIdOrName, domain, { teamId } = {}) {
  return vercelFetch(token, `/v9/projects/${encodeURIComponent(projectIdOrName)}/domains/${encodeURIComponent(domain)}`, {
    method: 'DELETE',
    query: { teamId },
  });
}

export function verifyDomain(token, projectIdOrName, domain, { teamId } = {}) {
  return vercelFetch(token, `/v9/projects/${encodeURIComponent(projectIdOrName)}/domains/${encodeURIComponent(domain)}/verify`, {
    method: 'POST',
    query: { teamId },
  });
}

// ---------------- Environment variables ----------------

export function listEnv(token, projectIdOrName, { teamId, decrypt = false } = {}) {
  return vercelFetch(token, `/v9/projects/${encodeURIComponent(projectIdOrName)}/env`, {
    query: { teamId, decrypt: decrypt ? 'true' : undefined },
  });
}

export function createEnv(token, projectIdOrName, body, { teamId } = {}) {
  return vercelFetch(token, `/v10/projects/${encodeURIComponent(projectIdOrName)}/env`, {
    method: 'POST',
    query: { teamId, upsert: 'true' },
    body,
  });
}

export function updateEnv(token, projectIdOrName, envId, patch, { teamId } = {}) {
  return vercelFetch(token, `/v9/projects/${encodeURIComponent(projectIdOrName)}/env/${encodeURIComponent(envId)}`, {
    method: 'PATCH',
    query: { teamId },
    body: patch,
  });
}

export function deleteEnv(token, projectIdOrName, envId, { teamId } = {}) {
  return vercelFetch(token, `/v9/projects/${encodeURIComponent(projectIdOrName)}/env/${encodeURIComponent(envId)}`, {
    method: 'DELETE',
    query: { teamId },
  });
}
