import packageJson from '../../package.json' with { type: 'json' };
import {
  type BundleStore,
  createKemian,
  type ExtendHook,
  type Identity,
  type Kemian,
} from '../core/index.ts';
import type { Level } from '../protocol/index.ts';

/**
 * Subset of a Worker's execution context that Kemian passes through.
 */
export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

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
  /** Server name reported to MCP clients. Defaults to `kemian`. */
  readonly name?: string;
  /** Adds deployment-specific tools for each request. */
  readonly extend?: ExtendHook;
  /** Serves requests that aren't for MCP or publishing. Defaults to 404. */
  readonly fallback?: (
    request: Request,
    env: Env,
    context: ExecutionContextLike,
  ) => Response | Promise<Response>;
}

/**
 * Worker entry point, the default export of a Worker module.
 */
export interface KemianWorker<Env> {
  fetch(request: Request, env: Env, context: ExecutionContextLike): Promise<Response>;
}

const MCP_PATH = '/mcp';
const PUBLISH_PATH = '/publish';
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers':
    'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'mcp-session-id, www-authenticate',
};

/**
 * Creates a Kemian Worker whose options come from the Worker's environment.
 *
 * Options are built once per environment, so caches survive across requests in a Worker instance.
 */
export const kemian = <Env extends object>(
  configure: (env: Env) => KemianWorkerOptions<Env>,
): KemianWorker<Env> => {
  const instances = new WeakMap<
    Env,
    { readonly kemian: Kemian; readonly options: KemianWorkerOptions<Env> }
  >();
  const instanceFor = (env: Env) => {
    const existing = instances.get(env);
    if (existing !== undefined) return existing;
    const options = configure(env);
    const instance = {
      options,
      kemian: createKemian({ ...options, version: packageJson.version }),
    };
    instances.set(env, instance);
    return instance;
  };

  return {
    fetch: async (request, env, context) => {
      const { kemian: server, options } = instanceFor(env);
      const { pathname } = new URL(request.url);
      if (pathname === MCP_PATH) return serveMcp(server, request, undefined);
      if (pathname === PUBLISH_PATH) return server.handlePublish(request);
      if (options.fallback !== undefined) return options.fallback(request, env, context);
      return new Response('Not found', { status: 404 });
    },
  };
};

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
