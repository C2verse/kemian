import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import { resolveConfig } from './config.ts';

describe('resolveConfig', () => {
  it.effect('applies defaults', () =>
    Effect.gen(function* () {
      const config = yield* resolveConfig({ levels: ['public', 'private'] });
      expect(config).toMatchObject({
        levels: ['public', 'private'],
        root: '.',
        include: ['**/*.md'],
        exclude: [],
        defaultVisibility: 'private',
        frontmatterKeys: {
          visibility: 'visibility',
          summary: 'summary',
          title: 'title',
          updated: 'updated',
          verified: 'verified',
          status: 'status',
        },
        markers: 'keep',
        proposals: { notesFolder: 'inbox', archivedStatus: 'archived', obsoleteNotes: 'delete' },
      });
      expect(config.reviewIntervals.size).toBe(0);
      expect(config.filter({ level: 'public', path: 'a.md', frontmatter: {} })).toBe(true);
      expect(config.url({ level: 'public', path: 'a.md' })).toBeUndefined();
    }),
  );

  it.effect('reads review intervals and proposal options', () =>
    Effect.gen(function* () {
      const config = yield* resolveConfig({
        levels: ['public'],
        review: { intervals: { evolving: 30, stable: 180 } },
        proposals: { notes: 'notes/agents', archivedStatus: 'retired', obsoleteNotes: 'archive' },
      });
      expect([...config.reviewIntervals]).toEqual([
        ['evolving', 30],
        ['stable', 180],
      ]);
      expect(config.proposals).toEqual({
        notesFolder: 'notes/agents',
        archivedStatus: 'retired',
        obsoleteNotes: 'archive',
      });
    }),
  );

  it.effect('treats a hook returning a non-boolean as leaving the file out', () =>
    Effect.gen(function* () {
      const config = yield* resolveConfig({ levels: ['public'], filter: () => 'yes' });
      expect(config.filter({ level: 'public', path: 'a.md', frontmatter: {} })).toBe(false);
    }),
  );

  it.each([
    ['no levels', { levels: [] }],
    ['an invalid level name', { levels: ['Public'] }],
    ['duplicate levels', { levels: ['public', 'public'] }],
    ['an unknown default visibility', { levels: ['public'], defaultVisibility: 'private' }],
    [
      'instructions for an unknown level',
      { levels: ['public'], instructions: { private: 'a.md' } },
    ],
    ['an unknown markers option', { levels: ['public'], markers: 'hide' }],
    ['a filter that is not a function', { levels: ['public'], filter: 'drafts' }],
    ['a missing config', undefined],
    ['a review interval of zero days', { levels: ['public'], review: { intervals: { a: 0 } } }],
    ['a fractional review interval', { levels: ['public'], review: { intervals: { a: 1.5 } } }],
    ['a notes folder outside the root', { levels: ['public'], proposals: { notes: '../inbox' } }],
    ['an absolute notes folder', { levels: ['public'], proposals: { notes: '/inbox' } }],
    [
      'a notes folder with a trailing slash',
      { levels: ['public'], proposals: { notes: 'inbox/' } },
    ],
    [
      'an unknown obsolete notes option',
      { levels: ['public'], proposals: { obsoleteNotes: 'keep' } },
    ],
  ])('rejects %s', (_, config) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(resolveConfig(config));
      expect(error._tag).toBe('InvalidConfigError');
    }).pipe(Effect.runPromise),
  );
});
