import { describe, expect, it } from '@effect/vitest';

import { bundleSetOf, publicBundle } from '../../test/bundles.ts';
import { type R2BucketLike, r2BundleStore } from './bundle-store.r2.ts';

const makeBucket = () => {
  const objects = new Map<string, string>();
  const bucket: R2BucketLike = {
    get: async (key) => {
      const value = objects.get(key);
      return value === undefined ? null : { text: async () => value };
    },
    put: async (key, value) => {
      objects.set(key, value);
    },
    list: async ({ prefix, cursor }) => {
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).toSorted();
      const start = cursor === undefined ? 0 : Number(cursor);
      const page = keys.slice(start, start + 2);
      const isTruncated = start + 2 < keys.length;
      return {
        objects: page.map((key) => ({ key })),
        truncated: isTruncated,
        ...(isTruncated ? { cursor: String(start + 2) } : {}),
      };
    },
    delete: async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
  };
  return { bucket, objects };
};

describe('r2BundleStore', () => {
  it('starts empty', async () => {
    const store = r2BundleStore(makeBucket().bucket);
    expect(await store.currentBuildId()).toBeUndefined();
  });

  it('stores a bundle set and serves its bundles', async () => {
    const store = r2BundleStore(makeBucket().bucket);
    await store.replace(bundleSetOf('build-1'));
    expect(await store.currentBuildId()).toBe('build-1');
    expect(await store.getBundle('build-1', 'public')).toEqual(publicBundle('build-1'));
    expect(await store.getBundle('build-1', 'team')).toBeUndefined();
  });

  it('keeps the previous build and deletes older ones', async () => {
    const { bucket, objects } = makeBucket();
    const store = r2BundleStore(bucket, { prefix: 'kb/' });
    for (const id of ['build-1', 'build-2', 'build-3']) await store.replace(bundleSetOf(id));
    expect(await store.currentBuildId()).toBe('build-3');
    expect([...objects.keys()].toSorted()).toEqual([
      'kb/builds/build-2/private.json',
      'kb/builds/build-2/public.json',
      'kb/builds/build-3/private.json',
      'kb/builds/build-3/public.json',
      'kb/current.json',
    ]);
  });

  it('escapes build IDs in keys', async () => {
    const { bucket, objects } = makeBucket();
    await r2BundleStore(bucket).replace(bundleSetOf('a/b'));
    expect(objects.has('builds/a%2Fb/public.json')).toBe(true);
  });

  it('rejects a stored bundle that is invalid', async () => {
    const { bucket, objects } = makeBucket();
    const store = r2BundleStore(bucket);
    await store.replace(bundleSetOf('build-1'));
    objects.set('builds/build-1/public.json', '{"protocol":1}');
    await expect(store.getBundle('build-1', 'public')).rejects.toThrow('is invalid');
  });
});
