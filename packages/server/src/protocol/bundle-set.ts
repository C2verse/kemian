import { Schema } from 'effect';

import { Bundle, BuildInfo } from './bundle.ts';
import { isEachUnique } from './uniqueness.ts';

/**
 * Bundles of every level from one build, published and replaced together.
 */
export const BundleSet = Schema.Struct({
  protocol: Schema.Literal(1),
  build: BuildInfo,
  bundles: Schema.NonEmptyArray(Bundle),
})
  .check(
    Schema.makeFilter((set) => isEachUnique(set.bundles.map((bundle) => bundle.level)), {
      expected: 'bundles with unique levels',
    }),
    Schema.makeFilter((set) => set.bundles.every((bundle) => bundle.build.id === set.build.id), {
      expected: "bundles whose build ID matches the set's",
    }),
  )
  .annotate({ identifier: 'BundleSet' });
export type BundleSet = typeof BundleSet.Type;
