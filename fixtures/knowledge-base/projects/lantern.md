---
summary: Lantern, a language server for configuration files.
status: stable
updated: 2026-10-12
---

# Lantern

A language server that gives YAML and TOML configuration files completion, validation, and go-to-definition, driven by JSON Schema.

- 2,400 GitHub stars (GitHub, 2026-10-12).
- Used by <private alt="several companies">Quillwork and two of its customers</private> in production.

## How it works

Lantern maps each configuration file to a schema, then resolves references across files. A config entry looks like this:

```yaml
schemas:
  - match: '**/deploy.yaml'
    schema: ./schemas/deploy.json
```

Lantern treats a literal `<private>` tag in code as text, not markup.

<private reason="not announced">

## Roadmap

Version 2 adds remote schemas and a plugin API. I'm planning to announce it in December.

</private>
