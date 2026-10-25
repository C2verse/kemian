import { describe, expect, it } from '@effect/vitest';
import { Schema } from 'effect';

import { bundleOf } from './bundle-fixtures.spec-helper.ts';
import { Bundle } from './index.ts';

const withPath = (path: string) => bundleOf('public', { files: [{ path, content: '' }] });

describe('Bundle', () => {
  const isBundle = Schema.is(Bundle);

  it.each(['a.md', 'projects/a.md', '.hidden/a.md', 'a/..b.md', 'a/.../b.md'])(
    'accepts the file path %s',
    (path) => {
      expect(isBundle(withPath(path))).toBe(true);
    },
  );

  it.each(['', '/a.md', '../a.md', 'a/../b.md', 'a/./b.md', 'a//b.md', 'a\\b.md', 'a/'])(
    'rejects the file path %j',
    (path) => {
      expect(isBundle(withPath(path))).toBe(false);
    },
  );

  it.each(['Public', 'my level', '1st', ''])('rejects the level %j', (level) => {
    expect(isBundle(bundleOf(level))).toBe(false);
  });
});
