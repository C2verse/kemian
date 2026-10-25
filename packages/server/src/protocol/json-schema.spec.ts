import { describe, expect, it } from '@effect/vitest';

import { buildBundleJsonSchema, buildBundleSetJsonSchema } from './index.ts';

describe('JSON Schema', () => {
  it.each([
    ['bundle', buildBundleJsonSchema],
    ['bundle-set', buildBundleSetJsonSchema],
  ] as const)('matches the checked-in %s schema', async (name, buildJsonSchema) => {
    await expect(`${JSON.stringify(buildJsonSchema(), null, 2)}\n`).toMatchFileSnapshot(
      `../../schema/${name}.v1.schema.json`,
    );
  });
});
