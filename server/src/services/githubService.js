import { createAppAuth } from '@octokit/auth-app';
import { Octokit as OctokitCore } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';
import { retry } from '@octokit/plugin-retry';
import { env } from '../config/env.js';

// Octokit + official throttling/retry plugins — this is where GitHub API
// rate-limit handling and exponential backoff actually live, applied
// once here rather than hand-rolled in every route. onRateLimit /
// onSecondaryRateLimit both retry a bounded number of times with
// Octokit's built-in backoff, then give up and let the error surface as
// a normal thrown error (routes already turn that into a 502 with a
// message — good enough for a v1, see README for the "friendlier 429
// message" follow-up idea).
const Octokit = OctokitCore.plugin(throttling, retry);

const THROTTLE_OPTIONS = {
  onRateLimit: (retryAfter, options, octokit, retryCount) => {
    console.warn(`[github] rate limit hit for ${options.method} ${options.url}, retry ${retryCount}`);
    return retryCount < 2; // retry twice, then surface the error
  },
  onSecondaryRateLimit: (retryAfter, options, octokit, retryCount) => {
    console.warn(`[github] secondary rate limit hit for ${options.method} ${options.url}, retry ${retryCount}`);
    return retryCount < 1; // secondary limits are stricter — retry once
  },
};

const appAuth = createAppAuth({
  appId: env.github.appId,
  privateKey: env.github.privateKey,
  clientId: env.github.clientId,
  clientSecret: env.github.clientSecret,
});

// Installation tokens are short-lived (1h) and minted on demand instead of
// persisted in Supabase — this cache just avoids re-minting on every
// request within the same process. It is NOT a substitute for a durable
// store; losing it just means the next request mints a fresh token.
// PORTABILITY NOTE: tokenCache and repoListCache (below) are process-local
// in-memory caches, not persistent state. On a single long-running process
// (VPS/Docker/Render) they cache across requests; on serverless platforms
// (Netlify/Vercel Functions) each cold instance just starts with an empty
// cache and re-fetches — a performance detail, not a correctness one. They
// are intentionally NOT moved to Supabase: unlike OAuth state or upload
// jobs, losing this cache never breaks a request, it only costs one extra
// GitHub API call. Safe to leave as-is on every target platform.
const tokenCache = new Map(); // installationId -> { token, expiresAt }

async function getInstallationToken(installationId) {
  const cached = tokenCache.get(installationId);
  if (cached && new Date(cached.expiresAt).getTime() - Date.now() > 60_000) {
    return cached.token;
  }

  const { token, expiresAt } = await appAuth({
    type: 'installation',
    installationId,
  });

  tokenCache.set(installationId, { token, expiresAt });
  return token;
}

/**
 * Returns an Octokit instance authenticated as the GitHub App installation
 * for a given user. Every repo/file/issue/PR call in the app should go
 * through this — never through a raw personal access token.
 */
export async function getInstallationOctokit(installationId) {
  if (!installationId) {
    throw new Error('Missing installationId — user has not installed the GitHub App yet.');
  }
  const token = await getInstallationToken(installationId);
  return new Octokit({ auth: token, throttle: THROTTLE_OPTIONS });
}

/**
 * Exchanges an OAuth "code" from the user-authorization callback for a
 * user access token. Used only during login to identify who the user is
 * (username, avatar, etc) — NOT used for repository operations, which go
 * through the installation token above.
 */
/**
 * Exchanges an OAuth "code" for a user access token. Defaults to the
 * GitHub App's own OAuth credentials (used by the Developer Mode
 * callback below, just to identify who's logging in — the resulting
 * token is discarded immediately there, never stored). Simple Mode's
 * callback passes the standalone OAuth App's credentials instead, and
 * — unlike Developer Mode — keeps the resulting token (encrypted) since
 * it's what every subsequent GitHub API call in that mode authenticates
 * with.
 */
