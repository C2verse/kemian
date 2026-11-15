# Cloudflare

Hosts `core` on Cloudflare Workers: the Worker entry point and its routing, a `BundleStore` and a `ProposalStore` on R2, and the OAuth authorization server that signs callers in.

## Public Surface

- **`kemian(configure)`** returns the Worker's default export. `configure(env)` returns `KemianWorkerOptions`: the store, the anonymous level, the identities per level, the publish token, an optional `signIn` provider, an optional `publicUrl`, optional `editing`, an `extend` hook, and a `fallback` handler. It runs once per Worker environment.
- **`r2BundleStore(bucket, { prefix })`**: a `BundleStore` on an R2 bucket. It writes a build's bundles before switching `current.json` to it, keeps the previous build for readers still on it, and deletes older ones. `R2BucketLike` is the subset of R2 both stores use.
- **`r2ProposalStore(bucket, { prefix })`**: a `ProposalStore` on an R2 bucket, under `proposals/` by default, so it can share the bundles' bucket. Each pending proposal is `pending/<id>.json`; an empty `added/<day>/<identity>/<id>` records it for the daily limit and retries, and is deleted two days after acknowledging.
- **`makeOAuthServer`**, `OAUTH_PATHS`, `FetchHandler`, and `WorkerContext`: the sign-in wiring `kemian()` uses, exported for Workers that route themselves.

## Routing

| Request                                                         | Goes to                                                    |
| --------------------------------------------------------------- | ---------------------------------------------------------- |
| `/publish`                                                      | `core`'s publish handler, never through OAuth              |
| `/proposals`, `/proposals/acknowledge`, with editing on         | `core`'s proposals handler, never through OAuth            |
| `/mcp` without a token or `?access=`, when anonymous is allowed | `core` with no identity, so the anonymous level            |
| `/mcp` with a token, with `?access=`, or with login required    | The OAuth server, which answers 401 or passes the identity |
| `/authorize`, `/callback`, `/token`, `/register`, discovery     | The OAuth server, when sign-in is configured               |
| Anything else                                                   | `fallback`, or 404                                         |

`/mcp` answers CORS preflights and allows any origin, since access is decided by bearer tokens, not cookies. Sign-in needs a KV namespace bound as `OAUTH_KV`.

## Files

| File                   | Contents                                                                          |
| ---------------------- | --------------------------------------------------------------------------------- |
| `worker.ts`            | `kemian()`: options per environment, routing, CORS                                |
| `oauth.ts`             | `makeOAuthServer`: the OAuth provider, the consent page, and the sign-in handlers |
| `bundle-store.r2.ts`   | `r2BundleStore`                                                                   |
| `proposal-store.r2.ts` | `r2ProposalStore`                                                                 |
| `r2-bucket.ts`         | `R2BucketLike`                                                                    |
| `r2-key-listing.ts`    | Listing every key under a prefix, internal                                        |

## Status

**stable**, except the proposal store and routes, which are **working:** tested against the `ProposalStore` contract and in local `workerd` through the demo, not yet deployed. The rest is tested in local `workerd` through the demo, and deployed on Cloudflare with the demo and the first real deployment.

Known gaps:

- Client ID Metadata Documents are off: they need the `global_fetch_strictly_public` flag, which would block the tests' local fake GitHub.
