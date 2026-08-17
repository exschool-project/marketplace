# UPGit — by XREZZKY DEV

GitHub management dashboard: connect your GitHub account via a GitHub App
and manage repositories, files, branches, issues, PRs, and more from one
web dashboard. Platform-agnostic by design — deployable to Netlify,
Vercel, Render, a plain VPS, or Docker; see **[`DEPLOYMENT.md`](./DEPLOYMENT.md)**
for all of them, including the current honest Platform Support Matrix.

## Status: All 7 phases attempted — read this before assuming "done" means "production-hardened"

"All 7 phases built" and "production-ready" are not the same claim. Every
phase below has real, working code behind it, but the honest gaps are
called out explicitly throughout this README (search for ⚠️) rather than
hidden. The two biggest ones: **I have not run this against a real
GitHub App + Supabase project** (no network access in the sandbox that
built this), and **Organizations/Notifications are intentionally scoped
down**, not fully built, because doing them properly conflicts with this
app's own "never store a user token" security decision. Read the Phase
5, 6, and 7 sections below before treating this as finished.

**Phase 1 — foundation:**

- ✅ Project setup (backend + static frontend)
- ✅ GitHub App user-authorization OAuth flow (login → callback → session)
- ✅ DB-backed session (Supabase `sessions` table, HttpOnly signed cookie)
- ✅ Supabase schema + RLS (with caveats, see `db/schema.sql`)
- ✅ Dashboard shell UI (dark, minimal, no framework)
- ✅ Repository list (read-only, via installation token)

**Phase 2 — repository detail, file explorer, editor, commit:**

- ✅ `GET /tree`, `GET /file`, `PUT /file`, `DELETE /file` endpoints
- ✅ `GET/POST /branches`, `DELETE /branches/:branch` (default branch delete blocked server-side)
- ✅ Repo detail view: collapsible nested file tree, branch selector
- ✅ File viewer/editor (plain `<textarea>`, monospace — no Monaco; see note below)
- ✅ File >1MB: backend returns `tooLarge` instead of content, editor shows a warning instead of silently loading/truncating
- ✅ Commit flow: edits are **never** pushed straight from the editor — clicking "Commit changes" opens a modal with a real line diff (custom LCS-based, `client/js/diff.js`), editable commit message, and a branch selector, and only then calls `PUT /file`
- ✅ 409 conflict handling: if the file's `sha` changed on GitHub since it was loaded (someone else edited it), the API returns a clear conflict message instead of overwriting silently
- ✅ Delete file: separate confirmation modal, requires the sha of the currently-loaded version
- ✅ New file creation (prompts for path, opens empty editor, same commit-review flow)

**Editor: CodeMirror 6** (replacing the Phase-2 plain textarea, per your
request). Still zero-bundler — every CM6 package is loaded straight from
esm.sh at runtime via `import` / dynamic `import()` in `client/js/editor.js`.
No React/Vite/webpack introduced; the rest of the app is untouched vanilla.

- Base editor pieces (state/view/commands/language/search) load eagerly —
  every file needs them.
- Language grammars (`lang-javascript`, `lang-python`, etc.) load lazily
  via dynamic `import()`, only for the extension actually opened, cached
  after first load. Supported out of the box: JS/JSX/TS/TSX, HTML, CSS,
  JSON, Markdown, Python, PHP, Java, SQL, YAML, XML, C/C++, Rust.
  Unrecognized extensions still get a fully working editor — just no
  syntax colors.
- Dark theme is hand-written (`EditorView.theme()` + a custom
  `HighlightStyle`) using the app's own CSS variables, not an imported
  theme package — stays in sync with the rest of the UI automatically.
- Features: line numbers, active-line + gutter highlight, auto
  indentation, bracket matching, search & replace (toolbar button or
  Ctrl/Cmd+F), undo/redo (toolbar buttons + Ctrl/Cmd+Z/Y), full default
  CM6 keymap. Line wrapping is on by default so mobile doesn't need
  horizontal scrolling.
