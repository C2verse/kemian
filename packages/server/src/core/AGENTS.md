@README.md

## Working Here

- **No platform APIs.** Only web standards: `Request`, `Response`, `fetch`, `crypto`, `TextEncoder`. Oxlint forbids `node:*` here.
- **A request sees one bundle.** The MCP server for a request gets only the reader for the caller's level, and the extend hook only the `Caller`, never the store.
- **A fresh MCP server per request.** `createMcpHandler` serves each request statelessly; keep no MCP state between requests.
- **Handlers turn every tagged error into a response** with `Effect.catchTags` before `Effect.runPromise`; only defects reject.
- **Deployers implement or pass `BundleStore`, `ProposalStore`, `SignInProvider`, `KemianOptions`, `EditingOptions`, and `ExtensionTool`.** Changing them breaks deployments. `test/proposal-store-contract.ts` holds the tests every `ProposalStore` must pass.
- **Editing fails closed.** The editing tools appear only for an identity on `editors` whose bundle says `highest: true`; anything else, including an older bundle without the field, is read-only.
- **Every proposal is checked against the caller's bundle before it's queued**, with the same limits the protocol's schemas enforce, so the agent learns of a mistake while it can still fix it.
- Changing a tool's text output means updating `kemian.spec.ts` and the demo's end-to-end tests.
