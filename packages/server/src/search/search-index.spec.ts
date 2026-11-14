import { describe, expect, it } from '@effect/vitest';

import type { Bundle, BundleFile } from '../protocol/index.ts';
import { buildSearchIndex, loadSearchIndex, SEARCH_INDEX_FORMAT } from './search-index.ts';

const files: BundleFile[] = [
  { path: 'projects/lantern.md', title: 'Lantern', content: 'A language server for YAML files.' },
  { path: 'projects/atlas.md', title: 'Atlas', content: 'A map of internal services.' },
];

const bundleWith = (overrides: Partial<Bundle>): Bundle => ({
  protocol: 1,
  level: 'public',
  build: { id: 'build-1', createdAt: '2026-10-26T12:00:00Z' },
  folders: [],
  files,
  ...overrides,
});

const pathsFor = (bundle: Bundle, query: string) =>
  loadSearchIndex(bundle)
    .search(query)
    .map((match) => match.path);

describe('loadSearchIndex', () => {
  it('builds an index when the bundle has none', () => {
    expect(pathsFor(bundleWith({}), 'yaml')).toEqual(['projects/lantern.md']);
  });

  it('uses the prebuilt index instead of the files', () => {
    const indexedFiles = [{ path: 'projects/atlas.md', content: 'only in the prebuilt index' }];
    const bundle = bundleWith({ search: buildSearchIndex(indexedFiles) });
    expect(pathsFor(bundle, 'prebuilt')).toEqual(['projects/atlas.md']);
    expect(pathsFor(bundle, 'yaml')).toEqual([]);
  });

  it('survives a JSON round trip', () => {
    const search = buildSearchIndex(files);
    const data: unknown = JSON.parse(JSON.stringify(search.data));
    expect(pathsFor(bundleWith({ search: { ...search, data } }), 'lantern')).toEqual([
      'projects/lantern.md',
    ]);
  });

  describe('matching', () => {
    const records: BundleFile[] = [
      { path: 'about/profile.md', content: 'I want at least 110,000 EUR and a map of the city.' },
      { path: 'about/contact.md', content: 'Phone: +351 900 000 000' },
      { path: 'journal/2026-10-13.md', content: 'Notes from 2026-10-13, with many details.' },
    ];
    const recordsBundle = bundleWith({ files: records, search: buildSearchIndex(records) });

    it('matches a number with separators as one term', () => {
      expect(pathsFor(recordsBundle, '110,000')).toEqual(['about/profile.md']);
    });

    it("doesn't match numbers loosely", () => {
      expect(pathsFor(recordsBundle, '110')).toEqual([]);
      expect(pathsFor(recordsBundle, '20')).toEqual([]);
    });

    it('still splits words at punctuation', () => {
      expect(pathsFor(recordsBundle, 'phone')).toEqual(['about/contact.md']);
      expect(pathsFor(recordsBundle, '2026')).toEqual(['journal/2026-10-13.md']);
    });

    it('matches longer words by prefix and with typos', () => {
      expect(pathsFor(recordsBundle, 'detai')).toEqual(['journal/2026-10-13.md']);
      expect(pathsFor(recordsBundle, 'detsils')).toEqual(['journal/2026-10-13.md']);
    });

    it("doesn't match short words with typos", () => {
      expect(pathsFor(recordsBundle, 'mop')).toEqual([]);
    });
  });

  it.each([
    ['an unknown format', { format: 'lunr-2', data: buildSearchIndex(files).data }],
    ['malformed data', { format: SEARCH_INDEX_FORMAT, data: { index: 'nope' } }],
    [
      'data from an incompatible engine version',
      { format: SEARCH_INDEX_FORMAT, data: { serializationVersion: 99, index: [] } },
    ],
  ])('rebuilds the index for %s', (_, search) => {
    expect(pathsFor(bundleWith({ search }), 'yaml')).toEqual(['projects/lantern.md']);
  });
});
