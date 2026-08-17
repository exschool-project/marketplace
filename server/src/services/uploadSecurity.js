import path from 'node:path';

// ============================================================
// Path safety (ZIP Slip / path traversal defense)
// ============================================================

/**
 * Returns true only if `relPath` is a plain relative path with no
 * traversal, no absolute prefix, and no null bytes. Applied to every
 * entry — ZIP entries AND individually-uploaded file paths alike.
 */
export function isSafeRelativePath(relPath) {
  if (!relPath || typeof relPath !== 'string') return false;
  if (relPath.includes('\0')) return false;

  const posix = relPath.replace(/\\/g, '/');
  if (posix.startsWith('/') || /^[a-zA-Z]:/.test(posix)) return false; // absolute / Windows drive

  const normalized = path.posix.normalize(posix);
  if (normalized === '..' || normalized.startsWith('../')) return false;
  if (normalized.split('/').includes('..')) return false;

  return true;
}

/** Resolves a target path and asserts it did not escape `baseDir`. */
export function assertContained(baseDir, relPath) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(baseDir, relPath);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error(`Path escapes target directory: "${relPath}"`);
  }
  return resolvedTarget;
}

// ============================================================
// Secret file detection
// ============================================================

const SECRET_FILENAME_PATTERNS = [
  /^\.env(\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /^id_rsa$/i,
  /^id_ed25519$/i,
  /^id_dsa$/i,
  /^credentials\.json$/i,
  /^service-account.*\.json$/i,
  /^\.npmrc$/i,
  /^\.pgpass$/i,
];

export function isSecretFile(relativePath) {
  const name = path.basename(relativePath);
  return SECRET_FILENAME_PATTERNS.some((re) => re.test(name));
}

// ============================================================
// Smart project detection (informational only — never auto-runs anything)
// ============================================================

const PROJECT_MARKERS = [
  { file: 'package.json', label: 'Node.js' },
  { file: 'vite.config.js', label: 'Vite' },
  { file: 'vite.config.ts', label: 'Vite' },
  { file: 'next.config.js', label: 'Next.js' },
  { file: 'next.config.mjs', label: 'Next.js' },
  { file: 'next.config.ts', label: 'Next.js' },
  { file: 'requirements.txt', label: 'Python' },
  { file: 'pyproject.toml', label: 'Python' },
  { file: 'composer.json', label: 'PHP (Composer)' },
  { file: 'Dockerfile', label: 'Docker' },
  { file: 'pom.xml', label: 'Java (Maven)' },
  { file: 'build.gradle', label: 'Java (Gradle)' },
  { file: 'build.gradle.kts', label: 'Java/Kotlin (Gradle)' },
];

export function detectProjectTypes(relativePaths) {
  const basenames = new Set(relativePaths.map((p) => path.basename(p)));
  const detected = PROJECT_MARKERS.filter((m) => basenames.has(m.file)).map((m) => m.label);
  return [...new Set(detected)];
}

export function hasGitignore(relativePaths) {
  return relativePaths.some((p) => path.basename(p) === '.gitignore');
}

// ============================================================
// .gitignore templates
// ============================================================

export const GITIGNORE_TEMPLATES = {
  node: 'node_modules/\nnpm-debug.log*\n.env\n.env.local\ndist/\n',
  react: 'node_modules/\nbuild/\n.env\n.env.local\n',
  vite: 'node_modules/\ndist/\n.env\n.env.local\n',
  nextjs: 'node_modules/\n.next/\nout/\n.env*.local\n',
  python: '__pycache__/\n*.pyc\n.venv/\nvenv/\n.env\n*.egg-info/\n',
  php: 'vendor/\n.env\ncomposer.lock\n',
  java: 'target/\n*.class\nbuild/\n.gradle/\n',
  android: '*.apk\n*.aab\n.gradle/\nlocal.properties\n.idea/\n',
  general: '.DS_Store\nThumbs.db\n.env\n*.log\n',
};
