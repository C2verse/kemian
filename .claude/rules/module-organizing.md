## Principles

- Group modules by domain/concept, not by type. A small module may keep its files flat; introduce a subfolder once a concept grows several files.

  ```
  packages/server/src/protocol/
    ├── bundle.ts
    ├── bundle-set.ts
    └── protocol-version.ts
  ```

- Never create folders that group by type — no `utilities/`, `helpers/`, `utils/`, `services/`.
- Prefer flat over deeply nested. Use `.` in a filename to denote a variant or sub-concept instead of nesting a folder, subject first so related files sort together:

  ```
  packages/server/src/core/
    ├── bundle-store.ts            # BundleStore — interface
    └── bundle-store.memory.ts     # BundleStore — in-memory variant
  ```

- A common kind suffix reads as the final dotted segment: `bundle.spec.ts`, `bundle-fixtures.spec-helper.ts`.

## Visibility

- A file is public only when it is re-exported from its module's `index.ts`; anything not re-exported is internal to the module.
- A module is public only when its `index.ts` is listed in the package's `exports`.
