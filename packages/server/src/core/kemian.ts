import { createMcpHandler } from '@modelcontextprotocol/server';
import { Effect, Schema } from 'effect';

import {
  type Bundle,
  decodeBundleSet,
  type Level,
  ProposalAcknowledgement,
} from '../protocol/index.ts';
import { type Identity, identityKeyOf, makeAccessPolicy, resolveLevel } from './access.ts';
import { BundleReader } from './bundle-reader.ts';
import { type BundleStore, type BundleStoreError, fromStore } from './bundle-store.ts';
import type { EditingOptions, EditorContext } from './editing.ts';
import { buildMcpServer, type ExtendHook } from './mcp-server.ts';
import { fromProposalStore } from './proposal-store.ts';

/**
 * Options of a Kemian server.
 */
export interface KemianOptions {
  /** Where published bundle sets are kept. */
  readonly store: BundleStore;
  /** Level of callers without an identity, or `false` to require login. Defaults to `public`. */
  readonly anonymous?: Level | false;
  /** Identities allowed into each level, keyed like `github:12345`. */
  readonly levels?: Readonly<Record<Level, readonly string[]>>;
  /** Bearer token `kemian publish` must send; publishing is disabled without one. */
  readonly publishToken?: string;
  /** Server name reported to MCP clients. Defaults to `kemian`. */
  readonly name?: string;
  /** Server version reported to MCP clients. */
  readonly version?: string;
  /** Adds deployment-specific tools for each request. */
  readonly extend?: ExtendHook;
  /** Lets editors propose changes through the editing tools. Read-only for everyone without it. */
  readonly editing?: EditingOptions;
}

/**
 * Kemian server: request handlers for MCP and publishing, independent of the hosting platform.
 */
export interface Kemian {
  /** Serves an MCP request for a caller with the given identity, if any. */
  readonly handleMcp: (
    request: Request,
    context: { readonly identity: Identity | undefined },
  ) => Promise<Response>;
  /** Serves a `kemian publish` request. */
  readonly handlePublish: (request: Request) => Promise<Response>;
  /** Serves a `kemian proposals pull` request: `GET /proposals` lists, `POST /proposals/acknowledge` drops. */
  readonly handleProposals: (request: Request) => Promise<Response>;
  /** Returns the level a caller with the given identity sees, if any. */
  readonly resolveLevel: (identity: Identity | undefined) => Level | undefined;
}

class NothingPublishedError extends Schema.TaggedError<
  NothingPublishedError,
  { readonly brand: unique symbol }
>()('NothingPublishedError', {}) {}

class LevelNotPublishedError extends Schema.TaggedError<
  LevelNotPublishedError,
  { readonly brand: unique symbol }
>()('LevelNotPublishedError', { level: Schema.String }) {}

const MAX_CACHED_READERS = 16;
const DEFAULT_MAX_PROPOSALS_PER_DAY = 50;

/**
 * Creates a Kemian server.
 *
 * @throws {Error} if an identity is listed under more than one level
 */
