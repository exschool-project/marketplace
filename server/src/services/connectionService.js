import { Octokit } from '@octokit/rest';
import { supabaseAdmin } from '../db/supabase.js';
import { getInstallationOctokit } from './githubService.js';
import { decryptToken } from './cryptoService.js';

// ---------------------------------------------------------------
// Vercel connection resolution
// ---------------------------------------------------------------
// Deliberately separate from everything above: a Vercel connection lives
// in its own table (user_vercel_connections), is resolved independently
// of GitHub, and its decrypted token is never handed to githubService.js
// or vice versa. GitHub being connected/disconnected has no effect here,
// and disconnecting Vercel never touches github_connections.
export async function resolveVercelConnection(userId) {
  const { data: conn } = await supabaseAdmin
    .from('user_vercel_connections')
    .select('encrypted_token, vercel_user_id, vercel_username, vercel_email, last_verified_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (!conn?.encrypted_token) return null;

  return {
    token: decryptToken(conn.encrypted_token),
    vercelUserId: conn.vercel_user_id,
    vercelUsername: conn.vercel_username,
    vercelEmail: conn.vercel_email,
    lastVerifiedAt: conn.last_verified_at,
  };
}

export function requireVercelConnection(connection, res) {
  if (!connection) {
    res.status(409).json({
      error: 'Connect your Vercel account to continue.',
      action: 'connect_vercel',
    });
    return false;
  }
  return true;
}

export async function getInstallationId(userId) {
  const { data } = await supabaseAdmin
    .from('github_connections')
    .select('installation_id')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.installation_id || null;
}

export function requireInstallation(installationId, res) {
  if (!installationId) {
    res.status(409).json({
      error: 'GitHub App is not installed on your account yet.',
      action: 'install_app',
    });
    return false;
  }
  return true;
}

/**
 * The mode-aware entry point every route should use to get an
 * authenticated Octokit for the current user, regardless of whether
 * they connected via Simple Mode (OAuth) or Developer Mode (GitHub
 * App) — callers don't need to know or care which. Returns null if
 * there's no usable connection yet; pair with requireConnection() to
 * turn that into the right HTTP response.
 */
export async function resolveConnection(userId) {
  const { data: conn } = await supabaseAdmin
    .from('github_connections')
    .select('auth_mode, installation_id, access_token_encrypted')
    .eq('user_id', userId)
    .maybeSingle();

  if (!conn) return null;

  if (conn.auth_mode === 'oauth') {
    if (!conn.access_token_encrypted) return null; // connected but token missing — treat as disconnected
    const token = decryptToken(conn.access_token_encrypted);
    return { authMode: 'oauth', octokit: new Octokit({ auth: token }) };
  }

  if (!conn.installation_id) return null;
  return {
    authMode: 'github_app',
    installationId: conn.installation_id,
    octokit: await getInstallationOctokit(conn.installation_id),
  };
}

/**
 * Mirrors requireInstallation()'s shape but for resolveConnection()'s
 * richer result, and with copy that doesn't assume Developer Mode —
 * Simple Mode users have never heard of "installing an app" and
 * shouldn't see that phrase.
 */
export function requireConnection(connection, res) {
  if (!connection) {
    res.status(409).json({
      error: 'Connect your GitHub account to continue.',
      action: 'connect_github',
    });
    return false;
  }
  return true;
}
