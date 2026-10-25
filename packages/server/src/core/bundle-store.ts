import { Effect, Schema } from 'effect';

import type { Bundle, BundleSet, Level } from '../protocol/index.ts';

/**
 * Storage of the published bundle set that the server reads bundles from.
 *
 * Implementations replace all levels together: a reader sees one build or the other, never a mix.
 */
export interface BundleStore {
  /** Returns the ID of the current build, or `undefined` before the first publish. */
  readonly currentBuildId: () => Promise<string | undefined>;
  /** Returns one level's bundle of a build, or `undefined` when the build has no such level. */
  readonly getBundle: (buildId: string, level: Level) => Promise<Bundle | undefined>;
  /** Stores a validated bundle set and makes it the current build. */
  readonly replace: (bundleSet: BundleSet) => Promise<void>;
}

/**
 * Error for a bundle store that failed to read or write.
 */
export class BundleStoreError extends Schema.TaggedError<
  BundleStoreError,
  { readonly brand: unique symbol }
>()('BundleStoreError', { reason: Schema.String }) {
  override get message(): string {
    return `bundle store failed: ${this.reason}`;
  }
}

/**
 * Runs a bundle store operation, turning its rejection into a {@link BundleStoreError}.
 */
export const fromStore = <A>(operation: () => Promise<A>): Effect.Effect<A, BundleStoreError> =>
  Effect.tryPromise({
    try: operation,
    catch: (error) => new BundleStoreError({ reason: String(error) }),
  });
