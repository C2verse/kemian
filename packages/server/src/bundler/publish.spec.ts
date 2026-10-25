import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import { bundleSetOf } from '../../test/bundles.ts';
import { publishEndpointOf, sendBundleSet } from './publish.ts';

describe('publishEndpointOf', () => {
  it.each([
    ['https://kb.example.com', 'https://kb.example.com/publish'],
    ['https://kb.example.com/', 'https://kb.example.com/publish'],
    ['https://kb.example.com/publish', 'https://kb.example.com/publish'],
    ['https://example.com/kb/', 'https://example.com/kb/publish'],
  ])('maps %s to %s', (url, endpoint) => {
    expect(publishEndpointOf(url)).toBe(endpoint);
  });
});

describe('sendBundleSet', () => {
  it.effect('sends the bundle set with the token', () =>
    Effect.gen(function* () {
      const requests: Request[] = [];
      const result = yield* sendBundleSet({
        url: 'https://kb.example.com',
        token: 'secret',
        bundleSet: bundleSetOf(),
        fetch: async (input, init) => {
          requests.push(new Request(input, init));
          return Response.json({ build: { id: 'build-1' } });
        },
      });
      expect(result).toEqual({ build: { id: 'build-1' } });
      expect(requests[0]?.method).toBe('PUT');
      expect(requests[0]?.headers.get('authorization')).toBe('Bearer secret');
    }),
  );

  it.effect("fails with the server's error message", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        sendBundleSet({
          url: 'https://kb.example.com',
          token: 'wrong',
          bundleSet: bundleSetOf(),
          fetch: async () => Response.json({ error: 'Invalid publish token.' }, { status: 401 }),
        }),
      );
      expect(error.message).toBe(
        'publishing failed: https://kb.example.com/publish answered 401: Invalid publish token.',
      );
    }),
  );

  it.effect('fails when the server is unreachable', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        sendBundleSet({
          url: 'https://kb.example.com',
          token: 'secret',
          bundleSet: bundleSetOf(),
          fetch: async () => {
            throw new TypeError('fetch failed');
          },
        }),
      );
      expect(error.message).toContain("can't reach https://kb.example.com/publish");
    }),
  );
});
