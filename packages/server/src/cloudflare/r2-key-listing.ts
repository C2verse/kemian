import type { R2BucketLike } from './r2-bucket.ts';

/**
 * Returns every key under a prefix, following the listing's pages.
 */
export const listKeys = async (bucket: R2BucketLike, prefix: string): Promise<string[]> => {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list(cursor === undefined ? { prefix } : { prefix, cursor });
    keys.push(...page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return keys;
};
