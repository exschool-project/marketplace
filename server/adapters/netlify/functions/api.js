// Netlify Functions run on a Lambda-style (event, context) => response
// contract, not Node's (req, res) — unlike Vercel, that means Express
// can't be handed to the platform directly. `serverless-http` is a thin
// translation layer only; it contains no UPGit business logic. Everything
// that actually matters (routes, auth, uploads, GitHub calls) lives in
// server/src/app.js and is shared with every other deployment target.
import serverless from 'serverless-http';
import app from '../../../src/app.js';

export const handler = serverless(app);
