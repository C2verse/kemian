import packageJson from '../../package.json' with { type: 'json' };
import {
  type BundleStore,
  createKemian,
  type EditingOptions,
  type ExtendHook,
  type Identity,
  type Kemian,
  type SignInProvider,
} from '../core/index.ts';
import type { Level } from '../protocol/index.ts';
import { type FetchHandler, makeOAuthServer, type WorkerContext } from './oauth.ts';

/**
 * Options of a Kemian Worker, built from the Worker's environment.
 */
export interface KemianWorkerOptions<Env> {
  /** Where published bundle sets are kept, e.g. {@link r2BundleStore}. */
  readonly store: BundleStore;
  /** Level of callers without an identity, or `false` to require login. Defaults to `public`. */
  readonly anonymous?: Level | false;
  /** Identities allowed into each level, keyed like `github:12345`. */
  readonly levels?: Readonly<Record<Level, readonly string[]>>;
  /** Bearer token `kemian publish` must send; publishing is disabled without one. */
  readonly publishToken?: string;
  /**
   * Sign-in for callers with a level above the anonymous one, e.g. `githubSignIn(…)`.
   *
   * Requires a KV namespace bound as `OAUTH_KV`.
   */
  readonly signIn?: SignInProvider;
  /** Public origin of the Worker, e.g. `https://kb.example.com`. Defaults to the origin of each request. */
  readonly publicUrl?: string;
  /** Server name reported to MCP clients. Defaults to `kemian`. */
  readonly name?: string;
  /** Adds deployment-specific tools for each request. */
  readonly extend?: ExtendHook;
  /**
   * Lets editors propose changes, e.g. with `proposals: r2ProposalStore(env.BUNDLES)`. Read-only for everyone without
   * it.
   */
  readonly editing?: EditingOptions;
  /** Serves requests that aren't for MCP, sign-in, or publishing. Defaults to 404. */
  readonly fallback?: (
    request: Request,
    env: Env,
    context: WorkerContext,
  ) => Response | Promise<Response>;
}

/**
 * Worker entry point, the default export of a Worker module.
 */
export interface KemianWorker<Env> {
  fetch(request: Request, env: Env, context: WorkerContext): Promise<Response>;
}

const MCP_PATH = '/mcp';
const PUBLISH_PATH = '/publish';
const PROPOSALS_PATHS: ReadonlySet<string> = new Set(['/proposals', '/proposals/acknowledge']);
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers':
    'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'mcp-session-id, www-authenticate',
};

interface WorkerInstance<Env> {
  readonly kemian: Kemian;
  readonly options: KemianWorkerOptions<Env>;
  readonly oauthServers: Map<string, FetchHandler<Env>>;
}

/**
 * Creates a Kemian Worker whose options come from the Worker's environment.
 *
 * Options are built once per environment, so caches survive across requests in a Worker instance. Anonymous
 * requests to `/mcp` skip sign-in; a request with a token, with `?access=<level>`, or to a Worker that requires
 * login goes through the OAuth server, which answers 401 to start sign-in.
 */
export const kemian = <Env extends object>(
  configure: (env: Env) => KemianWorkerOptions<Env>,
): KemianWorker<Env> => {
  const instances = new WeakMap<Env, WorkerInstance<Env>>();
  const instanceFor = (env: Env): WorkerInstance<Env> => {
    const existing = instances.get(env);
    if (existing !== undefined) return existing;
    const options = configure(env);
    const instance = {
      options,
      kemian: createKemian({ ...options, version: packageJson.version }),
      oauthServers: new Map<string, FetchHandler<Env>>(),
    };
    instances.set(env, instance);
    return instance;
  };

  return {
    fetch: async (request, env, context) => {
      const instance = instanceFor(env);
      const { kemian: server, options } = instance;
      const url = new URL(request.url);
      const fallback = async (
        fallbackRequest: Request,
        fallbackEnv: Env,
        fallbackContext: WorkerContext,
      ) =>
        options.fallback === undefined
          ? new Response('Not found', { status: 404 })
          : options.fallback(fallbackRequest, fallbackEnv, fallbackContext);

      if (url.pathname === PUBLISH_PATH) return server.handlePublish(request);
      if (options.editing !== undefined && PROPOSALS_PATHS.has(url.pathname)) {
        return server.handleProposals(request);
      }
      if (url.pathname === MCP_PATH && !isSignInRequested(request, url, options)) {
        return serveMcp(server, request, undefined);
      }
      if (options.signIn === undefined) {
        return url.pathname === MCP_PATH
          ? serveMcp(server, request, undefined)
          : fallback(request, env, context);
      }

      const origin = (options.publicUrl ?? url.origin).replace(/\/+$/u, '');
      const oauthServer =
        instance.oauthServers.get(origin) ??
        makeOAuthServer<Env>({
          origin,
          mcpPath: MCP_PATH,
          kemian: server,
          signIn: options.signIn,
          serveMcp: (mcpRequest, identity) => serveMcp(server, mcpRequest, identity),
          fallback,
        });
      instance.oauthServers.set(origin, oauthServer);
      return oauthServer.fetch(request, env, context);
    },
  };
};

const isSignInRequested = (
  request: Request,
  url: URL,
  options: { readonly anonymous?: Level | false },
): boolean =>
  request.method !== 'OPTIONS' &&
  (request.headers.has('authorization') ||
    url.searchParams.has('access') ||
    options.anonymous === false);

const serveMcp = async (
  server: Kemian,
  request: Request,
  identity: Identity | undefined,
): Promise<Response> => {
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  return withHeaders(await server.handleMcp(request, { identity }), CORS_HEADERS);
};

const withHeaders = (response: Response, headers: Readonly<Record<string, string>>): Response => {
  const copy = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) copy.headers.set(name, value);
  return copy;
};
