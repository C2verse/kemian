@README.md

## Changing the Protocol

- **Adding an optional field keeps version 1.** Any other change increments `PROTOCOL_VERSION` and the `protocol` literals, and every module that reads or writes bundles changes with it in the same change.
- **Wire types are plain JSON.** No transformations in these schemas, so the JSON Schema matches the wire exactly; convert inside the code that uses a value.
- **Regexes carry the `u` flag.** Effect exports a `pattern` to JSON Schema only for `u` regexes.
- **Name each reusable schema** with `.annotate({ identifier })`, so the JSON Schema has named `$defs`.
- **Regenerate the checked-in JSON Schema** with `pnpm exec vitest run -u src/protocol` in `packages/server`, only for an intended change, and review the diff; `json-schema.spec.ts` fails on any unintended one.
- Decoders drop unknown fields, so a newer writer's extra fields never reach code that doesn't know them.
- **Proposals follow the same rules.** The server writes them and the CLI reads them, possibly at different versions of Kemian, so a new kind or verdict is a protocol change, not an optional field.
- **`applyTextEdits` defines what an edit means** for both the server, which checks edits against the bundle, and the CLI, which applies them to the source; change it only for both at once.
