@README.md

## Working Here

- **No platform APIs.** Only web standards: `Request`, `Response`, `fetch`, `crypto`, `TextEncoder`. Oxlint forbids `node:*` here.
- **A request sees one bundle.** The MCP server for a request gets only the reader for the caller's level, and the extend hook only the `Caller`, never the store.
- **A fresh MCP server per request.** `createMcpHandler` serves each request statelessly; keep no MCP state between requests.
- **Handlers turn every tagged error into a response** with `Effect.catchTags` before `Effect.runPromise`; only defects reject.
- **Deployers implement or pass `BundleStore`, `SignInProvider`, `KemianOptions`, and `ExtensionTool`.** Changing them breaks deployments.
- Changing a tool's text output means updating `kemian.spec.ts` and the demo's end-to-end tests.
