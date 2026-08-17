-- ============================================================
-- Migration: Multi-mode GitHub connection (Simple Mode / Developer Mode)
-- Run this once in Supabase SQL Editor (Project > SQL Editor > New query).
-- Safe to re-run — every statement below is idempotent.
-- ============================================================

-- 1. Which mode this user connected with, and (for Simple Mode only)
--    their encrypted GitHub access token.
alter table github_connections add column if not exists auth_mode text not null default 'github_app';
alter table github_connections add column if not exists access_token_encrypted text;

-- 2. Restrict auth_mode to the two valid values.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'github_connections_auth_mode_check'
  ) then
    alter table github_connections add constraint github_connections_auth_mode_check
      check (auth_mode in ('oauth', 'github_app'));
  end if;
end $$;

-- ============================================================
-- Notes
-- ============================================================
-- - installation_id stays exactly as it was — Developer Mode (GitHub
--   App) is unaffected by this migration.
-- - access_token_encrypted is only ever populated for auth_mode='oauth'
--   rows, and only ever holds ciphertext (AES-256-GCM, encrypted/decrypted
--   server-side in server/src/services/cryptoService.js using the
--   TOKEN_ENCRYPTION_KEY environment variable). Supabase itself never
--   sees the plaintext token.
-- - No new table, no data migration needed for existing rows — every
--   existing github_connections row defaults to auth_mode='github_app',
--   which matches what it already was before this migration existed.
