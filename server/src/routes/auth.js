import { Router } from 'express';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../db/supabase.js';
import { createSession, destroySession, getSession, sessionCookieOptions } from '../services/sessionService.js';
import { createState, consumeState } from '../services/oauthStateService.js';
import { exchangeUserCode, fetchGithubUser, findInstallationForUser } from '../services/githubService.js';
import { encryptToken, decryptToken } from '../services/cryptoService.js';

const router = Router();

/**
 * Simple Mode needs its own standalone OAuth App credentials (see the
 * comment on env.github.oauthClientId in config/env.js for why — short
 * version: a GitHub App's user token is still bottlenecked by whether
 * it's installed somewhere, which defeats the whole point of "no install
 * step"). These aren't in env.js's boot-time required list, since a
 * deployment that only wants Developer Mode shouldn't be forced to set
 * them up — so they're checked here instead, right where Simple Mode is
 * actually entered.
 */
function requireOAuthConfigured(res) {
  if (!env.github.oauthClientId || !env.github.oauthClientSecret || !env.tokenEncryptionKey) {
    res.status(503).json({
      error: 'Simple Mode is not configured on this server yet. An administrator needs to set GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET, and TOKEN_ENCRYPTION_KEY.',
    });
    return false;
  }
  return true;
}

async function upsertProfile(ghUser) {
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .upsert(
      {
        github_user_id: ghUser.id,
        github_username: ghUser.login,
        display_name: ghUser.name,
        avatar_url: ghUser.avatar_url,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'github_user_id' }
    )
    .select('id')
    .single();
  if (profileErr) throw new Error(`profile upsert failed: ${profileErr.message}`);
  return profile;
}

function finishLogin(req, res, profile) {
  return createSession(profile.id).then((session) => {
    res.cookie(env.session.cookieName, session.id, sessionCookieOptions());
  });
}

// ============================================================
// Developer Mode — GitHub App (existing flow, unchanged in behavior)
// ============================================================

router.get('/github', async (req, res, next) => {
  try {
    const state = await createState();

    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', env.github.clientId);
    url.searchParams.set('redirect_uri', env.github.callbackUrl);
    url.searchParams.set('state', state);
    // No 'scope' param needed for GitHub App user-authorization — access is
    // governed by the App's configured permissions, not OAuth scopes.

    res.redirect(url.toString());
  } catch (err) {
    next(err);
  }
});