- A fresh `EditorState` is created per file open (not reconfigured) —
  undo history intentionally does not carry over between different files.

**⚠️ Honest caveat on the CDN setup — please verify before relying on it:**
I pinned CodeMirror packages to esm.sh using major-version-only specifiers
(`@6`, `@1`) instead of exact patch versions, because this sandbox has no
network access and I can't verify live that a specific set of exact patch
versions all resolve to a shared `@codemirror/state` instance — getting
that wrong throws a hard runtime error. Floating majors is the safer
default for esm.sh's own dependency deduping, but it's still unverified
by me. **After you deploy, open the browser console once** while opening
a file in the editor:
- No errors → you're good.
- An error like "individual extensions must inherit from the same
  instance" → the dedupe didn't work; ping me with the exact console
  error and I'll switch to esm.sh's `?deps=` pinning or a different CDN.

Also recommended once it's confirmed working: check the Network tab for
the exact resolved esm.sh URLs and hardcode those exact versions in
`editor.js`, so a future upstream esm.sh release can't silently break you.

**Phase 3 — upload system + ZIP security:**

- ✅ `POST /uploads/analyze-zip`, `POST /uploads/analyze-files` (folder/multi-file), `POST /uploads/:jobId/commit`, `POST /uploads/:jobId/cancel`, `GET /uploads/:jobId`, `GET /uploads`
- ✅ ZIP inspection happens **before** anything is extracted: path traversal (zip slip), excessive file count, excessive total extracted size, and a compression-ratio check for zip-bomb-style files. Any violation rejects the *entire* upload, not just the offending entry.
- ✅ Symlink entries are rejected — see the honest caveat in `zipInspector.js` about this specific check (couldn't test against a real symlink ZIP in this sandbox).
- ✅ Individually-uploaded files/folders get the same path-safety check as ZIP entries.
- ✅ Secret file detection (`.env*`, `*.pem`, `*.key`, `id_rsa`, credentials/service-account JSON, etc.) — flagged and excluded by default in the UI, user can consciously re-include.
- ✅ Smart project detection (`package.json`, `vite.config.*`, `requirements.txt`, `composer.json`, `Dockerfile`, etc.) — informational banner only, **nothing is ever installed or executed**.
- ✅ `.gitignore` helper — offered when missing, 9 templates, previewed as just another file in the upload list before commit.
- ✅ Bulk commit uses the **Git Data API** (blob → tree → commit → ref update) instead of one Contents-API call per file — one commit for the whole upload instead of N rate-limit-hungry commits.
- ✅ Upload UI: drag & drop, folder picker (`webkitdirectory`), ZIP picker, file list with per-file exclude checkboxes, live count/size, commit message, result with a link to the commit and the repo.
- ✅ File contents are staged in Supabase Storage between "analyze" and
  "commit" (not server memory, not disk) — see the portability note in
  `db/schema.sql` — auto-pruned after 30 minutes if abandoned.

**Phase 4 — branches UI, commit history, issues, pull requests:**

- ✅ Repo detail is now tabbed: Files | Branches | Commits | Issues | Pull Requests
- ✅ **Branches tab**: list with protected badge, create-from-branch form, delete (server still blocks deleting the default branch — same protection as Phase 2, just exposed in this UI now)
- ✅ **Commits tab**: paginated commit list per branch, click a commit to see full file-by-file diff (reuses the same unified-diff rendering style as the editor's commit preview)
- ✅ **Issues tab**: open/closed filter, create issue (title + body), issue detail with full comment thread, close/reopen, post comment
- ✅ **Pull Requests tab**: open/closed/merged filter, create PR (base/compare/title/body), PR detail showing files changed + commits + conversation, close/reopen, post comment
- ✅ **Merge**: dedicated endpoint (`PUT /pulls/:number/merge`), never folded into the generic update endpoint, and the frontend always shows a confirmation modal first — no one-click merge anywhere
- ✅ Every destructive/state-changing action here (branch delete, issue close, PR close, merge) goes through the same "review before it happens" pattern as file commits

**Known gaps in Phase 4 (being upfront, not hiding them):**
- No line-level PR review comments (inline code review) — only whole-PR conversation comments. GitHub's review API is a separate, heavier surface; flagged here rather than half-implemented.
- No CI/check-run status shown on PRs (no Actions permission wired up yet — that's Phase 5).
- No labels/assignee/milestone picker UI for issues — the backend accepts a comma-separated labels string and a single assignee username if you want to test it via the API directly, but there's no dropdown yet.
- Branch list doesn't show "last commit" per branch (would mean one extra GitHub API call per branch — skipped for now to avoid burning rate limit on a list view; the commits tab covers this per-branch).

**Phase 5 — Actions, Releases, Organizations, Notifications:**

- ✅ **Actions tab** (per repo): list workflows, list recent runs with status, re-run a completed run, cancel a queued/in-progress run. Logs are viewed via a "View on GitHub ↗" link rather than fetched inline — see the honest note in `repoTabs.js` about why (GitHub's log-download endpoint returns a redirect to a signed zip URL, not plain text, and I couldn't verify that round-trip through every octokit version without live testing).
- ✅ **Releases tab** (per repo): list, create (tag/title/body/pre-release), delete with confirm. Tags are listed read-only via the same backend (`GET /tags`); creating a tag happens by creating a release, since that's what most people actually want.
- ⚠️ **Organizations — scoped down, on purpose.** A correct "orgs you belong to" list needs `GET /user/orgs`, which requires a *user* access token. So does GitHub's Notifications API. UPGit's whole security model (documented back in Phase 1) is built around **never persisting a user token** — only using it transiently at login to read the profile, then discarding it. Supporting either feature properly means storing a refreshable OAuth token, which is a real architecture decision, not a small addition. Rather than fake it or silently skip it, the **Organizations** page now shows something that *is* correctly derived from the installation token: your accessible repositories grouped by owner (org vs personal account) — genuinely accurate, just not the same thing as "every org you're a member of." The distinction is stated plainly in the UI.
- ⚠️ **Notifications** — same blocker. The bell icon in the topbar is real UI, not a dead button, but clicking it shows the actual limitation instead of fake notifications.
- 🐛 **Bug fix while I was in here:** the Phase 3 Upload view and the modals were accidentally placed outside `<main class="shell">` in the HTML, meaning Upload could have rendered edge-to-edge without the app's normal centered container. Fixed — everything now lives inside `<main>` where it belongs.

If you want Organizations/Notifications done properly later, the path is: store the user's OAuth token (encrypted) and refresh token from the GitHub App user-to-server flow, add a refresh job (GitHub App user tokens expire in ~8h by default), and add the two endpoints against that token instead of the installation token. That's a deliberate scope decision to make with you, not something to sneak in.

**Phase 6 — upload history, settings, PWA, hardening:**

- ✅ **Activity page**: two real panels — upload history (`upload_jobs` table, was already tracked since Phase 3, just never had a page) and a general activity feed (`activity_logs`, which every route since Phase 1 has been writing to on logins, commits, uploads, issue/PR actions, releases, workflow runs). Not a mock timeline — it's reading rows that other parts of the app have genuinely been inserting all along.
- ✅ **Settings page**: default branch name and default commit message, persisted per-user (`user_settings` table), and actually wired into the Upload form's default commit message — not just stored and ignored.
- ⚠️ **Theme setting deliberately left out.** Only one theme (dark neobrutalist) exists. A theme toggle that doesn't switch anything would be a fake control, so `PUT /settings` doesn't even accept a `theme` field yet — see the comment in `settings.js`.
- ✅ **PWA**: `manifest.json`, a service worker that caches the static app shell only (`client/sw.js` — explicitly never caches anything under `/api/`, per the "don't cache tokens/private data" rule from the spec), an install-prompt button that only appears when the browser actually fires `beforeinstallprompt`.
- ⚠️ **Icons are SVG, not PNG.** I generated `client/icons/icon.svg` and `icon-maskable.svg` by hand (simple shapes + text, matching the brand palette) since I have no image-generation tool in this sandbox to rasterize a proper PNG icon set. SVG works for the manifest in most modern browsers, but iOS home-screen icons specifically want a PNG `apple-touch-icon` — if that matters to you, export a 180×180 PNG from the SVG (or a proper logo) and add `<link rel="apple-touch-icon" href="...">` to `index.html`.
- ✅ **Rate-limit hardening**: `@octokit/plugin-throttling` + `@octokit/plugin-retry` wired into every installation-authenticated Octokit instance in `githubService.js` — this is the real exponential-backoff/retry logic the spec asked for, using GitHub's own officially maintained plugins rather than hand-rolled retry code scattered across routes.
- ✅ **A short-lived in-memory cache** (20s TTL) on the repo list call — cuts redundant GitHub API calls when you click around the dashboard/branch pickers without ever showing data more than 20s stale.
- ✅ **Stricter rate limit on `/api/auth/*`** (30 req/15min vs 300 for everything else) — the one surface an unauthenticated attacker can hit at all.
- ✅ **CSRF reasoning documented** rather than a token bolted on: cookies are `SameSite=Lax` + `HttpOnly` + `Secure` (prod), and CORS is locked to `FRONTEND_URL` with credentials — since all mutating requests send `Content-Type: application/json`, browsers require a CORS preflight before sending them, and the preflight gets rejected for any origin that isn't `FRONTEND_URL`. That combination already blocks the standard cross-site form/fetch CSRF pattern for this API shape. Worth revisiting if the API ever accepts `multipart/form-data` or simple-request-shaped mutations from a third-party origin.
- 🐛 **Bug fix while I was in here:** the Upload view and every modal were accidentally sitting outside `<main class="shell">` in the HTML (introduced back in Phase 3), which could have made Upload render edge-to-edge instead of in the centered container every other view gets. Fixed.

**Phase 7 — testing, deployment, documentation:**

- ✅ **Real, executed tests** for every pure function with no external dependency — `server/test/uploadSecurity.test.js` (13 tests, path-traversal/secret-detection/project-detection logic) and `client/test/diff.test.js` (7 tests, the LCS diff engine behind every commit preview). I ran both with `node --test` in this sandbox and they pass — you can see the exact pass/fail counts in this conversation, not just a claim that they pass.
- ⚠️ **`server/test/zipInspector.test.js` was written but never executed** — it needs `adm-zip`, which isn't installed in this sandbox (no network for `npm install`). The test logic covers zip-slip rejection, file-count/size limits, and a zip-bomb-shaped compression-ratio check, but you need to run `npm install && npm test` yourself to confirm it actually passes. This is the single most important thing to verify before trusting the upload feature in production.
- ✅ **CI workflow** (`.github/workflows/test.yml`) runs both test suites fresh on every push/PR to `main`.
- ✅ **`DEPLOYMENT.md`** — a from-scratch, host-agnostic deployment guide (Supabase setup, GitHub App setup, backend hosting incl. a `Dockerfile`, static frontend hosting, DNS/routing, a post-deploy smoke-test checklist, and known limitations at scale). I did not and could not deploy this myself — see the honesty note at the top of that file.
- ⚠️ **No live end-to-end run.** Nothing in this codebase has been exercised against a real GitHub account, a real Supabase project, or a real browser. Every manual QA checklist in this README exists specifically because that gap is real and needs a human (you) to close it — not because it's a formality.

**What's still genuinely absent from the original spec**, stated plainly rather than buried: line-level PR review comments, CI check-run status on PRs, labels/assignee/milestone picker UI for issues, admin monitoring dashboard, global cross-entity search, and (as covered above) fully correct Organizations/Notifications. None of these have fake UI standing in for them.

## Visual style: Neobrutalism (dark)

The UI uses a dark neobrutalist palette — flat colors, thick solid black
borders (2–4px), hard offset shadows (no blur/glow), zero border-radius.
This was a pure CSS change (`client/css/style.css` only) — no HTML/JS
structure or features were touched.

- Background: `#0B1220` (near-black navy), panels a shade lighter
- Primary: `#1565FF` (blue) — primary buttons, active/important actions
- Accent: `#00C2FF` (cyan) — links, focus rings, active nav underline
- Text: `#F5F7FA`, borders: `#000000`
- Blue/cyan are used sparingly — badges, buttons, links, active states —
  not as a wash across every element
- The CodeMirror editor theme (`client/js/editor.js`) reads the same CSS
  variables (`var(--bg)`, `var(--accent)`, etc.), so it picked up this
  palette automatically without any JS changes

## Architecture

```
upgit/
├── package.json               root — mainly so api/index.js (Vercel) resolves as ESM
├── vercel.json                 Vercel: static client/ + api/index.js function
├── netlify.toml                 Netlify: static client/ + Functions adapter
├── render.yaml                  Render Blueprint: web service + static site
├── Dockerfile                backend container image (portable — no platform lock-in)
├── .dockerignore
├── DEPLOYMENT.md              step-by-step deploy guide for all 5 targets + Platform Support Matrix
├── .github/workflows/test.yml   CI: runs both test suites on push/PR
├── api/index.js                Vercel Functions entrypoint (wraps server/src/app.js)
├── server/                  Node.js + Express API
│   ├── src/
│   │   ├── app.js           the actual Express app — shared by every deploy target
│   │   ├── index.js         entrypoint for VPS/Docker/Render/local (calls app.listen)
│   │   ├── config/env.js    env loading + validation
│   │   ├── db/supabase.js   service-role Supabase client
│   │   ├── middleware/      session attach + requireAuth
│   │   ├── routes/          auth.js, repos.js, files.js, branches.js,
│   │   │                     commits.js, issues.js, pulls.js, actions.js,
│   │   │                     releases.js, uploads.js, settings.js, activity.js
│   │   └── services/        githubService.js (incl. bulkCommitService,
│   │                        throttling/retry plugins), sessionService.js,
│   │                        oauthStateService.js (Supabase-backed OAuth state),
│   │                        uploadStagingService.js (Supabase Storage-backed upload staging),
│   │                        connectionService.js, uploadSecurity.js, zipInspector.js
│   ├── adapters/netlify/    Netlify Functions wrapper (serverless-http) — no business logic
│   ├── test/                uploadSecurity.test.js (✅ run, passing),
│   │                        zipInspector.test.js (⚠️ written, not run — see file)
│   └── db/schema.sql        Supabase schema + RLS + oauth_states + upload-staging bucket
└── client/                  Static frontend (vanilla HTML/CSS/JS), deployable anywhere
    ├── index.html           importmap-free (esm.sh full-URL imports instead)
    ├── manifest.json, sw.js, icons/   PWA shell
    ├── css/style.css
    ├── test/diff.test.js     ✅ run, passing
    └── js/
        ├── config.js        resolves API_BASE — same-origin '/api' by default,
        │                     overridable via window.__UPGIT_API_BASE__ for split deploys
        ├── app.js           router, dashboard, auth state, PWA install prompt
        ├── repo.js           repo detail: tree, editor, commit/delete modals
        ├── repoTabs.js       repo detail tabs: branches, commits, issues, PRs, actions, releases
        ├── org.js            organizations view (installation-scoped, see Phase 5 notes)
        ├── activity.js       activity feed + upload history
        ├── settings.js       user settings (default branch/commit message)
        ├── diff.js           minimal LCS line-diff for the commit preview
        ├── editor.js         CodeMirror 6 wrapper: theme, lazy language loading
        └── upload.js         upload view: dropzone, preview, secret/gitignore banners
```

No frontend framework was added for Phase 1 since the shell is simple;
if the app grows into Phase 2+ (file tree, Monaco editor, diff views),
it's worth reconsidering — happy to migrate to React/Vite then if you want.

## How GitHub auth actually works here

1. `/api/auth/github` redirects to GitHub's OAuth authorize screen.
2. GitHub redirects back to `/api/auth/github/callback` with a `code`.
3. That code is exchanged **once** for a user access token — used only to
   read `login`, `id`, `avatar_url` via `GET /user`, then discarded.
4. Separately, we look up (or receive via `installation_id` query param)
   the GitHub **App installation** tied to that GitHub account.
5. We store `installation_id` in `github_connections` — **never a token**.
6. For every actual API call (repos, files, issues...), the backend mints
   a fresh, short-lived **installation access token** on demand via
   `@octokit/auth-app`, cached in memory per-process as a performance
   optimization until it expires (~1h). If the process restarts (or, on
   serverless, a different instance handles the next request), it just
   mints a new one — this cache is never the only copy of anything, so
   losing it costs one extra API call, nothing more.
7. The user gets a session cookie (HttpOnly, Secure in prod, SameSite=Lax,
   signed) that maps to a row in the `sessions` table — not a JWT, so it
   can be revoked server-side instantly (logout deletes the row).

This means: no long-lived GitHub token ever touches the database or the
browser. If you rotate `GITHUB_APP_PRIVATE_KEY`, all installation tokens
mint fine on the new key immediately — nothing to migrate. The OAuth
`state` CSRF check between steps 1 and 2 is stored in Supabase
(`oauth_states` table), not in memory, so it works correctly even if
those two requests land on different serverless instances.

## Setup

### 1. Create the GitHub App

GitHub → Settings → Developer settings → GitHub Apps → New GitHub App.

- Homepage URL: your deployed frontend URL
- Callback URL: `<your-app-url>/api/auth/github/callback`
- Request user authorization (OAuth) during installation: **on**
- Webhook: optional for Phase 1, required later for real-time issue/PR
  updates — set `GITHUB_WEBHOOK_SECRET` when you enable it.
- Permissions (start minimal, per the least-privilege rule):
  - Repository → Contents: Read & write
  - Repository → Metadata: Read-only
  - Add Issues / Pull requests / Actions / Administration / Secrets only
    when you actually build those features — not upfront.

Generate a private key (.pem) — this becomes `GITHUB_APP_PRIVATE_KEY`.

### 2. Supabase

- Create a project.
- Run `server/db/schema.sql` in the SQL editor (creates every table,
  RLS, and the `upload-staging` Storage bucket).
- Copy `Project URL`, `anon` key, and `service_role` key into `.env`.

### 3. Environment

```bash
cd server
cp .env.example .env
# fill in GITHUB_*, SUPABASE_*, SESSION_SECRET (openssl rand -hex 32)
npm install
npm run dev
```

Serve `client/` as a static site (any static host, or `npx serve client`
locally). Set `FRONTEND_URL` in `.env` to wherever the client is served
from, so CORS + redirect-after-login work. If frontend and backend end
up on different origins, also set `window.__UPGIT_API_BASE__` before
`client/js/app.js` loads — see `client/js/config.js` and
**[`DEPLOYMENT.md`](./DEPLOYMENT.md)** for the full walkthrough across
all 5 supported platforms.

### 4. Local dev callback

Use `http://localhost:3000/api/auth/github/callback` as a second callback
URL entry if GitHub App settings allow multiple, or swap
`GITHUB_CALLBACK_URL` in `.env` between dev and prod.

## Security notes (what's actually enforced right now)

- Helmet + CORS locked to `FRONTEND_URL` + credentials.
- Rate limiting on all `/api/*` routes (own-server abuse, separate from
  GitHub's own rate limits).
- Session cookie: HttpOnly, Secure (prod), SameSite=Lax, signed with
  `SESSION_SECRET`.
- No GitHub token ever written to Supabase, logs, or the frontend.
- `SUPABASE_SERVICE_ROLE_KEY` only used server-side; every query is
  manually scoped by `req.user.id`.
- RLS is enabled on all tables, but since auth is custom (not Supabase
  Auth), `auth.uid()`-based policies are currently inert — real isolation
  comes from the backend's own scoping. Documented as a caveat directly
  in `schema.sql`; worth fixing properly (e.g. custom JWT + Supabase Auth
  bridge) before this handles anything sensitive at scale.
- Default branch deletion is blocked in `branchService.delete`.
- Still **missing** for a real production bar: CSRF token on state-changing
  requests beyond the OAuth `state` param, webhook signature verification,
  structured server-side logging/alerting, and the ZIP-slip/ZIP-bomb
  protections (those land in Phase 3 with the upload system).

## Manual QA checklist (run this yourself after deploying)

I can't execute a real browser + live GitHub/Supabase from this sandbox
(no network access, no real App credentials), so I can't claim these are
"tested" — here's exactly what to click through once it's deployed:

1. **Open a file from GitHub** — sign in, open a repo, click a file in
   the tree. Confirm content loads and matches what's on GitHub.
2. **Edit a file** — type in the editor, confirm cursor/selection/typing
   feel normal, try Ctrl+Z/Ctrl+Y (undo/redo) and the toolbar buttons.
3. **Syntax highlighting** — open a `.js`, `.py`, `.md`, and one
   unsupported extension (e.g. `.txt`). Confirm the first three show
   colored syntax and the last still edits fine with no highlighting.
   Open DevTools → Network and confirm only the language package for the
   file you opened was fetched, not all of them.
4. **Save/commit to GitHub** — edit a file, click "Commit changes",
   confirm the diff preview matches your edit, confirm on GitHub.com that
   the commit actually landed on the branch you picked. Then try editing
   the same file from GitHub.com directly and saving in UPGit without
   reloading — you should get the 409 "changed since you opened it" error
   instead of a silent overwrite.
5. **Mobile** — open on an actual phone (not just a resized desktop
   window): confirm the tree/editor stack vertically, toolbar buttons are
   tappable, the on-screen keyboard doesn't break layout, and search
   (⌕ button) opens a usable panel.
6. **Doesn't interfere with other features** — confirm the dashboard repo
   list, login/logout, and branch switching still work normally with the
   new editor mounted; switch branches while a file is open and confirm
   the editor cleans up (no duplicate editors stacking up, no console
   errors) rather than just checking it "looks" fine.

**Phase 3 (upload) — additional checklist, security-focused:**

7. **Normal upload** — drag a small folder or a clean ZIP in, confirm the
   preview shows correct file count/size, commit, confirm on GitHub.com.
8. **Secret files** — include a `.env` in your test folder/ZIP, confirm
   it's flagged and excluded by default, confirm it's genuinely absent
   from the resulting commit unless you explicitly re-check it.
9. **ZIP slip** — craft a test ZIP with an entry named e.g.
   `../../etc/passwd` or `..\\..\\evil.txt` (several free tools/scripts
   can build one; this needs a deliberately malicious test file, which I
   can't generate for you here). Confirm the whole upload is rejected
   with a clear error, not partially processed.
10. **Zip bomb** — try a small ZIP that decompresses far beyond its
    compressed size (e.g. a multi-GB file of repeated zeros compressed
    down to a few KB). Confirm it's rejected before extraction, not after
    your server runs out of memory.
11. **Symlink ZIP** — if you can craft one (`zip --symlinks`), confirm it's
    rejected. This is the check I explicitly flagged as unverified in
    `zipInspector.js` — please test it for real before trusting it.
12. **Oversized upload** — exceed `UPLOAD_MAX_SIZE` / `MAX_FILES` /
    `MAX_EXTRACTED_SIZE` and confirm you get a clear error, not a crash.

If any of these fail, the most likely culprit is the CDN version-pinning
caveat above — check that first.

## Environment variables

See `server/.env.example` — no real credentials are filled in.
