# @minamorl/berylx-presets

Typed, graphable synchronous data presets over `@minamorl/berylx`.

This phase contains the shared core, definition helpers, and handwritten comparison
fixtures. `reshape`, `reshapeMany`, and `select` are assigned to phase 2 and are
not exported as unfinished functions.

```sh
npm ci
npm run check
```

The runtime is a peer dependency: the application and presets use the same Berylx
classes and interpreter. The development version is pinned to Berylx `0.3.1`.

See [the implementation contract](docs/contract.md) for phase 2 APIs, native task
construction, failure semantics, ownership, and verification commands.

`fixtures/handwritten.ts` is the application-side baseline for phase 3 comparison.
It includes explicit conversion, defaults, ordered checks, provenance, partial
results, and exception handling without a generic workflow framework.
