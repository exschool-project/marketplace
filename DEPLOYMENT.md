# Deploying UPGit

**Honest framing first:** none of the platform configs below have been
run against a real deployment — no network access in the sandbox that
built them. They follow each platform's documented, standard conventions
and the code has been audited for platform-specific assumptions (see the
Platform Support Matrix at the bottom), but "should work" and "verified
working" are different claims. Treat first deploy on any platform as a
real test, and run the smoke test in each section afterward.

## Overview

UPGit's core is platform-agnostic on purpose:

- **`client/`** — static files (HTML/CSS/JS), no build step, no
  Netlify/Vercel-specific code. Deployable to any static host.
- **`server/`** — a standard Node.js/Express app (`server/src/app.js`).
  `npm install && npm start` runs it anywhere Node ≥20 runs — no
  platform SDK required for that path.
- **Supabase** — the only persistence layer. Sessions, OAuth CSRF state,
  and staged upload file contents all live there (not in process memory),
  which is what makes the backend safe to run as a single process *or*
  as short-lived serverless invocations.
- Netlify and Vercel don't run a long-lived Node process, so each gets a
  thin **adapter** (`server/adapters/netlify/`, `api/index.js` for
  Vercel) that wraps the same `app.js` for their function runtime. The
  adapters contain no business logic — every route, security check, and
  GitHub call is shared code.

```
upgit/
├── server/src/app.js          the actual Express app (shared everywhere)
├── server/src/index.js        entrypoint for VPS/Docker/Render/local (calls app.listen)
├── server/adapters/netlify/   Netlify Functions wrapper (serverless-http)
├── api/index.js               Vercel Functions wrapper
├── netlify.toml, vercel.json, render.yaml, Dockerfile   per-platform config
└── client/                    static frontend, deployable anywhere
```

