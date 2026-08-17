import { getSession } from '../services/sessionService.js';
import { supabaseAdmin } from '../db/supabase.js';
import { env } from '../config/env.js';

// Attaches req.user if a valid session cookie is present. Does NOT reject
// the request — use requireAuth() after this for routes that must be
// authenticated.
export async function attachUser(req, res, next) {
  try {
    const sessionId = req.signedCookies?.[env.session.cookieName];
    const session = await getSession(sessionId);
    if (!session) {
      req.user = null;
      return next();
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, github_username, display_name, avatar_url, github_user_id')
      .eq('id', session.user_id)
      .maybeSingle();

    req.user = profile || null;
    req.sessionId = session.id;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'GitHub authorization expired or missing. Please sign in.' });
  }
  next();
}
