import { nanoid } from 'nanoid';
import { supabaseAdmin } from '../db/supabase.js';
import { env } from '../config/env.js';

const TABLE = 'sessions';

export async function createSession(userId) {
  const id = nanoid(48); // opaque, unguessable session id
  const expiresAt = new Date(Date.now() + env.session.ttlHours * 3600 * 1000).toISOString();

  const { error } = await supabaseAdmin.from(TABLE).insert({
    id,
    user_id: userId,
    expires_at: expiresAt,
  });

  if (error) throw new Error(`createSession failed: ${error.message}`);
  return { id, expiresAt };
}

export async function getSession(sessionId) {
  if (!sessionId) return null;

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('id, user_id, expires_at')
    .eq('id', sessionId)
    .maybeSingle();

  if (error || !data) return null;
  if (new Date(data.expires_at) < new Date()) {
    // Expired — clean up lazily and treat as unauthenticated.
    await destroySession(sessionId);
    return null;
  }
  return data;
}

export async function destroySession(sessionId) {
  if (!sessionId) return;
  await supabaseAdmin.from(TABLE).delete().eq('id', sessionId);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    signed: true,
    maxAge: env.session.ttlHours * 3600 * 1000,
    path: '/',
  };
}
