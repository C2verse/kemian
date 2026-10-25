import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import { build, bundleOf, bundleSetOf } from './bundle-fixtures.spec-helper.ts';
import { decodeBundleSet } from './index.ts';

const decodeFailure = (input: unknown) => Effect.flip(decodeBundleSet(input));

describe('decodeBundleSet', () => {
  it.effect('decodes a valid bundle set', () =>
    Effect.gen(function* () {
      const set = yield* decodeBundleSet(bundleSetOf());
      expect(set.bundles.map((bundle) => bundle.level)).toEqual(['public', 'private']);
    }),
  );

  it.effect('drops fields it does not know', () =>
    Effect.gen(function* () {
      const set = yield* decodeBundleSet(
        bundleSetOf({ future: true, bundles: [bundleOf('public', { future: true })] }),
      );
      expect(set).not.toHaveProperty('future');
      expect(set.bundles[0]).not.toHaveProperty('future');
    }),
  );

  it.effect('rejects an unsupported protocol version', () =>
    Effect.gen(function* () {
      const error = yield* decodeFailure(bundleSetOf({ protocol: 2 }));
      expect(error._tag).toBe('UnsupportedProtocolError');
    }),
  );

  it.effect('rejects input without a protocol version', () =>
    Effect.gen(function* () {
      const error = yield* decodeFailure({ build, bundles: [] });
      expect(error._tag).toBe('InvalidBundleError');
    }),
  );

  it.effect('rejects duplicate levels', () =>
    Effect.gen(function* () {
      const error = yield* decodeFailure(
        bundleSetOf({ bundles: [bundleOf('public'), bundleOf('public')] }),
      );
      expect(error._tag).toBe('InvalidBundleError');
    }),
  );

  it.effect('rejects a bundle from another build', () =>
    Effect.gen(function* () {
      const other = bundleOf('private', { build: { ...build, id: 'build-2' } });
      const error = yield* decodeFailure(bundleSetOf({ bundles: [bundleOf('public'), other] }));
      expect(error._tag).toBe('InvalidBundleError');
    }),
  );

  it.effect('rejects duplicate file paths', () =>
    Effect.gen(function* () {
      const file = { path: 'a.md', content: '' };
      const bundle = bundleOf('public', { files: [file, file] });
      const error = yield* decodeFailure(bundleSetOf({ bundles: [bundle] }));
      expect(error._tag).toBe('InvalidBundleError');
    }),
  );
});
