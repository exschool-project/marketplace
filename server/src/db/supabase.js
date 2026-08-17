import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// SERVICE ROLE KEY never leaves the server. It bypasses RLS, so every
// query here must manually scope by user_id — do not expose this client
// or its key to the frontend under any circumstance.
export const supabaseAdmin = createClient(env.supabase.url, env.supabase.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
