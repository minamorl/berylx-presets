# Phase 2 implementation contract

Status: phase 1 shared core is implemented; this document fixes the interfaces
for the two phase 2 owners. No reshape/select runtime stub exists.

## Ownership and integration

| Owner | May write | Imports shared code from |
| --- | --- | --- |
| reshape worker | `src/reshape.ts`, `tests/reshape.test.ts`, `tests/types/reshape.ts` | `definitions.ts`, `types.ts`, `invalid.ts`, `internal/builder.ts` |
| select worker | `src/select.ts`, `tests/select.test.ts`, `tests/types/select.ts` | same shared modules |
| phase 3 root integration | `src/index.ts`, package exports if needed, examples/comparison | both completed modules |

Phase 2 must not modify shared files, manifests, lockfile, core tests, fixtures,
or this contract. Report a real shared-contract defect to the root. Tests import
their own source module directly; index integration waits for both owners.
No worker redispatch, commit, push, publish, or out-of-worktree write.

## Published core (already implemented)

`Preset<I, O>` is a type exported by the package. `preset.then(next)` accepts a
`Preset<O, N>` (including a broader input type) and returns `Preset<I, N>`.
An incompatible connection fails under strict TypeScript without caller casts.

```ts
interface CompiledPreset {
  readonly node: Sequence<Frame>;
  readonly initialState: Frame;
}
type PresetResult<O> =
  | { readonly ok: true; readonly value: O; readonly result: Ok<Frame> }
  | { readonly ok: false; readonly result: Err<Frame> };
// preset.compile(input: I): CompiledPreset
// preset.run(input: I): PresetResult<O>
```

