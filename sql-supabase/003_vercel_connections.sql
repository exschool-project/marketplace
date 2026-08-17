-- ============================================================
-- Migration: Vercel Workspace (independent Vercel connection)
-- Run this once in Supabase SQL Editor (Project > SQL Editor > New query).
-- Safe to re-run — every statement below is idempotent.
-- ============================================================

-- A user's Vercel connection is entirely separate from github_connections
-- on purpose — GitHub and Vercel can each be connected, disconnected, or
-- reconnected independently, and neither table references the other.
create table if not exists user_vercel_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  encrypted_token text not null,
  vercel_user_id text,
  vercel_username text,
  vercel_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_verified_at timestamptz
);

create unique index if not exists user_vercel_connections_user_id_key
  on user_vercel_connections(user_id);

alter table user_vercel_connections enable row level security;

drop policy if exists "user_vercel_connections: read own" on user_vercel_connections;
create policy "user_vercel_connections: read own" on user_vercel_connections
  for select using (auth.uid() = user_id);

-- ============================================================
-- Notes
-- ============================================================
-- - encrypted_token holds only ciphertext (AES-256-GCM, encrypted/
--   decrypted server-side in server/src/services/cryptoService.js, using
--   the *existing* TOKEN_ENCRYPTION_KEY env var — no second key). Supabase
--   itself never sees the plaintext Personal Access Token, and the token
--   is never returned to the frontend — only vercel_username, vercel_email,
--   vercel_user_id, and connection status are.
-- - Deployment/project/domain/env data is NOT mirrored into UPGit's
--   database — it's always fetched live from the Vercel API and never
--   persisted here, per the "don't store large deployment data you don't
--   need" rule.
-- - All writes go through the backend's service-role client, same trust
--   model as every other table in this schema — the RLS policy above is a
--   safety net for a future client-side/anon-key access path, not the
--   current enforcement mechanism (see schema.sql's RLS notes).
