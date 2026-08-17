// Resolves where the backend API lives.
//
// Default: '/api', same-origin. This is correct whenever the frontend and
// backend are served from the same domain — a plain VPS/Docker/Render Node
// service, or a Netlify/Vercel deployment that proxies/rewrites /api/* to
// the serverless function adapter (see netlify.toml / vercel.json).
//
// Override: if the frontend is deployed separately from the backend (e.g.
// a static site on Netlify/Vercel pointing at a backend on Render/a VPS),
// set `window.__UPGIT_API_BASE__` to the backend's full origin *before*
// this module loads — e.g. add to client/index.html:
//   <script>window.__UPGIT_API_BASE__ = 'https://api.example.com/api';</script>
// (Keep this out of index.html by default so same-origin deployments need
// zero configuration.)
export const API_BASE = (typeof window !== 'undefined' && window.__UPGIT_API_BASE__) || '/api';
