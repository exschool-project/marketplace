import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSafeRelativePath,
  isSecretFile,
  detectProjectTypes,
  hasGitignore,
  GITIGNORE_TEMPLATES,
} from '../src/services/uploadSecurity.js';

describe('isSafeRelativePath (ZIP slip / path traversal defense)', () => {
  test('accepts normal relative paths', () => {
    assert.equal(isSafeRelativePath('src/index.js'), true);
    assert.equal(isSafeRelativePath('README.md'), true);
    assert.equal(isSafeRelativePath('a/b/c/d.txt'), true);
  });

  test('rejects parent-directory traversal', () => {
    assert.equal(isSafeRelativePath('../evil.txt'), false);
    assert.equal(isSafeRelativePath('../../etc/passwd'), false);
    assert.equal(isSafeRelativePath('a/../../evil.txt'), false);
    assert.equal(isSafeRelativePath('a/b/../../../evil.txt'), false);
  });

  test('rejects absolute paths', () => {
    assert.equal(isSafeRelativePath('/etc/passwd'), false);
    assert.equal(isSafeRelativePath('C:\\Windows\\System32'), false);
  });

  test('rejects null bytes and malformed input', () => {
    assert.equal(isSafeRelativePath('evil\0.txt'), false);
    assert.equal(isSafeRelativePath(''), false);
    assert.equal(isSafeRelativePath(null), false);
    assert.equal(isSafeRelativePath(undefined), false);
  });

  test('handles backslash path separators (Windows-style zips)', () => {
    assert.equal(isSafeRelativePath('a\\..\\..\\evil.txt'), false);
    assert.equal(isSafeRelativePath('a\\b\\c.txt'), true);
  });
});

describe('isSecretFile', () => {
  test('flags common secret filenames', () => {
    assert.equal(isSecretFile('.env'), true);
    assert.equal(isSecretFile('.env.production'), true);
    assert.equal(isSecretFile('config/.env.local'), true);
    assert.equal(isSecretFile('server.pem'), true);
    assert.equal(isSecretFile('private.key'), true);
    assert.equal(isSecretFile('id_rsa'), true);
    assert.equal(isSecretFile('credentials.json'), true);
    assert.equal(isSecretFile('service-account-prod.json'), true);
  });

  test('does not flag ordinary files', () => {
    assert.equal(isSecretFile('index.js'), false);
    assert.equal(isSecretFile('package.json'), false);
    assert.equal(isSecretFile('environment.js'), false); // contains "env" but isn't .env
    assert.equal(isSecretFile('keyboard.js'), false); // contains "key" but wrong extension
  });
});

describe('detectProjectTypes', () => {
  test('detects known project markers', () => {
    assert.deepEqual(detectProjectTypes(['package.json', 'src/index.js']), ['Node.js']);
    assert.deepEqual(detectProjectTypes(['requirements.txt']), ['Python']);
    assert.deepEqual(detectProjectTypes(['Dockerfile']), ['Docker']);
  });

  test('detects multiple markers without duplicates', () => {
    const result = detectProjectTypes(['package.json', 'vite.config.js', 'Dockerfile']);
    assert.equal(result.includes('Node.js'), true);
    assert.equal(result.includes('Vite'), true);
    assert.equal(result.includes('Docker'), true);
    assert.equal(result.length, new Set(result).size); // no duplicates
  });

  test('returns empty array for unrecognized project', () => {
    assert.deepEqual(detectProjectTypes(['random.txt', 'notes.md']), []);
  });
});

describe('hasGitignore', () => {
  test('detects .gitignore at any depth', () => {
    assert.equal(hasGitignore(['.gitignore']), true);
    assert.equal(hasGitignore(['src/index.js', '.gitignore']), true);
  });
  test('false when absent', () => {
    assert.equal(hasGitignore(['src/index.js', 'README.md']), false);
  });
});

describe('GITIGNORE_TEMPLATES', () => {
  test('every advertised template key has non-empty content', () => {
    for (const [key, content] of Object.entries(GITIGNORE_TEMPLATES)) {
      assert.ok(content.length > 0, `template "${key}" should not be empty`);
    }
  });
});
