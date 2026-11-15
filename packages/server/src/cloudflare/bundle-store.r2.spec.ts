import { describe, expect, it } from '@effect/vitest';

import { bundleSetOf, publicBundle } from '../../test/bundles.ts';
import { r2BundleStore } from './bundle-store.r2.ts';
import { makeBucket } from './r2-bucket.spec-helper.ts';

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
