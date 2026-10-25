import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import { decodeBundleSet } from '../protocol/index.ts';
import { buildBundleSet, ConfigLoadError } from './bundler.ts';

const fixtureConfig = fileURLToPath(
  new URL('../../../../fixtures/knowledge-base/kemian.config.ts', import.meta.url),
);

const privateFacts = [
  'Quillwork',
  'plugin platform team',
  '95,000',
  '110,000',
  'four-day week',
  '+351',
  'robin@example.com',
  'contact.md',
  'Atlas',
  'atlas.md',
  'December',
  'recruiter',
  'Tidepool',
];
const excludedFacts = ['meetup-talk-transcript', 'everyone thinks'];

describe('buildBundleSet', () => {
  it('builds the fixture knowledge base without problems', async () => {
    const { bundleSet, problems } = await buildBundleSet({ configPath: fixtureConfig });
    expect(problems).toEqual([]);
    expect(bundleSet.bundles.map((bundle) => bundle.level)).toEqual(['public', 'private']);
  });

  it('keeps every private fact out of the public bundle', async () => {
    const { bundleSet } = await buildBundleSet({ configPath: fixtureConfig });
    const [publicBundle, privateBundle] = bundleSet.bundles.map((bundle) => JSON.stringify(bundle));
    expect(privateFacts.filter((fact) => publicBundle?.includes(fact))).toEqual([]);
    expect(privateFacts.filter((fact) => !privateBundle?.includes(fact))).toEqual([]);
    expect(
      excludedFacts.filter((fact) => publicBundle?.includes(fact) || privateBundle?.includes(fact)),
    ).toEqual([]);
  });

  it('applies the build overrides', async () => {
    const { bundleSet } = await buildBundleSet({
      configPath: fixtureConfig,
      build: { id: 'build-1', createdAt: '2026-10-25T12:00:00Z', source: 'abc123' },
    });
    expect(bundleSet.build).toEqual({
      id: 'build-1',
      createdAt: '2026-10-25T12:00:00Z',
      source: 'abc123',
    });
  });

  it.effect('produces a bundle set that survives JSON and validation', () =>
    Effect.gen(function* () {
      const { bundleSet } = yield* Effect.promise(() =>
        buildBundleSet({ configPath: fixtureConfig }),
      );
      const decoded = yield* decodeBundleSet(JSON.parse(JSON.stringify(bundleSet)));
      expect(decoded).toEqual(bundleSet);
    }),
  );

  it('rejects a missing config file', async () => {
    await expect(buildBundleSet({ configPath: 'missing.config.ts' })).rejects.toBeInstanceOf(
      ConfigLoadError,
    );
  });
});
