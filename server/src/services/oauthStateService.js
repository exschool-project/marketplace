import { nanoid } from 'nanoid';
import { supabaseAdmin } from '../db/supabase.js';

const TABLE = 'oauth_states';
const STATE_TTL_MS = 5 * 60 * 1000; // OAuth round-trip should complete in seconds, not minutes

/**
 * Creates and persists a fresh CSRF state for the /api/auth/github redirect.
 * Persisted (not in-memory) so the callback request — which may land on a
 * different process/instance on serverless platforms — can still find it.
 */
export async function createState() {
  const state = nanoid(24);
  const { error } = await supabaseAdmin.from(TABLE).insert({ state });
  if (error) throw new Error(`createState failed: ${error.message}`);

  // Best-effort sweep of old rows. Not awaited-critical — if it fails,
  // stale rows just linger harmlessly until the next successful sweep.
  cleanupExpiredStates().catch(() => {});

  return state;
}

/**
 * Atomically checks a state exists and deletes it in one round trip, so a
 * state can only ever be consumed once (delete returns the deleted row, or
 * nothing if it was missing/already used/expired).
 */
export async function consumeState(state) {
  if (!state) return false;

  const cutoff = new Date(Date.now() - STATE_TTL_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .delete()
    .eq('state', state)
    .gt('created_at', cutoff)
    .select('state')
    .maybeSingle();

  if (error) throw new Error(`consumeState failed: ${error.message}`);
  return Boolean(data);
}

async function cleanupExpiredStates() {
  const cutoff = new Date(Date.now() - STATE_TTL_MS).toISOString();
  await supabaseAdmin.from(TABLE).delete().lt('created_at', cutoff);
}