Jump to: [1. Local Development](#1-local-development) ·
[2. Netlify](#2-netlify-deployment) · [3. Vercel](#3-vercel-deployment) ·
[4. Render](#4-render-deployment) · [5. VPS](#5-vps-deployment) ·
[6. Environment Variables](#6-environment-variables) ·
[7. GitHub App Configuration](#7-github-app-configuration) ·
[8. Supabase Configuration](#8-supabase-configuration) ·
[9. Custom Domain](#9-custom-domain)

---

## 1. Local Development

```bash
cd server
cp .env.example .env
# fill in GITHUB_*, SUPABASE_*, SESSION_SECRET (openssl rand -hex 32)
# leave APP_URL / FRONTEND_URL at their http://localhost:3000 defaults
npm install
npm run dev
```

Serve the frontend separately, e.g. `npx serve client` (or any static
server) — then either:
- point it at `http://localhost:3000/api` by adding
  `<script>window.__UPGIT_API_BASE__ = 'http://localhost:3000/api';</script>`
  before `js/app.js` loads in `client/index.html`, **or**
- put a dev reverse-proxy in front of both so they share an origin.

Use `http://localhost:3000/api/auth/github/callback` as a second
Callback URL on the GitHub App (most App settings allow more than one),
or swap `GITHUB_CALLBACK_URL` between dev and prod.

---

## 2. Netlify Deployment

Config already in the repo: `netlify.toml` (publish `client/`, one
Function at `server/adapters/netlify/functions/api.js`).

1. Netlify → **Add new site → Import an existing project**, pick this repo.
2. Build settings are read from `netlify.toml` — no manual override needed.
3. Set every variable from [§6](#6-environment-variables) under
   **Site configuration → Environment variables**.
4. Deploy. Netlify installs `server/`'s dependencies (via the `command`
   in `netlify.toml`) and bundles the Function with esbuild.
5. `/api/*` requests are redirected to the Function
   (`/.netlify/functions/api/...`); everything else is served as a
   static file from `client/`.
6. Set `APP_URL` and `FRONTEND_URL` to the Netlify site URL (or your
   [custom domain](#9-custom-domain)) and `GITHUB_CALLBACK_URL` to
   `<that-url>/api/auth/github/callback`.

**Needs verification:** Netlify Functions run on a Lambda-style runtime;
`serverless-http` (added to `server/package.json`) bridges Express to
that contract. This combination is a well-established pattern but has
not been deployed and exercised here — watch cold-start latency and
function bundle size on first deploy.

---

## 3. Vercel Deployment

Config already in the repo: `vercel.json` (static build for `client/**`,
one Node Function at `api/index.js`), plus a root `package.json` (so
`api/index.js` resolves as an ES module — real dependencies stay in
`server/package.json`).

1. Vercel → **Add New → Project**, import this repo.
2. Framework preset: **Other** (this isn't Next.js/etc — `vercel.json`
   drives the build directly).
3. Set every variable from [§6](#6-environment-variables) under
   **Settings → Environment Variables**.
4. Deploy. `vercel.json`'s `installCommand` installs `server/`'s
   dependencies; `api/index.js` imports `server/src/app.js` directly, so
   Vercel's bundler resolves `express` etc. from `server/node_modules`
   via normal Node module resolution — no dependency duplication.
5. `/api/*` rewrites to the one Function; everything else rewrites to
   the static `client/` build.
6. Set `APP_URL`/`FRONTEND_URL` to the Vercel deployment URL (or your
   [custom domain](#9-custom-domain)) and `GITHUB_CALLBACK_URL` to match.

**Needs verification:** not deployed here. If Vercel's bundler can't
resolve `server/node_modules` from `api/index.js` in practice, the
fallback is to add the same dependency list to the root `package.json`
directly (duplicating `server/package.json`'s `dependencies`) so Vercel's
default installer picks them up without the `builds`/`includeFiles`
indirection.

---

## 4. Render Deployment

Config already in the repo: `render.yaml` — a Blueprint with two
services: `upgit-server` (Node Web Service, standard `npm start`, this
is the platform closest to "just run the app") and `upgit-client`
(Static Site).

1. Render → **New → Blueprint**, point it at this repo. Render reads
   `render.yaml` and proposes both services.
2. Fill in every `sync: false` env var from [§6](#6-environment-variables)
   on `upgit-server` — Render leaves these blank for you to enter secrets.
3. Deploy both services. Render assigns each its own `*.onrender.com` URL.
4. Since the two services live on different origins here, tell the
   client where the backend is: edit `client/index.html` before/after
   deploy to add
   `<script>window.__UPGIT_API_BASE__ = 'https://upgit-server.onrender.com/api';</script>`
   above the `js/app.js` `<script>` tag (or wire it into your own build
   step if you fork this further).
5. Set `FRONTEND_URL` on `upgit-server` to the client service's URL
   (needed for CORS + post-login redirect), and `APP_URL` to the
   server's own URL. `GITHUB_CALLBACK_URL` → `<server-url>/api/auth/github/callback`.
6. Render's health check is wired to `GET /api/health` already via
   `render.yaml`.

This is the most "standard Node app" of the four platform configs —
no adapter, no bundler translation, just `npm install && npm start`.

---

## 5. VPS Deployment

No platform config needed — this is the reference deployment `app.js`
was written for.

```bash
cd server
npm install --omit=dev
cp .env.example .env   # fill in real values, NODE_ENV=production
npm start
```

Run it under a process manager (pm2, systemd, etc.) so it restarts on
crash/reboot. Example systemd unit:

```ini
[Unit]
Description=UPGit server
After=network.target

[Service]
WorkingDirectory=/opt/upgit/server
ExecStart=/usr/bin/node src/index.js
EnvironmentFile=/opt/upgit/server/.env
Restart=on-failure
User=upgit

[Install]
WantedBy=multi-user.target
```

Reverse proxy example (Nginx) — serves `client/` directly and proxies
`/api/*` to the Node process, so frontend and backend share one origin:

```nginx
server {
  listen 443 ssl;
  server_name your-domain.example;

  root /opt/upgit/client;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location / {
    try_files $uri $uri/ =404;
  }
}
```

Same-origin here means `client/js/config.js`'s default `/api` works
with zero configuration — no `window.__UPGIT_API_BASE__` override needed.

### Docker (works on a VPS or any container platform)

```bash
docker build -t upgit-server -f Dockerfile .
docker run -p 3000:3000 --env-file server/.env upgit-server
```

The `Dockerfile` only ever installs and runs `server/` — it has no
platform-specific base image or command, so it also works unmodified as
the container backing a Render/Fly.io/ECS/Cloud Run "deploy from
Dockerfile" option, if you'd rather containerize than use a platform's
native Node buildpack.

---

## 6. Environment Variables

Full reference: `server/.env.example`. Every credential is an env var —
none are hardcoded in source. Required in production (the app refuses to
boot without these — see `server/src/config/env.js`):

| Variable | Notes |
|---|---|
| `GITHUB_APP_ID`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | from the GitHub App settings page |
| `GITHUB_APP_PRIVATE_KEY` | paste the `.pem`; `\n`-escaped single-line values are auto-unescaped |
| `GITHUB_CALLBACK_URL` | must match the App's configured callback URL exactly |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | from Supabase → Settings → API |
| `SESSION_SECRET` | `openssl rand -hex 32` |

Also used, with sane defaults: `GITHUB_APP_SLUG`, `GITHUB_WEBHOOK_SECRET`,
`SUPABASE_ANON_KEY`, `SESSION_COOKIE_NAME`, `SESSION_TTL_HOURS`,
`UPLOAD_MAX_SIZE`, `MAX_FILES`, `MAX_EXTRACTED_SIZE`, `NODE_ENV`, `PORT`.

`APP_URL` and `FRONTEND_URL` are **not hardcoded anywhere in source** —
set them per environment:
- Local: `http://localhost:3000`
- Same-origin deploy (VPS/Docker/Render-single-service): your one domain
- Split deploy (separate frontend/backend origins): `FRONTEND_URL` is the
  frontend's origin (used for CORS + post-login redirect); the frontend
  additionally needs `window.__UPGIT_API_BASE__` pointed at the backend
  (see `client/js/config.js` and the Render section above for the pattern).

---

## 7. GitHub App Configuration

1. GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**.
2. Homepage URL: your deployed frontend URL.
3. Callback URL: `<your-app-url>/api/auth/github/callback` — must equal
   `GITHUB_CALLBACK_URL` exactly, protocol included.
4. "Request user authorization (OAuth) during installation": **on**.
5. Permissions — start minimal, add more only as you use them:
   - Repository → Contents: Read & write
   - Repository → Metadata: Read-only
   - Repository → Issues / Pull requests: Read & write
   - Repository → Actions: Read & write (or Read-only for view-only)
6. Generate a private key (`.pem`) → this becomes `GITHUB_APP_PRIVATE_KEY`.
7. Note the App ID and Client ID/Secret from the settings page.
8. Webhook is optional unless you wire up real-time issue/PR updates —
   set `GITHUB_WEBHOOK_SECRET` when you do.

If you deploy to more than one platform/domain (e.g. staging + prod, or
testing Netlify alongside your live Render deploy), either register
multiple callback URLs on the same App (if GitHub allows it for your
App) or create a separate GitHub App per environment.

---

## 8. Supabase Configuration

1. Create a project at supabase.com.
2. SQL Editor → paste and run `server/db/schema.sql` in full. This
   creates every table (`profiles`, `github_connections`, `sessions`,
   `oauth_states`, `upload_jobs`, `user_settings`, `activity_logs`), RLS
   policies, and the private `upload-staging` Storage bucket used to
   stage upload file contents between analyze and commit.
3. If your project restricts creating Storage buckets via SQL, create it
   manually instead: **Storage → New bucket** → name `upload-staging` →
   **Private**.
4. Settings → API → copy `Project URL`, `anon public` key, and
   `service_role` key into your env vars. **Never** expose the service
   role key to the frontend or commit it to source control.

---

## 9. Custom Domain

Works the same way on every platform above — point your domain at
whichever service serves the frontend, and either:
- proxy `/api/*` on that same domain to the backend (Netlify/Vercel do
  this automatically via their config in this repo; VPS/Nginx does it
  via the `location /api/` block above), keeping everything same-origin
  so `window.__UPGIT_API_BASE__` never needs to be set, **or**
- run frontend and backend on separate subdomains (e.g.
  `app.example.com` + `api.example.com`) and set
  `window.__UPGIT_API_BASE__` on the frontend + `FRONTEND_URL` on the
  backend accordingly (this is required for the two-service Render setup
  above).

Either way, update `GITHUB_CALLBACK_URL` (and the GitHub App's Callback
URL setting) to match your final domain before going live — a mismatch
here is the most common source of "sign-in redirects but then fails."

---

## Smoke test after any deploy

1. `curl https://<your-domain>/api/health` → `{"ok":true}`
2. Open the site, click "Sign in with GitHub" → redirects to GitHub's
   OAuth screen, not an error.
3. After authorizing, you land back on the dashboard.
4. Upload a small folder or ZIP, confirm the analyze step works, then
   commit it and confirm the commit lands on GitHub. This exercises the
   Supabase Storage staging path end-to-end — the part most likely to
   behave differently across platforms if something's misconfigured.
5. Run through the full manual QA checklist in `README.md`.

## Platform Support Matrix

| Platform | Status |
|---|---|
| VPS / Docker | Needs verification — architecturally the reference target (plain `npm start`, no adapter), but not actually run in this sandbox (no network access) |
| Render | Needs verification — standard Node Web Service + Static Site, `render.yaml` provided, not deployed |
| Netlify | Needs verification — requires the `serverless-http` Functions adapter (added), not deployed |
| Vercel | Needs verification — requires the `api/index.js` Functions adapter (added), not deployed |

None of these are claimed "verified" — that would require an actual
deploy against a real GitHub App + Supabase project, which this
environment can't do. Please run the smoke test above on whichever
platform you pick and report back anything that breaks.

## Known limitations at this stage

- **`tokenCache` and `repoListCache`** in `githubService.js` are
  intentionally still in-process memory (not Supabase) — they're
  performance caches, not correctness-critical state. On serverless
  platforms each cold instance just starts with an empty cache; nothing
  breaks, GitHub API calls are just not deduped across instances. See
  the comment above `tokenCache` in that file if you want to move these
  to Supabase/Redis for cross-instance cache sharing later.
- **CI runs on push/PR** (`.github/workflows/test.yml`), installing deps
  fresh and running `npm test` for both `server/` and `client/`.
- Nothing in this codebase has been exercised against a real GitHub
  account, a real Supabase project, a real deploy, or a real browser —
  see the manual QA checklist in `README.md` for what to click through
  yourself after deploying.
