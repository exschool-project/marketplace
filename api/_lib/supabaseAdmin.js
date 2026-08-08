const { createClient } = require('@supabase/supabase-js');

let client = null;

/**
 * Client Supabase sisi server, memakai SERVICE ROLE KEY.
 * Key ini punya akses penuh (melewati RLS) sehingga:
 *  - TIDAK PERNAH dikirim ke browser
 *  - hanya dipakai di dalam fungsi /api setelah role admin diverifikasi
 */
function getSupabaseAdmin() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diatur di environment variables.'
    );
  }

  client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return client;
}

module.exports = { getSupabaseAdmin };
