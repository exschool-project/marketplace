import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { attachUser } from './middleware/requireAuth.js';
import authRoutes from './routes/auth.js';
import repoRoutes from './routes/repos.js';
import fileRoutes from './routes/files.js';
import branchRoutes from './routes/branches.js';
import uploadRoutes from './routes/uploads.js';
import commitRoutes from './routes/commits.js';
import issueRoutes from './routes/issues.js';
import pullRoutes from './routes/pulls.js';
import actionRoutes from './routes/actions.js';
import releaseRoutes from './routes/releases.js';
import settingsRoutes from './routes/settings.js';
import activityRoutes from './routes/activity.js';
import vercelRoutes from './routes/vercel.js';
import statsRoutes from './routes/stats.js';

// This module builds and exports the Express app WITHOUT calling
// `.listen()`. That split is what makes UPGit's backend deployable both
// ways:
//   - as a normal long-running process (VPS, Docker, Render, local dev)
//     via server/src/index.js, which imports this app and calls listen()
//   - as a serverless function (Netlify Functions, Vercel Functions),
//     where the platform itself owns the request/response lifecycle and
//     an explicit listen() would be wrong (and on Vercel, unused/ignored)
//
// Core route handlers never change between these — only whichever thin
// adapter hands requests to `app` differs. See server/adapters/.

const app = express();

app.set('trust proxy', 1); // needed behind Vercel/Netlify/Render/any reverse proxy for secure cookies

app.use(helmet());
app.use(
  cors({
    origin: env.frontendUrl,
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(env.session.secret || 'dev-only-insecure-secret'));

// Global rate limit — GitHub's own API limits are handled separately
// (see githubService's throttling/retry plugins); this just protects our
// own endpoints from abuse.
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Auth endpoints get a tighter limit — this is the one surface an
// unauthenticated attacker can hit at all (everything else requires a
// valid session), so it's worth a stricter ceiling against
// credential/OAuth-state brute-forcing.
app.use(
  '/api/auth',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(attachUser);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Public — powers the landing page stats panel, shown before sign-in.
app.use('/api/stats', statsRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/github/repos', repoRoutes);
// files & branches are nested under /repos/:owner/:repo/... — mounted
// separately (not on repoRoutes) so repoRoutes' `/:owner/:repo` GET
// doesn't shadow them.
app.use('/api/github/repos', fileRoutes);
app.use('/api/github/repos', branchRoutes);
app.use('/api/github/repos', commitRoutes);
app.use('/api/github/repos', issueRoutes);
app.use('/api/github/repos', pullRoutes);
app.use('/api/github/repos', actionRoutes);
app.use('/api/github/repos', releaseRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/activity', activityRoutes);
// Vercel workspace — entirely independent of GitHub connectivity (see
// vercelService.js / connectionService.js's resolveVercelConnection).
app.use('/api/vercel', vercelRoutes);

// 404
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Central error handler — never leak stack traces to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large for the configured upload limit.' });
  }
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Something went wrong.' });
});

export default app;
