import crypto from 'crypto';
import { env } from '../config/env.js';

// AES-256-GCM for encrypting the one thing UPGit now sometimes has to
// store that it didn't before: a Simple Mode (OAuth) user's GitHub
// access token. Developer Mode (GitHub App) never needed this — it only
// ever persists an installation_id and mints short-lived installation
// tokens on demand (see githubService.getInstallationOctokit). Simple
// Mode has no such minting mechanism (there's no "installation" to mint
// from), so the token itself has to live somewhere between logins — this
// is that somewhere, and it's never stored in plaintext.
//
// The key is derived with SHA-256 from TOKEN_ENCRYPTION_KEY so any
// string of any length works as the env var (forgiving for manual setup)
// while what's actually used for AES is always exactly 32 bytes.
function getKey() {
  if (!env.tokenEncryptionKey) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is not set — required to store Simple Mode (OAuth) connections securely. Generate one with `openssl rand -hex 32` and add it as an environment variable.'
    );
  }
  return crypto.createHash('sha256').update(env.tokenEncryptionKey).digest();
}

const IV_LENGTH = 12; // GCM standard

export function encryptToken(plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // iv:authTag:ciphertext, all base64 — one text column, no schema for
  // sub-parts needed.
  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptToken(stored) {
  const [ivB64, authTagB64, dataB64] = String(stored).split(':');
  if (!ivB64 || !authTagB64 || !dataB64) throw new Error('Stored token is malformed — cannot decrypt.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return decrypted.toString('utf-8');
}