export const createKemian = (options: KemianOptions): Kemian => {
  const policy = makeAccessPolicy({
    anonymous: options.anonymous === false ? undefined : (options.anonymous ?? 'public'),
    levels: options.levels ?? {},
  });
  const readers = new ReaderCache(options.store);
  const editors = new Set(options.editing?.editors ?? []);
  const editorFor = (identity: Identity | undefined, bundle: Bundle): EditorContext | undefined => {
    const editing = options.editing;
    if (editing === undefined || identity === undefined) return undefined;
    if (bundle.highest !== true || !editors.has(identityKeyOf(identity))) return undefined;
    return {
      identity,
      proposals: editing.proposals,
      maxProposalsPerDay: editing.maxProposalsPerDay ?? DEFAULT_MAX_PROPOSALS_PER_DAY,
    };
  };

  const handleMcp = (request: Request, context: { readonly identity: Identity | undefined }) =>
    Effect.gen(function* () {
      const level = resolveLevel(policy, context.identity);
      if (level === undefined) return jsonError(403, 'This identity has no access level.');
      const reader = yield* readers.get(level);
      const caller = { level, bundle: reader.bundle, identity: context.identity };
      const handler = createMcpHandler(() =>
        buildMcpServer({
          name: options.name ?? 'kemian',
          version: options.version ?? '0.0.0',
          reader,
          caller,
          editor: editorFor(context.identity, reader.bundle),
          extend: options.extend,
        }),
      );
      return yield* Effect.promise(() => handler.fetch(request));
    }).pipe(
      Effect.catchTags({
        NothingPublishedError: () =>
          Effect.succeed(jsonError(503, 'Nothing has been published yet.')),
        LevelNotPublishedError: ({ level }) =>
          Effect.succeed(jsonError(403, `Nothing is published for the ${level} level.`)),
        BundleStoreError: (error) => Effect.succeed(jsonError(500, error.message)),
      }),
      Effect.runPromise,
    );

  const handlePublish = (request: Request) =>
    Effect.gen(function* () {
      if (request.method !== 'PUT' && request.method !== 'POST') {
        return jsonError(405, 'Use PUT to publish.');
      }
      if (options.publishToken === undefined || options.publishToken === '') {
        return jsonError(403, 'Publishing is disabled: no publish token is configured.');
      }
      if (!(yield* Effect.promise(() => isBearer(request, options.publishToken ?? '')))) {
        return jsonError(401, 'Invalid publish token.');
      }
      const body = yield* Effect.tryPromise(() => request.json()).pipe(Effect.option);
      if (body._tag === 'None') return jsonError(400, 'The body must be JSON.');
      const bundleSet = yield* decodeBundleSet(body.value);
      yield* fromStore(() => options.store.replace(bundleSet));
      return Response.json({
        build: bundleSet.build,
        bundles: bundleSet.bundles.map((bundle) => ({
          level: bundle.level,
          files: bundle.files.length,
        })),
      });
    }).pipe(
      Effect.catchTags({
        UnsupportedProtocolError: (error) => Effect.succeed(jsonError(400, error.message)),
        InvalidBundleError: (error) => Effect.succeed(jsonError(400, error.message)),
        BundleStoreError: (error) => Effect.succeed(jsonError(500, error.message)),
      }),
      Effect.runPromise,
    );

  const handleProposals = (request: Request) =>
    Effect.gen(function* () {
      const editing = options.editing;
      const proposalsToken = editing?.proposalsToken ?? '';
      if (editing === undefined || proposalsToken === '') {
        return jsonError(403, 'Reading proposals is disabled: no proposals token is configured.');
      }
      if (!(yield* Effect.promise(() => isBearer(request, proposalsToken)))) {
        return jsonError(401, 'Invalid proposals token.');
      }
      const isAcknowledgement = new URL(request.url).pathname.endsWith('/acknowledge');
      if (!isAcknowledgement) {
        if (request.method !== 'GET') return jsonError(405, 'Use GET to list proposals.');
        const proposals = yield* fromProposalStore(() => editing.proposals.list());
        return Response.json({ protocol: 1, proposals });
      }
      if (request.method !== 'POST') return jsonError(405, 'Use POST to acknowledge proposals.');
      const body = yield* Effect.tryPromise(() => request.json()).pipe(Effect.option);
      if (body._tag === 'None') return jsonError(400, 'The body must be JSON.');
      const acknowledgement = yield* Schema.decodeUnknownEffect(ProposalAcknowledgement)(
        body.value,
      ).pipe(Effect.option);
      if (acknowledgement._tag === 'None') {
        return jsonError(400, 'The body must be { "ids": [...] } with proposal IDs.');
      }
      yield* fromProposalStore(() => editing.proposals.acknowledge(acknowledgement.value.ids));
      return Response.json({ acknowledged: acknowledgement.value.ids.length });
    }).pipe(
      Effect.catchTags({
        ProposalStoreError: (error) => Effect.succeed(jsonError(500, error.message)),
      }),
      Effect.runPromise,
    );

  return {
    handleMcp,
    handlePublish,
    handleProposals,
    resolveLevel: (identity) => resolveLevel(policy, identity),
  };
};

class ReaderCache {
  readonly #readers = new Map<string, BundleReader>();
  readonly #store: BundleStore;

  constructor(store: BundleStore) {
    this.#store = store;
  }

  get(
    level: Level,
  ): Effect.Effect<
    BundleReader,
    NothingPublishedError | LevelNotPublishedError | BundleStoreError
  > {
    const readers = this.#readers;
    const store = this.#store;
    return Effect.gen(function* () {
      const buildId = yield* fromStore(() => store.currentBuildId());
      if (buildId === undefined) return yield* new NothingPublishedError();
      const key = `${buildId}/${level}`;
      const cached = readers.get(key);
      if (cached !== undefined) return cached;

      const bundle = yield* fromStore(() => store.getBundle(buildId, level));
      if (bundle === undefined) return yield* new LevelNotPublishedError({ level });
      const reader = new BundleReader(bundle);
      readers.set(key, reader);
      const oldest = readers.keys().next().value;
      if (readers.size > MAX_CACHED_READERS && oldest !== undefined) readers.delete(oldest);
      return reader;
    });
  }
}

const jsonError = (status: number, message: string): Response =>
  Response.json({ error: message }, { status });

const isBearer = (request: Request, expected: string): Promise<boolean> => {
  const token = /^Bearer (.+)$/u.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
  return isEqualSecret(token, expected);
};

const isEqualSecret = async (given: string, expected: string): Promise<boolean> => {
  const encoder = new TextEncoder();
  const [givenDigest, expectedDigest] = await Promise.all(
    [given, expected].map(
      async (value) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))),
    ),
  );
  let difference = 0;
  for (let index = 0; index < 32; index++) {
    difference |= (givenDigest?.[index] ?? 0) ^ (expectedDigest?.[index] ?? 1);
  }
  return difference === 0;
};