`compile` creates an initial state and a native `Sequence`; no reader, predicate,
validation, prepare, or finish callback runs. `Graph.from(compiled.node)` works,
and `EffectTree.dryRun` lists the same tasks. `run` snapshots input with native
`Focus.of`, then calls native `Sequence.call`
(which invokes Berylx's EffectTree), retaining the original native result.
There is no separate executor or custom AST.

All nodes use the same `Frame` type throughout composition:

```ts
interface Frame {
  readonly input: unknown;             // original input to the entire pipeline
  readonly current: unknown;           // latest completed stage output
  readonly work: unknown;              // current stage's partial working state
  readonly issues: readonly Issue[];   // accumulated recoverable diagnostics
  readonly location: Location | null;
}
interface Location {
  readonly preset: string;
  readonly rule: string;
  readonly path: readonly (string | number)[];
  readonly index?: number;             // original array index
}
```

Only builder boundaries cast the opaque Frame slots to stage I/O/work types.
Phase 2 may use documented internal casts at dynamic definition traversal,
output-object assembly, or the successful type-guard boundary. Keep these
checked boundaries local; application examples must not need assertions.

## Batch, issues, explicit invalid values

```ts
interface Issue {
  readonly rule: string;
  readonly path: readonly (string | number)[];
  readonly code: string;
  readonly message: string;
}
interface Batch<T> {
  readonly accepted: readonly { readonly index: number; readonly input: unknown; readonly value: T }[];
  readonly rejected: readonly { readonly index: number; readonly input: unknown; readonly issues: readonly Issue[] }[];
}
type SelectionInput<I> = readonly I[] | Batch<I>;
```

`input` in each entry is the source before any conversion; never replace it with
the converted value during selection. The source type is intentionally `unknown`
because a pipeline may have heterogeneous original inputs. Paths address output
fields; the original row index is separate. Keep source order among accepted
entries and among newly rejected entries. Keep inherited rejections first,
unchanged, then append new rejections in source order.

`invalid(code, message)` returns an `Invalid` instance. It is a returned value,
not a thrown error. Single-record reshape returns it to the builder to become
native Err. Batch operations collect expected invalid results into rejections
and continue. A callback that throws, even if it throws an Invalid, fails the
entire workflow; do not convert unexpected exceptions into rejected rows.
Empty input and all-rejected input yield successful empty-accepted batches.

## Reshape API (implement in src/reshape.ts)

```ts
export function reshape<I, O extends object>(
  definition: ReshapeDefinition<I, O>,
): Preset<I, O>;
export function reshapeMany<I, O extends object>(
  definition: ReshapeDefinition<I, O>,
): Preset<readonly I[], Batch<O>>;
```

The actual shared types and `field` helper live in `definitions.ts`:

```ts
interface Validation<T> {
  readonly name: string;
  readonly check: (value: T) => Invalid | void;
}
interface FieldOptions<T> {
  readonly default?: T;
  readonly validate?: readonly Validation<T>[];
}
interface Field<I, T> {
  readonly [FIELD]: true;
  readonly name: string;
  readonly read: (input: I) => T | undefined | Invalid;
  readonly options: FieldOptions<T>;
}
// field<I,T>(name, read, options?): Field<I,T>
// Shape<I,O> maps EVERY key K of O to Field<I,O[K]> or a nested Shape.
// Arrays/functions are whole-value fields, never nested shapes.
interface ReshapeDefinition<I, O extends object> {
  readonly name: string;
  readonly fields: Shape<I, O>;
}
```

Use `FIELD` to distinguish a field from a nested shape. Traverse own enumerable
string keys depth-first in definition order. Each leaf has a native Task using
the field's name and output path. Each validation has another native Task named
`field.name/validation.name`, immediately after its field, in array order.
Thus the graph exposes validations as well as conversions. Defaults run within
their corresponding field task. Do not perform the entire transform in prepare.

A reader always receives the original single-record I, including nested fields.
It runs once per still-active row per field. Return Invalid to reject that row
and skip its remaining fields/checks. Use the first expected invalid per row;
continue with other rows. A single invalid stops the single-record workflow.

Default rules are explicit: only `undefined` triggers a default. Test presence
using `Object.hasOwn(field.options, 'default')`; `null`, `0`, `false`, and `''`
are actual values. Without a default, undefined is `invalid('missing', 'Value is required')`.
An output that intentionally includes undefined uses an explicit
`field<I, string | undefined>('optional', read, { default: undefined })`.
Even optional output keys need a rule, so omissions remain compiler errors.
Run validations on the defaulted/converted value, and store the value before
validation so failure partial state includes it. There is no implicit coercion.
Validation success returns undefined; expected failure returns Invalid.

```ts
type Input = { id: string; display?: string; age?: number };
type Output = { id: number; profile: { label: string }; age: number };
const definition: ReshapeDefinition<Input, Output> = {
  name: 'person',
  fields: {
    id: field('parse_id', x => /^\d+$/.test(x.id)
      ? Number(x.id) : invalid('invalid_id', 'id must contain digits')),
    profile: { label: field('display_name', x => x.display?.trim(), { default: 'anonymous' }) },
    age: field('age', x => x.age, { default: 0, validate: [
      { name: 'nonnegative', check: n => n >= 0 ? undefined
        : invalid('negative_age', 'age must be nonnegative') },
    ] }),
  },
};
```

## Select API (implement in src/select.ts)

```ts
export function select<I, N extends I = I>(
  definition: SelectDefinition<I, N>,
): Preset<SelectionInput<I>, Batch<N>>;

interface NamedGuard<I, N extends I> {
  readonly name: string;
  readonly test: (value: I) => value is N;
}
interface SelectionRule<T> {
  readonly name: string;
  readonly test: (value: T) => boolean | Invalid;
  readonly code: string;
  readonly message: string;
}
// SelectDefinition<I,N> requires name and rules.
// Its guard is required when I is not assignable to N; otherwise optional.
```

Rules can be empty. A supplied guard runs first, in its own native Task. Failed
guard issue: `rule = guard.name`, `path = []`, `code = 'guard_failed'`,
`message = guard.name + ' did not match'`. A rule returning false uses its
configured code/message; Invalid overrides code/message. Each condition has a
separate Task. Evaluate in declaration order; never evaluate a later condition
for an excluded element. Rules after the guard receive N without caller casts.
Accepted values remain unchanged. Array input gets original index/input/value
entries in prepare; Batch input preserves its prior provenance and rejections.

```ts
type Animal = { kind: 'cat'; lives: number } | { kind: 'dog'; trained: boolean };
type Cat = Extract<Animal, { kind: 'cat' }>;
const definition: SelectDefinition<Animal, Cat> = {
  name: 'cats',
  guard: { name: 'cat', test: (x): x is Cat => x.kind === 'cat' },
  rules: [{ name: 'alive', test: x => x.lives > 0, code: 'no_lives', message: 'cat has no remaining lives' }],
};
```

## Shared builder (already implemented)

Import `createPreset`, `assertSync`, `Stage`, `StageRule`, `StepContext` from
`./internal/builder.js`. W is a worker-owned immutable working state.

```ts
interface Stage<I, O, W> {
  readonly name: string;
  readonly prepare: (input: I, context: StepContext<W>) => W | Invalid;
  readonly rules: readonly StageRule<W>[];
  readonly finish: (work: W, context: StepContext<W>) => O | Invalid;
}
interface StageRule<W> {
  readonly name: string;
  readonly path?: Path;
  readonly apply: (work: W, context: StepContext<W>) => W | Invalid;
}
interface StepContext<W> {
  locate(position: { readonly path?: Path; readonly index?: number }): void;
  checkpoint(work: W): void;
  issue(issue: Issue): void;
}
```

```ts
const addOne = createPreset<number, string, number>({
  name: 'add_one',
  prepare: input => input,
  rules: [{ name: 'increment', apply: value => value + 1 }],
  finish: value => String(value),
});
// Graph: add_one:prepare -> add_one:increment -> add_one:result
```

Before calling row-specific user code, `context.locate({ index, path })` records
the current position. After each row transition (including expected rejection),
`context.checkpoint(nextWork)` retains partial progress should a later row throw.
For single reshape, checkpoint after every field value is written. Do not mutate
work in place: native Focus deeply freezes plain objects and arrays. An apply
callback must return its final W; checkpoints are for intermediate persistence,
and the returned W replaces work on success. `context.issue(issue)` appends a
batch diagnostic to Frame; the worker also stores it in that row's rejection.
The builder adds the diagnostic automatically for a returned single Invalid.

The builder resets the location at every task, preserves current until finish,
and catches callback exceptions using the latest checkpoint. Err contains
`failedNode`, `trace`, original cause, `error.metadata.location`, and partial
Frame. It rejects a thenable callback result with TypeError. User readers,
validations and conditions must also be synchronous; phase 2 calls the shared
`assertSync(value)` immediately after each user callback, before treating a
thenable as an ordinary value or truthy predicate.
No automatic async execution is introduced.

Berylx's ordinary snapshot semantics apply: plain input objects/arrays are
copied and frozen; class instances remain by reference. Source getters on plain
objects can run during initial Focus normalization. If this throws, `run`
returns native Err with the original cause and `error.metadata.phase = 'input'`;
`failedNode` and Frame.location are null because no rule has run. Only on this
failure path, a shallow-frozen class-backed Frame retains the original input by
reference without retrying its failed snapshot. No work exists yet. Calling the
compiled node directly follows native Berylx snapshot behavior; this protection
belongs to `Preset.run`. The source-exception fixture instead uses a class source
so its failure occurs inside a rule, after earlier progress.

## Commands and evidence

| Command | Purpose |
| --- | --- |
| `npm ci` | Install exact lockfile, one peer Berylx runtime |
| `npm run build` | Emit ESM/declarations to `dist/` |
| `npm run typecheck` | Strict check of src/tests/fixtures/examples |
| `npm run test:core` | Compile runtime tests, execute Node test runner |
| `npm run test:types` | Positive/negative compile fixtures (`@ts-expect-error`) |
| `npm test` | Runtime tests and type fixtures |
| `npm run check` | Build, full typecheck, runtime/type tests (CI command) |

Native core tests cover graph visibility, compile/dryRun without callbacks,
composition, short circuit, retained checkpoint/position/cause, input-snapshot
failure, recoverable
diagnostics, independent runs, and sync-only callback results. Type fixtures
cover invalid wiring, missing/wrong fields, guard requirements, and typed Batch
composition. Handwritten fixtures cover nested conversion, mixed records, union
selection, first-failure reasons, inherited rejections, empty/all-rejected input,
and an unexpected source exception. Their implementation is deliberately plain
application control flow, not another executor. Phase 3 compares full consumer
code including imports, configuration and helper functions; it must still prove
the approved adoption criterion. Graph inspection is an extra capability, not
extra lines artificially added to the handwritten baseline.

Runtime provenance: npm `@minamorl/berylx@0.3.1`, tarball SHA-1
`aed1ea65c31baff5f70072fc615e4e35f6491726`. Read package README plus
`src/task.ts`, `sequence.ts`, `result.ts`, `focus.ts`, `effect-tree/index.ts`,
and `graph.ts`. The local berylx checkout was not used as the API authority.
