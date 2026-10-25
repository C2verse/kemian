import { describe, expect, it } from '@effect/vitest';

import { BundleReader } from './bundle-reader.ts';
import { privateBundle } from './core-fixtures.spec-helper.ts';

const reader = new BundleReader(privateBundle());

describe('BundleReader', () => {
  it('lists folders before files, with summaries', () => {
    expect(reader.list('/')).toEqual([
      { kind: 'folder', path: 'projects', summary: 'Things Robin has built.' },
      { kind: 'file', path: 'README.md', title: 'Robin Example', summary: 'Who Robin is.' },
    ]);
  });

  it('lists a folder by any spelling of its path', () => {
    for (const path of ['projects', '/projects', 'projects/', './projects']) {
      expect(reader.list(path)?.map((entry) => entry.path)).toEqual([
        'projects/atlas.md',
        'projects/lantern.md',
      ]);
    }
  });

  it('returns undefined for a missing folder', () => {
    expect(reader.list('secrets')).toBeUndefined();
  });

  it('reads files by path', () => {
    expect(reader.read('/projects/lantern.md')?.title).toBe('Lantern');
    expect(reader.read('missing.md')).toBeUndefined();
  });

  it('searches content, titles, and summaries with prefixes and typos', () => {
    expect(reader.search('yaml', { limit: 10 }).map((hit) => hit.file.path)).toEqual([
      'projects/lantern.md',
    ]);
    expect(reader.search('unannounc', { limit: 10 })[0]?.file.path).toBe('projects/atlas.md');
    expect(reader.search('lanturn', { limit: 10 })[0]?.file.path).toBe('projects/lantern.md');
  });

  it('returns a snippet around the first match', () => {
    expect(reader.search('validation', { limit: 1 })[0]?.snippet).toContain(
      'completion and validation',
    );
  });

  it('honors the limit', () => {
    expect(reader.search('robin lantern atlas', { limit: 1 })).toHaveLength(1);
  });
});
