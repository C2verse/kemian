# Cloudflare

Hosts `core` on Cloudflare Workers: the Worker entry point and its routing, a `BundleStore` on R2, and the OAuth authorization server that signs callers in.

## Public Surface

- **`kemian(configure)`** returns the Worker's default export. `configure(env)` returns `KemianWorkerOptions`: the store, the anonymous level, the identities per level, the publish token, an optional `signIn` provider, an optional `publicUrl`, an `extend` hook, and a `fallback` handler. It runs once per Worker environment.
- **`r2BundleStore(bucket, { prefix })`**: a `BundleStore` on an R2 bucket. It writes a build's bundles before switching `current.json` to it, keeps the previous build for readers still on it, and deletes older ones. `R2BucketLike` is the subset of R2 it uses.
- **`makeOAuthServer`**, `OAUTH_PATHS`, `FetchHandler`, and `WorkerContext`: the sign-in wiring `kemian()` uses, exported for Workers that route themselves.

## Routing

| Request                                                         | Goes to                                                    |
| --------------------------------------------------------------- | ---------------------------------------------------------- |
| `/publish`                                                      | `core`'s publish handler, never through OAuth              |
| `/mcp` without a token or `?access=`, when anonymous is allowed | `core` with no identity, so the anonymous level            |
| `/mcp` with a token, with `?access=`, or with login required    | The OAuth server, which answers 401 or passes the identity |
| `/authorize`, `/callback`, `/token`, `/register`, discovery     | The OAuth server, when sign-in is configured               |
| Anything else                                                   | `fallback`, or 404                                         |

`/mcp` answers CORS preflights and allows any origin, since access is decided by bearer tokens, not cookies. Sign-in needs a KV namespace bound as `OAUTH_KV`.

## Files

| File                 | Contents                                                                          |
| -------------------- | --------------------------------------------------------------------------------- |
| `worker.ts`          | `kemian()`: options per environment, routing, CORS                                |
| `oauth.ts`           | `makeOAuthServer`: the OAuth provider, the consent page, and the sign-in handlers |
| `bundle-store.r2.ts` | `r2BundleStore` and `R2BucketLike`                                                |

## Status

**stable.** Tested in local `workerd` through the demo, and deployed on Cloudflare with the demo and the first real deployment.

Known gaps:

- Client ID Metadata Documents are off: they need the `global_fetch_strictly_public` flag, which would block the tests' local fake GitHub.
