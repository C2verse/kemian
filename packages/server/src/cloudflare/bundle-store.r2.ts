import { Effect, Exit } from 'effect';

import type { BundleStore } from '../core/index.ts';
import { decodeBundle } from '../protocol/index.ts';
import type { R2BucketLike } from './r2-bucket.ts';
import { listKeys } from './r2-key-listing.ts';

/**
 * Creates a {@link BundleStore} on an R2 bucket.
 *
 * Each build's bundles are written under the build's ID before a pointer switches to it, so readers never see a mix
 * of builds. The previous build is kept for readers still on it, and older builds are deleted.
 */
export const r2BundleStore = (
  bucket: R2BucketLike,
  options: { readonly prefix?: string } = {},
): BundleStore => {
  const prefix = options.prefix ?? '';
  const pointerKey = `${prefix}current.json`;
  const buildsPrefix = `${prefix}builds/`;
  const bundleKey = (buildId: string, level: string) =>
    `${buildsPrefix}${encodeURIComponent(buildId)}/${level}.json`;

  const readPointer = async (): Promise<
    { readonly id: string; readonly previous?: string } | undefined
  > => {
    const object = await bucket.get(pointerKey);
    if (object === null) return undefined;
    const pointer: unknown = JSON.parse(await object.text());
    const id = readString(pointer, 'id');
    if (id === undefined) throw new Error(`malformed ${pointerKey}`);
    const previous = readString(pointer, 'previous');
    return previous === undefined ? { id } : { id, previous };
  };

  return {
    currentBuildId: async () => (await readPointer())?.id,
    getBundle: async (buildId, level) => {
      const object = await bucket.get(bundleKey(buildId, level));
      if (object === null) return undefined;
      const exit = await Effect.runPromiseExit(decodeBundle(JSON.parse(await object.text())));
      if (Exit.isFailure(exit)) throw new Error(`stored bundle ${buildId}/${level} is invalid`);
      return exit.value;
    },
    replace: async (bundleSet) => {
      const id = bundleSet.build.id;
      await Promise.all(
        bundleSet.bundles.map((bundle) =>
          bucket.put(bundleKey(id, bundle.level), JSON.stringify(bundle)),
        ),
      );
      const current = await readPointer();
      const previous = current === undefined || current.id === id ? current?.previous : current.id;
      await bucket.put(
        pointerKey,
        JSON.stringify(previous === undefined ? { id } : { id, previous }),
      );

      const kept = new Set(
        [id, previous].filter((value) => value !== undefined).map(encodeURIComponent),
      );
      const stale = (await listKeys(bucket, buildsPrefix)).filter((key) => {
        const buildSegment = key.slice(buildsPrefix.length).split('/')[0] ?? '';
        return !kept.has(buildSegment);
      });
      if (stale.length > 0) await bucket.delete(stale);
    },
  };
};

const readString = (value: unknown, key: string): string | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const property: unknown = Reflect.get(value, key);
  return typeof property === 'string' ? property : undefined;
};
