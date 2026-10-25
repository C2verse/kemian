---
paths:
  - '**/*.{js,mjs,cjs,ts,mts,cts}'
---

## `//` Comments

Avoid `//` comments. Reach for one only when:

- A reasonable future contributor making a normal-looking edit would silently break the code without it.
- There is a load-bearing invariant the type system or schema does not enforce.
- There is external context a reader cannot derive from the repo (an incident, a compliance constraint, a vendor quirk, a design rationale).

`//` comments should:

- Focus on the "why" rather than the "what".
- Scope to the target symbol: do not discuss details about other symbols.
- Self-contain and respect documentation hierarchy: do not link to documentation files like design documents or README.md.

In particular, avoid comments that:

- simply describe a fact that is obvious from adjacent code.
- depict how the symbol is consumed by or interacts with other symbols.
- divide a single file into multiple regions.

## JSDoc

Author JSDoc for all exported functions, classes, interfaces, types, and schemas.

### Functions & Methods

- Start the description with a verb stating what it does — "Builds the bundle for the given level.", "Returns whether the path is excluded." Add detail in later paragraphs separated by a blank line.
- `@param` uses a lowercase short phrase; no leading `-`; do not start with "the"/"a". Omit it entirely when the name and type already make the purpose clear (`level: Level`).
- `@returns` describes the meaning, not the type, as a lowercase short phrase. Omit it when the signature or purpose already conveys it.
- `@throws {ErrorType} if/when <condition>` — only for functions that return a Promise or throw; an Effect's error channel already documents its failures.

### Classes, Interfaces & Schemas

Start with a noun phrase — "Bundle of everything one level may see.", "Error for input that doesn't match the protocol's schema." Do not open with "The", "Represents", "A". For an implementation, "Implementation of {@link Interface} that ..." is fine.

### Length

A description is usually one sentence. Add a second only for what the signature cannot convey — a side effect, an ordering guarantee, or a special-case short-circuit. When in doubt, cut it.

Do not include details that:

- can be inferred from the code (enum values, return types, a parameter clear from its name).
- describe how the value is produced or where it comes from.
- describe how, where, or by whom the symbol is used.
- restate the error type or the signature.
- explain a design decision or rationale — that belongs in the relevant doc.

## Maintenance

- If a comment severely deviates from the current guidelines, rewrite it when the target symbol is updated.
- If a comment is found to be stale during a session, update or rewrite it right away.
