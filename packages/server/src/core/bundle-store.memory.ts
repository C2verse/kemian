import type { Bundle, BundleSet, Level } from '../protocol/index.ts';
import type { BundleStore } from './bundle-store.ts';

/**
 * Creates a {@link BundleStore} that keeps the current build in memory, for tests and local development.
 */
export const memoryBundleStore = (): BundleStore => {
  let current: { readonly id: string; readonly bundles: ReadonlyMap<Level, Bundle> } | undefined;
  return {
    currentBuildId: async () => current?.id,
    getBundle: async (buildId, level) =>
      current?.id === buildId ? current.bundles.get(level) : undefined,
    replace: async (bundleSet: BundleSet) => {
      current = {
        id: bundleSet.build.id,
        bundles: new Map(bundleSet.bundles.map((bundle) => [bundle.level, bundle])),
      };
    },
  };
};