export async function exchangeUserCode(code, overrides = {}) {
  const clientId = overrides.clientId ?? env.github.clientId;
  const clientSecret = overrides.clientSecret ?? env.github.clientSecret;
  const redirectUri = overrides.redirectUri ?? env.github.callbackUrl;

  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(`GitHub OAuth exchange failed: ${data.error_description || data.error}`);
  }
  return data.access_token; // what the caller does with this varies — see the callers in routes/auth.js
}

export async function fetchGithubUser(userAccessToken) {
  const octokit = new Octokit({ auth: userAccessToken, throttle: THROTTLE_OPTIONS });
  const { data } = await octokit.rest.users.getAuthenticated();
  return data;
}

/**
 * Looks up the installation id for this GitHub user's account, if the
 * GitHub App has been installed. Returns null if not installed yet — the
 * frontend should then prompt the user to install the app.
 */
export async function findInstallationForUser(githubUserId) {
  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.github.appId,
      privateKey: env.github.privateKey,
    },
    throttle: THROTTLE_OPTIONS,
  });

  const installations = await octokit.paginate(octokit.rest.apps.listInstallations, { per_page: 100 });
  return installations.find((i) => i.account?.id === githubUserId) || null;
}

/**
 * Looks up the account (login + type: "User" or "Organization") that a
 * given installation belongs to. Needed because repo creation behaves
 * differently for each — see repositoryService.create() below.
 */
export async function getInstallationAccount(installationId) {
  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: env.github.appId, privateKey: env.github.privateKey },
    throttle: THROTTLE_OPTIONS,
  });
  const { data } = await appOctokit.rest.apps.getInstallation({ installation_id: installationId });
  return { login: data.account?.login, type: data.account?.type }; // type: "User" | "Organization"
}

// ---- Repository service ----------------------------------------------

export const repositoryService = {
  /**
   * authMode 'oauth': lists repos the user's own token can see —
   * personal + org repos alike, exactly like github.com's own repo list.
   * authMode 'github_app': lists repos the *installation* was granted
   * access to (may be "all repos" or a hand-picked subset — the
   * installer chose that during install), which is usually a narrower
   * set on purpose.
   */
  async list(octokit, authMode, { page = 1, perPage = 30 } = {}) {
    if (authMode === 'oauth') {
      const { data } = await octokit.rest.repos.listForAuthenticatedUser({ page, per_page: perPage, sort: 'updated' });
      return { total_count: data.length, repositories: data };
    }
    const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({ page, per_page: perPage });
    return data; // { total_count, repositories }
  },

  async get(octokit, owner, repo) {
    const { data } = await octokit.rest.repos.get({ owner, repo });
    return data;
  },

  /**
   * Creates a new repository.
   * - 'oauth': works for personal accounts too — this is the main
   *   practical reason Simple Mode exists. A user's own token with
   *   `repo` scope can call POST /user/repos directly.
   * - 'github_app': unchanged from before — GitHub Apps can only create
   *   repos inside an ORGANIZATION the app is installed on; an
   *   installation token can never create a repo under a personal
   *   account. Callers must still handle "personal_account_unsupported"
   *   for this mode.
   */
  async create(octokit, authMode, { name, description, isPrivate, installationId }) {
    if (authMode === 'oauth') {
      const { data } = await octokit.rest.repos.createForAuthenticatedUser({
        name,
        description: description || undefined,
        private: Boolean(isPrivate),
      });
      return data;
    }

    const account = await getInstallationAccount(installationId);
    if (account.type !== 'Organization') {
      const err = new Error(
        'Creating a new repository from UPGit only works for organization installations in Developer Mode — switch to Simple Mode (Settings > GitHub connection) to create personal repositories, or install the GitHub App on an organization instead.'
      );
      err.code = 'personal_account_unsupported';
      throw err;
    }
    const { data } = await octokit.rest.repos.createInOrg({
      org: account.login,
      name,
      description: description || undefined,
      private: Boolean(isPrivate),
    });
    return data;
  },
};

