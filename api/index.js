// Vercel Node.js Functions accept a plain (req, res) handler — an Express
// app instance already satisfies that signature, so no wrapper library is
// needed here (contrast with server/adapters/netlify/, which does need
// one). This file is intentionally tiny: all real logic lives in
// server/src/app.js and is shared with every other deployment target.
//
// vercel.json rewrites every /api/* request to this single function; the
// Express app inside still does its own routing for /api/auth,
// /api/github/repos, /api/uploads, etc.
import app from '../server/src/app.js';

export default function handler(req, res) {
  // Vercel's Node.js runtime pre-populates req.cookies (unsigned, via its
  // own helper) before this handler runs. cookie-parser sees that
  // truthy req.cookies and short-circuits (`if (req.cookies) return next()`)
  // WITHOUT ever setting req.secret — which is what breaks signed
  // cookies (res.cookie(..., { signed: true })) throughout auth. Clearing
  // it here forces cookie-parser to do its own parsing, including secret
  // setup, exactly as it would on any non-Vercel host.
  delete req.cookies;
  return app(req, res);
}
