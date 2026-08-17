-- UPGit database schema (Supabase / Postgres)
-- Run in Supabase SQL editor, or via `supabase db push`.
-- All tables use UUID primary keys and Row Level Security.

create extension if not exists "pgcrypto";

-- ============================================================
-- profiles
-- ============================================================
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  github_user_id bigint unique not null,
  github_username text not null,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- github_connections
-- One row per user. Two connection modes, only one populated per row:
--   - 'github_app'  -> installation_id (existing flow, unchanged).
--     No token stored — installation access tokens are minted on demand
--     server-side via @octokit/auth-app.
--   - 'oauth'       -> access_token_encrypted (new, Simple Mode). A real
--     GitHub user access token has to persist between logins here since
--     there's no installation to mint a fresh one from — see the
--     encrypt/decrypt pair in services/cryptoService.js. This is the one
--     deliberate exception to "UPGit never stores a GitHub token": it's
--     encrypted at rest (AES-256-GCM, server-side key from
--     TOKEN_ENCRYPTION_KEY, never sent to the client) and only exists for
--     users who explicitly chose Simple Mode.
-- ============================================================
create table if not exists github_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles(id) on delete cascade,
  github_user_id bigint not null,
  auth_mode text not null default 'github_app' check (auth_mode in ('oauth', 'github_app')),
  installation_id bigint,
  access_token_encrypted text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Safe to re-run on a database that already has this table from before
-- auth_mode/access_token_encrypted existed.
alter table github_connections add column if not exists auth_mode text not null default 'github_app';
alter table github_connections add column if not exists access_token_encrypted text;
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'github_connections_auth_mode_check'
  ) then
    alter table github_connections add constraint github_connections_auth_mode_check
      check (auth_mode in ('oauth', 'github_app'));
  end if;
end $$;

-- ============================================================
-- sessions
-- Server-side session store backing the HttpOnly session cookie.
-- ============================================================
create table if not exists sessions (
  id text primary key, -- opaque nanoid, not a DB-generated uuid
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists idx_sessions_user_id on sessions(user_id);
create index if not exists idx_sessions_expires_at on sessions(expires_at);

-- ============================================================
-- oauth_states
-- CSRF state for the GitHub OAuth redirect round-trip. Was previously an
-- in-memory Map — moved here because a Map only survives on a single
-- long-running process. On serverless platforms (Netlify/Vercel Functions)
-- the request that starts the OAuth flow (/api/auth/github) and the
-- callback request (/api/auth/github/callback) can land on two different
-- cold-started instances with separate memory, which would make every
-- login fail with "invalid state". Rows are short-lived (created, then
-- deleted the moment they're consumed) and expired ones are opportunistically
-- swept — see oauthStateService.js.
-- ============================================================
create table if not exists oauth_states (
  state text primary key, -- opaque nanoid
  created_at timestamptz not null default now()
);
create index if not exists idx_oauth_states_created_at on oauth_states(created_at);

-- ============================================================
-- upload_jobs
-- id is app-generated (nanoid text), not a DB uuid default — the upload
-- routes need to reference the job id *before* the DB insert completes
-- (it's also the Supabase Storage prefix the staged file contents are
-- written under — see uploadStagingService.js), so the app generates it
-- up front rather than round-tripping to get one back.
--
-- PORTABILITY NOTE: staged file *contents* (the actual bytes between
-- "analyze" and "commit") live in Supabase Storage, not in this table and
-- not in process memory. This table is metadata only. That split is what
-- lets analyze-zip and the later /commit call land on two different
-- serverless instances (Netlify/Vercel) and still work — an in-memory Map
-- keyed by jobId would not survive across instances/cold starts.
-- ============================================================
create table if not exists upload_jobs (
  id text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  repository_owner text not null,
  repository_name text not null,
  branch text not null default 'main',
  target_path text not null default '',
  status text not null default 'pending'
    check (status in ('pending','processing','success','failed','cancelled')),
  file_count integer not null default 0,
  total_size bigint not null default 0,
  commit_sha text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_upload_jobs_user_id on upload_jobs(user_id);

-- ============================================================
-- user_settings
-- ============================================================
create table if not exists user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles(id) on delete cascade,
  theme text not null default 'dark',
  default_branch text not null default 'main',
  default_commit_message text not null default 'Update via UPGit',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- activity_logs
-- ============================================================
create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  action text not null,
  resource_type text,
  resource_id text,
  status text not null default 'success',
  created_at timestamptz not null default now()
);
create index if not exists idx_activity_logs_user_id on activity_logs(user_id);

-- ============================================================
-- Row Level Security
-- The backend talks to Supabase using the SERVICE ROLE key, which
-- bypasses RLS by design — these policies are the safety net for any
-- future client-side/anon-key access (e.g. a client-side read for a
-- user-scoped realtime subscription).
-- ============================================================
alter table profiles enable row level security;
alter table github_connections enable row level security;
alter table sessions enable row level security;
alter table upload_jobs enable row level security;
alter table user_settings enable row level security;
alter table activity_logs enable row level security;

drop policy if exists "profiles: read own" on profiles;
create policy "profiles: read own" on profiles
  for select using (auth.uid() = id);

drop policy if exists "github_connections: read own" on github_connections;
create policy "github_connections: read own" on github_connections
  for select using (auth.uid() = user_id);

drop policy if exists "upload_jobs: read own" on upload_jobs;
create policy "upload_jobs: read own" on upload_jobs
  for select using (auth.uid() = user_id);

drop policy if exists "user_settings: read own" on user_settings;
create policy "user_settings: read own" on user_settings
  for select using (auth.uid() = user_id);

drop policy if exists "activity_logs: read own" on activity_logs;
create policy "activity_logs: read own" on activity_logs
  for select using (auth.uid() = user_id);

-- No public insert/update/delete policies are defined: all writes go
-- through the backend's service-role client. Sessions and oauth_states
-- have no client policies at all — they must never be reachable with the
-- anon key.
--
-- CAVEAT: auth.uid() only resolves if you later adopt Supabase Auth.
-- This app uses custom GitHub-App sessions, so auth.uid() will be NULL
-- for these requests today and the "read own" policies above are inert
-- until/unless Supabase Auth is wired in. Real isolation right now comes
-- entirely from the backend always filtering by req.user.id server-side
-- with the service-role client. Treat these policies as a safety net for
-- a future client-side/anon-key access path, not as the current
-- enforcement mechanism.

-- ============================================================
-- Storage bucket for staged upload contents
-- Holds file bytes between /api/uploads/analyze-* and /api/uploads/:jobId/commit.
-- Kept PRIVATE (public = false) — every read/write goes through the
-- service-role client (server-side only), same trust model as the tables
-- above. Objects are written under `<jobId>/` and deleted once a job is
-- committed, cancelled, or expires. If your Supabase project restricts
-- `storage.buckets` writes via SQL, create it from the Dashboard instead
-- (Storage → New bucket → name "upload-staging" → Private) with the
-- equivalent settings.
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('upload-staging', 'upload-staging', false, 52428800)
on conflict (id) do nothing;
