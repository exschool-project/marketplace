import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lineDiff } from '../js/diff.js';

describe('lineDiff', () => {
  test('identical text has zero additions/deletions', () => {
    const { rows, additions, deletions } = lineDiff('a\nb\nc', 'a\nb\nc');
    assert.equal(additions, 0);
    assert.equal(deletions, 0);
    assert.equal(rows.every((r) => r.type === 'ctx'), true);
  });

  test('detects a single added line', () => {
    const { additions, deletions } = lineDiff('a\nb', 'a\nb\nc');
    assert.equal(additions, 1);
    assert.equal(deletions, 0);
  });

  test('detects a single deleted line', () => {
    const { additions, deletions } = lineDiff('a\nb\nc', 'a\nb');
    assert.equal(additions, 0);
    assert.equal(deletions, 1);
  });

  test('detects a line replacement as one add + one delete', () => {
    const { additions, deletions } = lineDiff('a\nb\nc', 'a\nX\nc');
    assert.equal(additions, 1);
    assert.equal(deletions, 1);
  });

  test('preserves line order in the row output', () => {
    const { rows } = lineDiff('a\nb', 'a\nb\nc');
    const texts = rows.map((r) => r.text);
    assert.deepEqual(texts, ['a', 'b', 'c']);
  });

  test('handles empty-to-nonempty (new file)', () => {
    const { additions, deletions } = lineDiff('', 'a\nb\nc');
    // splitting '' gives [''], so the first row is a ctx/del of the
    // empty string then 3 additions — additions should be >= 3
    assert.ok(additions >= 3);
    assert.equal(deletions <= 1, true);
  });

  test('handles nonempty-to-empty (full delete)', () => {
    const { additions, deletions } = lineDiff('a\nb\nc', '');
    assert.ok(deletions >= 3);
    assert.equal(additions <= 1, true);
  });
});
