import app from './app.js';
import { env } from './config/env.js';

// Standard long-running entrypoint — used for local dev, Docker, Render,
// and any plain VPS/Node host. `npm start` runs this file.
//
// Serverless platforms (Netlify Functions, Vercel Functions) do NOT use
// this file — they import server/src/app.js directly through their own
// thin adapter in server/adapters/, since the platform (not this process)
// owns the request lifecycle there. See DEPLOYMENT.md.
app.listen(env.port, () => {
  console.log(`UPGit server listening on :${env.port} (${env.nodeEnv})`);
});