router.get('/github/callback', async (req, res) => {
  try {
    const { code, state, installation_id: installationIdParam } = req.query;

    if (!state || !(await consumeState(String(state)))) {
      return res.status(400).send('Invalid or expired login attempt. Please try signing in again.');
    }
    if (!code) {
      return res.status(400).send('Missing authorization code from GitHub.');
    }

    // 1. Identify the user (one-time use of the user access token).
    const userAccessToken = await exchangeUserCode(String(code));
    const ghUser = await fetchGithubUser(userAccessToken);

    // 2. Resolve their App installation (may be null if not installed yet).
    let installationId = installationIdParam ? Number(installationIdParam) : null;
    if (!installationId) {
      const installation = await findInstallationForUser(ghUser.id);
      installationId = installation?.id || null;
    }

    // 3. Upsert profile.
    const profile = await upsertProfile(ghUser);

    // 4. Upsert connection metadata — NOTE: no access token is stored
    // here. Only installation_id is kept; installation tokens are minted
    // on demand server-side (see githubService.getInstallationOctokit).
    if (installationId) {
      const { error: connErr } = await supabaseAdmin.from('github_connections').upsert(
        {
          user_id: profile.id,
          github_user_id: ghUser.id,
          auth_mode: 'github_app',
          installation_id: installationId,
          access_token_encrypted: null, // clears any stale Simple Mode token if they switch modes
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
      if (connErr) throw new Error(`connection upsert failed: ${connErr.message}`);
    }

    // 5. Create session + set cookie.
    await finishLogin(req, res, profile);

    await supabaseAdmin.from('activity_logs').insert({
      user_id: profile.id,
      action: 'login',
      resource_type: 'session',
      status: installationId ? 'success' : 'success_no_installation',
    });

    const redirectTo = installationId
      ? `${env.frontendUrl}/#/dashboard`
      : `${env.frontendUrl}/#/install-app`; // frontend should prompt "Install UPGit on GitHub"

    res.redirect(redirectTo);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[auth/callback] failed:', err.stack || err.message);
    res.status(500).send('GitHub sign-in failed. Please try again.');
  }
});

// ============================================================
// Simple Mode — standalone GitHub OAuth App
// No installation step: the user's own token (scope: repo) is usable
// immediately, personal account included. The trade-off, made explicit
// to the user on the Connect page rather than hidden: their GitHub
// access token has to be stored (encrypted) so UPGit can act as them on
// later requests, since — unlike Developer Mode — there's no
// installation to mint short-lived tokens from.
// ============================================================

router.get('/github/oauth', async (req, res, next) => {
  try {
    if (!requireOAuthConfigured(res)) return;
    const state = await createState();

    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', env.github.oauthClientId);
    url.searchParams.set('redirect_uri', env.github.oauthCallbackUrl);
    url.searchParams.set('scope', 'repo');
    url.searchParams.set('state', state);

    res.redirect(url.toString());
  } catch (err) {
    next(err);
  }
});

router.get('/github/oauth/callback', async (req, res) => {
  try {
    if (!requireOAuthConfigured(res)) return;
    const { code, state } = req.query;

    if (!state || !(await consumeState(String(state)))) {
      return res.status(400).send('Invalid or expired login attempt. Please try signing in again.');
    }
    if (!code) {
      return res.status(400).send('Missing authorization code from GitHub.');
    }

    const userAccessToken = await exchangeUserCode(String(code), {
      clientId: env.github.oauthClientId,
      clientSecret: env.github.oauthClientSecret,
      redirectUri: env.github.oauthCallbackUrl,
    });
    const ghUser = await fetchGithubUser(userAccessToken);

    const profile = await upsertProfile(ghUser);

    const { error: connErr } = await supabaseAdmin.from('github_connections').upsert(
      {
        user_id: profile.id,
        github_user_id: ghUser.id,
        auth_mode: 'oauth',
        installation_id: null, // clears any stale Developer Mode installation if they switch modes
        access_token_encrypted: encryptToken(userAccessToken),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    if (connErr) throw new Error(`connection upsert failed: ${connErr.message}`);

    await finishLogin(req, res, profile);

    await supabaseAdmin.from('activity_logs').insert({
      user_id: profile.id,
      action: 'login',
      resource_type: 'session',
      status: 'success',
    });

    // No installation detour — Simple Mode is immediately usable.
    res.redirect(`${env.frontendUrl}/#/dashboard`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[auth/oauth/callback] failed:', err.stack || err.message);
    res.status(500).send('GitHub sign-in failed. Please try again.');
  }
});

// ============================================================

router.post('/logout', async (req, res) => {
  const sessionId = req.signedCookies?.[env.session.cookieName];

  // Best-effort token revocation for Simple Mode — if UPGit is about to
  // forget this session, it shouldn't leave a still-valid GitHub token
  // sitting in the database with nothing left to enforce its lifecycle.
  // Never blocks logout on failure (revocation hitting a GitHub outage
  // shouldn't trap someone in a session they're trying to leave).
  try {
    const session = sessionId ? await getSession(sessionId) : null;
    if (session) {
      const { data: conn } = await supabaseAdmin
        .from('github_connections')
        .select('auth_mode, access_token_encrypted')
        .eq('user_id', session.user_id)
        .maybeSingle();

      if (conn?.auth_mode === 'oauth' && conn.access_token_encrypted && env.github.oauthClientId) {
        const token = decryptToken(conn.access_token_encrypted);
        await fetch(`https://api.github.com/applications/${env.github.oauthClientId}/token`, {
          method: 'DELETE',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Basic ${Buffer.from(`${env.github.oauthClientId}:${env.github.oauthClientSecret}`).toString('base64')}`,
          },
          body: JSON.stringify({ access_token: token }),
        });
        await supabaseAdmin.from('github_connections').update({ access_token_encrypted: null }).eq('user_id', session.user_id);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[auth/logout] token revocation skipped (non-fatal):', err.message);
  }

  await destroySession(sessionId);
  res.clearCookie(env.session.cookieName, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });

  const { data: conn } = await supabaseAdmin
    .from('github_connections')
    .select('auth_mode, installation_id')
    .eq('user_id', req.user.id)
    .maybeSingle();

  res.json({
    user: req.user,
    github_auth_mode: conn?.auth_mode || null,
    github_connected: conn ? Boolean(conn.auth_mode === 'oauth' ? true : conn.installation_id) : false,
  });
});

export default router;
