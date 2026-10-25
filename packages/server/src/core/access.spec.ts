import { describe, expect, it } from '@effect/vitest';

import { makeAccessPolicy, resolveLevel } from './access.ts';

const robin = { provider: 'github', id: '12345' };

describe('resolveLevel', () => {
  const policy = makeAccessPolicy({ anonymous: 'public', levels: { private: ['github:12345'] } });

  it('gives callers without an identity the anonymous level', () => {
    expect(resolveLevel(policy, undefined)).toBe('public');
  });

  it('gives a listed identity its level', () => {
    expect(resolveLevel(policy, robin)).toBe('private');
  });

  it('gives an unlisted identity nothing', () => {
    expect(resolveLevel(policy, { provider: 'github', id: '999' })).toBeUndefined();
  });

  it('distinguishes providers', () => {
    expect(resolveLevel(policy, { provider: 'gitlab', id: '12345' })).toBeUndefined();
  });

  it('gives anonymous callers nothing when login is required', () => {
    expect(
      resolveLevel(makeAccessPolicy({ anonymous: undefined, levels: {} }), undefined),
    ).toBeUndefined();
  });
});

describe('makeAccessPolicy', () => {
  it('rejects an identity listed under two levels', () => {
    expect(() =>
      makeAccessPolicy({
        anonymous: 'public',
        levels: { team: ['github:1'], private: ['github:1'] },
      }),
    ).toThrow('identity github:1 is listed under both team and private');
  });
});
