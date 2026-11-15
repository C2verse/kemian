import type { R2BucketLike } from './r2-bucket.ts';

export const makeBucket = () => {
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
