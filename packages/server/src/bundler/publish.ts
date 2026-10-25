import { Effect, Schema } from 'effect';

import type { BundleSet } from '../protocol/index.ts';

/**
 * Error for a bundle set the server didn't accept, or a server that couldn't be reached.
 */
export class PublishError extends Schema.TaggedError<
  PublishError,
  { readonly brand: unique symbol }
>()('PublishError', { reason: Schema.String }) {
  override get message(): string {
    return `publishing failed: ${this.reason}`;
  }
}

/**
 * Returns the publish endpoint of a Kemian server, given the server's URL or the endpoint itself.
 */
export const publishEndpointOf = (url: string): string => {
  const trimmed = url.replace(/\/+$/u, '');
  return trimmed.endsWith('/publish') ? trimmed : `${trimmed}/publish`;
};

/**
 * Sends a bundle set to a Kemian server, returning the server's summary of what it stored.
 */
export const sendBundleSet = (options: {
  readonly url: string;
  readonly token: string;
  readonly bundleSet: BundleSet;
  readonly fetch?: typeof fetch;
}): Effect.Effect<unknown, PublishError> =>
  Effect.gen(function* () {
    const endpoint = publishEndpointOf(options.url);
    const send = options.fetch ?? fetch;
    const response = yield* Effect.tryPromise({
      try: () =>
        send(endpoint, {
          method: 'PUT',
          headers: {
            'authorization': `Bearer ${options.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(options.bundleSet),
        }),
      catch: (error) => new PublishError({ reason: `can't reach ${endpoint}: ${String(error)}` }),
    });
    const body: unknown = yield* Effect.tryPromise(() => response.json()).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    if (!response.ok) {
      const message = readErrorMessage(body) ?? response.statusText;
      return yield* new PublishError({
        reason: `${endpoint} answered ${response.status}: ${message}`,
      });
    }
    return body;
  });

const readErrorMessage = (body: unknown): string | undefined => {
  if (typeof body !== 'object' || body === null) return undefined;
  const error: unknown = Reflect.get(body, 'error');
  return typeof error === 'string' ? error : undefined;
};