// ---- File service -------------------------------------------------------

export const fileService = {
  async getTree(octokit, owner, repo, branch, recursive = true) {
    const { data: refData } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const { data } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: refData.object.sha,
      recursive: recursive ? '1' : undefined,
    });
    return data;
  },

  async getFile(octokit, owner, repo, path, ref) {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref });
    return data;
  },

  async putFile(octokit, owner, repo, path, { content, message, branch, sha }) {
    const { data } = await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content, // must be base64-encoded by the caller
      branch,
      sha, // required when overwriting an existing file
    });
    return data;
  },

  async deleteFile(octokit, owner, repo, path, { message, branch, sha }) {
    const { data } = await octokit.rest.repos.deleteFile({ owner, repo, path, message, branch, sha });
    return data;
  },
};

// ---- Branch service -------------------------------------------------------

export const branchService = {
  async list(octokit, owner, repo) {
    return octokit.paginate(octokit.rest.repos.listBranches, { owner, repo, per_page: 100 });
  },

  async create(octokit, owner, repo, newBranch, fromBranch) {
    const { data: refData } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${fromBranch}` });
    const { data } = await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${newBranch}`,
      sha: refData.object.sha,
    });
    return data;
  },

  async delete(octokit, owner, repo, branch, defaultBranch) {
    if (branch === defaultBranch) {
      throw new Error('Refusing to delete the default branch.');
    }
    await octokit.rest.git.deleteRef({ owner, repo, ref: `heads/${branch}` });
    return { deleted: true };
  },
};

// ---- Bulk commit service (Git Data API) -----------------------------------
// Used by the upload system to commit many files in ONE commit instead of
// one Contents-API call per file — much cheaper on GitHub's rate limit
// for a 50+ file project upload.

export async function mapWithConcurrency(items, limit, fn, onEach) {
  const results = new Array(items.length);
  let cursor = 0;
  let completed = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
      completed++;
      if (onEach) onEach(completed, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export const bulkCommitService = {
  /**
   * files: [{ path: 'src/index.js', content: Buffer }]
   * Creates one blob per file, one tree, one commit, then fast-forwards
   * the branch ref to it. All-or-nothing: if any blob/tree/commit step
   * fails, the branch ref is never touched, so a failed upload can't
   * leave a repo half-committed. Works identically for both auth modes —
   * it's all plain Git Data API calls on an already-authenticated
   * octokit, nothing installation-specific in here.
   */
  async commitFiles(octokit, owner, repo, branch, files, message, onProgress) {
    const report = (stage, completed, total) => {
      if (onProgress) onProgress({ stage, completed, total });
    };

    report('base', 0, files.length);
    const { data: refData } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const baseCommitSha = refData.object.sha;
    const { data: baseCommit } = await octokit.rest.git.getCommit({ owner, repo, commit_sha: baseCommitSha });

    report('blobs', 0, files.length);
    const treeEntries = await mapWithConcurrency(
      files,
      5,
      async (f) => {
        const { data: blob } = await octokit.rest.git.createBlob({
          owner,
          repo,
          content: f.content.toString('base64'),
          encoding: 'base64',
        });
        return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
      },
      // Fires after each blob actually lands on GitHub — this is real
      // progress, not a simulated curve, so the client can show an
      // accurate "N of M files" count while it's still happening.
      (completed, total) => report('blobs', completed, total)
    );

    report('tree', files.length, files.length);
    const { data: newTree } = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: baseCommit.tree.sha,
      tree: treeEntries,
    });

    report('commit', files.length, files.length);
    const { data: newCommit } = await octokit.rest.git.createCommit({
      owner,
      repo,
      message,
      tree: newTree.sha,
      parents: [baseCommitSha],
    });

    report('ref', files.length, files.length);
    await octokit.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: newCommit.sha });

    report('done', files.length, files.length);
    return { commit_sha: newCommit.sha, file_count: files.length };
  },
};
