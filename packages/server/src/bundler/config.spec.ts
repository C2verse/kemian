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
        },
        markers: 'keep',
      });
      expect(config.filter({ level: 'public', path: 'a.md', frontmatter: {} })).toBe(true);
      expect(config.url({ level: 'public', path: 'a.md' })).toBeUndefined();
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
  ])('rejects %s', (_, config) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(resolveConfig(config));
      expect(error._tag).toBe('InvalidConfigError');
    }).pipe(Effect.runPromise),
  );
});
