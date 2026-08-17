// ⚠️ HONEST NOTE: these tests were written but NOT executed in the
// sandbox that produced this code — `adm-zip` isn't installed there (no
// network access to run `npm install`), so `import AdmZip from
// 'adm-zip'` would fail before a single test runs. Run `npm install &&
// npm test` yourself to actually verify these pass. I'm confident in the
// logic by reading it, but "I read the code" is not the same as "I ran
// the code," and this file exists specifically to close that gap for
// you, not to pretend it's already closed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { inspectZip } from '../src/services/zipInspector.js';

function buildZip(entries) {
  const zip = new AdmZip();
  for (const e of entries) {
    zip.addFile(e.name, Buffer.from(e.content ?? 'hello world'));
  }
  return zip.toBuffer();
}

describe('inspectZip — ZIP slip protection', () => {
  test('accepts a normal, well-formed zip', () => {
    const buf = buildZip([{ name: 'src/index.js' }, { name: 'README.md' }]);
    const { safeEntries } = inspectZip(buf, { maxFiles: 100, maxExtractedSize: 10_000_000 });
    assert.equal(safeEntries.length, 2);
  });

  test('rejects an entry with parent-directory traversal', () => {
    const buf = buildZip([{ name: '../../etc/passwd', content: 'evil' }]);
    assert.throws(
      () => inspectZip(buf, { maxFiles: 100, maxExtractedSize: 10_000_000 }),
      /path traversal|Unsafe path/i
    );
  });

  test('rejects the WHOLE upload if even one entry is unsafe', () => {
    const buf = buildZip([{ name: 'fine.txt' }, { name: '../evil.txt' }]);
    assert.throws(() => inspectZip(buf, { maxFiles: 100, maxExtractedSize: 10_000_000 }));
  });
});

describe('inspectZip — limits', () => {
  test('rejects when file count exceeds maxFiles', () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ name: `file${i}.txt` }));
    const buf = buildZip(entries);
    assert.throws(
      () => inspectZip(buf, { maxFiles: 5, maxExtractedSize: 10_000_000 }),
      /exceeds the limit/i
    );
  });

  test('rejects when total uncompressed size exceeds maxExtractedSize', () => {
    const buf = buildZip([{ name: 'big.txt', content: 'x'.repeat(1_000_000) }]);
    assert.throws(
      () => inspectZip(buf, { maxFiles: 100, maxExtractedSize: 1000 }),
      /extracted size exceeds|zip bomb/i
    );
  });

  test('flags a suspicious compression ratio (zip-bomb-style file)', () => {
    // A large run of a single repeated byte compresses extremely well —
    // this is the classic "zip bomb" shape (tiny compressed, huge
    // uncompressed). 20MB of zeros should trip the ratio check.
    const buf = buildZip([{ name: 'zeros.bin', content: Buffer.alloc(20_000_000) }]);
    assert.throws(
      () => inspectZip(buf, { maxFiles: 100, maxExtractedSize: 500_000_000 }),
      /suspicious compression ratio|zip bomb/i
    );
  });
});

describe('inspectZip — normal files are not falsely flagged', () => {
  test('a handful of small, ordinary text files pass cleanly', () => {
    const buf = buildZip([
      { name: 'package.json', content: '{"name":"test"}' },
      { name: 'src/index.js', content: 'console.log("hi")' },
      { name: '.gitignore', content: 'node_modules/' },
    ]);
    const { safeEntries } = inspectZip(buf, { maxFiles: 100, maxExtractedSize: 10_000_000 });
    assert.equal(safeEntries.length, 3);
  });
});
