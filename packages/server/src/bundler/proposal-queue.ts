import { Effect, Schema } from 'effect';

import {
  decodeProposalList,
  type InvalidProposalError,
  type ProposalList,
  type UnsupportedProtocolError,
} from '../protocol/index.ts';

/**
 * Error for a proposal queue that couldn't be reached or refused a request.
 */
export class ProposalQueueError extends Schema.TaggedError<
  ProposalQueueError,
  { readonly brand: unique symbol }
>()('ProposalQueueError', { reason: Schema.String }) {
  override get message(): string {
    return `reading proposals failed: ${this.reason}`;
  }
}

/**
 * Returns the proposals endpoint of a Kemian server, given the server's URL.
 */
export const proposalsEndpointOf = (url: string): string =>
  `${url.replace(/\/+$/u, '').replace(/\/proposals$/u, '')}/proposals`;

/**
 * Fetches the pending proposals from a Kemian server.
 */
export const fetchProposals = (options: {
  readonly url: string;
  readonly token: string;
  readonly fetch?: typeof fetch;
}): Effect.Effect<
  ProposalList,
  ProposalQueueError | UnsupportedProtocolError | InvalidProposalError
> =>
  Effect.gen(function* () {
    const body = yield* requestQueue({ ...options, method: 'GET', path: '' });
    return yield* decodeProposalList(body);
  });

/**
 * Tells a Kemian server that proposals are handled, so it drops them.
 */
export const acknowledgeProposals = (options: {
  readonly url: string;
  readonly token: string;
  readonly ids: readonly string[];
  readonly fetch?: typeof fetch;
}): Effect.Effect<void, ProposalQueueError> =>
  options.ids.length === 0
    ? Effect.void
    : requestQueue({
        ...options,
        method: 'POST',
        path: '/acknowledge',
        body: JSON.stringify({ ids: options.ids }),
      }).pipe(Effect.asVoid);

const requestQueue = (options: {
  readonly url: string;
  readonly token: string;
  readonly method: string;
  readonly path: string;
  readonly body?: string;
  readonly fetch?: typeof fetch;
}): Effect.Effect<unknown, ProposalQueueError> =>
  Effect.gen(function* () {
    const endpoint = `${proposalsEndpointOf(options.url)}${options.path}`;
    const send = options.fetch ?? fetch;
    const response = yield* Effect.tryPromise({
      try: () =>
        send(endpoint, {
          method: options.method,
          headers: {
            authorization: `Bearer ${options.token}`,
            ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(options.body === undefined ? {} : { body: options.body }),
        }),
      catch: (error) =>
        new ProposalQueueError({ reason: `can't reach ${endpoint}: ${String(error)}` }),
    });
    const body: unknown = yield* Effect.tryPromise(() => response.json()).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    if (!response.ok) {
      const message = readErrorMessage(body) ?? response.statusText;
      return yield* new ProposalQueueError({
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
