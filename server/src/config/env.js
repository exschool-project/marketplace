import 'dotenv/config';

const required = [
  'GITHUB_APP_ID',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_CALLBACK_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SESSION_SECRET',
];

// In production, refuse to boot with missing secrets instead of
// silently running with an insecure default.
if (process.env.NODE_ENV === 'production') {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.error(`[FATAL] Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

function normalizePrivateKey(raw) {
  if (!raw) return '';
  // Support both a literal PEM (with real newlines) and a single-line
  // value where newlines were escaped as \n (common in hosting UIs).
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  github: {
    appId: process.env.GITHUB_APP_ID || '',
    appSlug: process.env.GITHUB_APP_SLUG || '',
    clientId: process.env.GITHUB_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    privateKey: normalizePrivateKey(process.env.GITHUB_APP_PRIVATE_KEY),
    callbackUrl: process.env.GITHUB_CALLBACK_URL || 'http://localhost:3000/api/auth/github/callback',
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',

    // Simple Mode uses a *separate*, standalone GitHub OAuth App — not
    // the GitHub App above. This is deliberate, not an oversight: a
    // GitHub App's user-to-server token can only reach resources the App
    // has an installation for, so it can't give the "just log in, no
    // install step" experience Simple Mode promises. A classic OAuth App
    // has no installation concept — its user token works against
    // whatever the `repo` scope grants immediately, personal account
    // included. Optional — only checked when a Simple Mode route is hit
    // (see requireOAuthConfigured in routes/auth.js), so a deployment
    // that only wants Developer Mode doesn't need to set these up.
    oauthClientId: process.env.GITHUB_OAUTH_CLIENT_ID || '',
    oauthClientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET || '',
    oauthCallbackUrl: process.env.GITHUB_OAUTH_CALLBACK_URL || 'http://localhost:3000/api/auth/github/oauth/callback',
  },

  // Encrypts the Simple Mode OAuth access token before it's stored (see
  // services/cryptoService.js). Same lazy-check treatment as the OAuth
  // App credentials above — only required once Simple Mode is actually
  // used, not at boot.
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || '',

  supabase: {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },

  session: {
    secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret',
    cookieName: process.env.SESSION_COOKIE_NAME || 'upgit_session',
    ttlHours: Number(process.env.SESSION_TTL_HOURS || 168),
  },

  upload: {
    maxSize: Number(process.env.UPLOAD_MAX_SIZE || 4194304), // 4MB per file
    maxFiles: Number(process.env.MAX_FILES || 2000),
    maxExtractedSize: Number(process.env.MAX_EXTRACTED_SIZE || 209715200),
  },
};
