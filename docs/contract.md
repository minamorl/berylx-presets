# API contract

All APIs below are exported by `@minamorl/berylx-presets`. The implementation uses
native `Task<Frame>` and `Sequence<Frame>` from the shared Berylx runtime.

## Preset and execution

`Preset<I, O>` is a public type, created by `reshape`, `reshapeMany` or `select`.
`.then(next: Preset<O, N>)` returns `Preset<I, N>`; a next stage accepting a broader
input is also allowed. Incompatible wiring is a type error.

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

Every stage is `name:prepare -> name:rule... -> name:result`. Compile constructs
this structure and initial state without running callbacks. `Graph.from(node)`
and `EffectTree.dryRun(node, initialState)` inspect it. `.run` snapshots input with
native Focus, then calls native Sequence. No separate AST or executor exists.
The original native result remains available alongside successful typed output.

`Root.of(initialState).pipe(node)` accepts the compiled node directly and commits
only on success. Its `Result<Frame>` has an intentionally opaque `current` slot;
`.run` exposes typed O. The [pipeline example](../examples/pipeline.ts) demonstrates
both paths without consumer assertions.

## Batch and diagnostics

```ts
interface Issue {
  readonly rule: string;
  readonly path: readonly (string | number)[];
  readonly code: string;
  readonly message: string;
}
interface Accepted<T> {
  readonly index: number;
  readonly input: unknown;
  readonly value: T;
}
interface Rejected {
  readonly index: number;
  readonly input: unknown;
  readonly issues: readonly Issue[];
}
interface Batch<T> {
  readonly accepted: readonly Accepted<T>[];
  readonly rejected: readonly Rejected[];
}
type SelectionInput<I> = readonly I[] | Batch<I>;
```

Index and input identify the original element before transformation. Selection
preserves both, including after reshape. Input is unknown because original
sources may differ from current typed values. Paths address output fields; row
index is separate. Accepted entries retain source order. Rejections retain
inherited records first, then new rejections in source order.

`invalid(code, message)` returns an `Invalid` value for expected data failure:
single reshape becomes native Err; batch operations reject the element and
continue. Each row records its first failure and skips later rules. Throwing
anything, including an Invalid, fails the entire workflow. Empty input and
all-rejected input yield successful batches with empty accepted arrays.

## Reshape definitions

```ts
reshape<I, O extends object>(definition: ReshapeDefinition<I, O>): Preset<I, O>;
reshapeMany<I, O extends object>(definition: ReshapeDefinition<I, O>): Preset<readonly I[], Batch<O>>;

interface ReshapeDefinition<I, O extends object> {
  readonly name: string;
  readonly fields: Shape<I, O>;
}
interface Validation<T> {
  readonly name: string;
  readonly check: (value: T) => Invalid | void;
}
interface FieldOptions<T> {
  readonly default?: T;
  readonly validate?: readonly Validation<T>[];
}
// field<I,T>(name, read: (input:I) => T | undefined | Invalid, options?): Field<I,T>
```

Shape maps every output key, including optional ones, to `Field<I, O[K]>` or a
nested shape. Missing keys and wrong reader/default types are compiler errors.
There is no implicit coercion. All readers, including nested ones, receive the
original I for that stage. The [paired consumer](../fixtures/presets.ts) contains
a typed nested definition with defaults and validation.

Supported shapes are string/number-keyed records with own enumerable string
keys in the definition. Traversal is depth-first in Object.entries order;
integer-like keys follow JavaScript's numeric ordering. Numeric keys appear as
strings in diagnostic paths. Symbol-keyed shapes and root arrays/functions are
rejected statically. Nested arrays/functions require whole-value `field(...)`
leaves; whole-value fields can also return objects with symbol keys. Ordinary
records and array-valued leaves remain supported. Definitions must not hide
required fields on prototypes or nonenumerable properties.

The mapped public-property view of each assembled output must itself be
assignable to that output type. Private/protected nominal state and constructor
signatures cannot be supplied by public-key assembly, so those root or nested
shapes are rejected statically. A whole-value field may return an actual instance
or constructor with the required type. Ordinary record interfaces, readonly and
optional properties, inference, and string/number index signatures remain
supported. As in ordinary TypeScript, an index signature does not establish that
every possible key exists at runtime; use `noUncheckedIndexedAccess` when reading
unknown keys.

Only undefined triggers a default, detected by presence of `default` in options.
Null, false, zero and empty string remain values. Undefined without a default
becomes `invalid('missing', 'Value is required')`. Intentionally optional output
uses e.g. `field<I, string | undefined>('optional', read, { default: undefined })`.
Defaults are values, not factories. Reader-returned Invalid bypasses defaults.

Each field gets a Task named `preset:field.name`. Each validation gets another
Task named `preset:field.name/validation.name`, immediately after that field.
Validations run on the defaulted/converted value in declaration order. Undefined
means success; Invalid carries a reason. Values are checkpointed before validation
so failure retains the converted value. Empty nested records are assembled during
prepare without user callbacks.

## Selection definitions: two explicit forms

Both overloads return `Preset<SelectionInput<I>, Batch<N>>`, with `N extends I`
and default N = I. Narrowing requires a guard unless I already satisfies N.
Each guard/condition is a separate Task; no callback runs during construction or
compile.

### PredicateSelectDefinition: direct guard and predicate record

```ts
type SelectionPredicate<T> = (value: T) => boolean | Invalid;
interface GuardFailure {
  readonly code: string;
  readonly message: string;
}
// PredicateSelectDefinition<I,N> requires:
// name: string
// guard: (value:I) => value is N    (optional when I extends N)
// guardFailure?: GuardFailure
// rules: Readonly<Record<string, SelectionPredicate<N>>>

const members = select<User, Member>({
  name: 'members',
  guard: (user): user is Member => user.kind === 'member',
  rules: {
    active: (member) => member.active || invalid('inactive', '利用停止中'),
    verified: (member) =>
      member.emailVerified || invalid('unverified', 'メール未確認'),
  },
});
```

The [complete example](../examples/predicates.ts) includes User/Member and inputs.
Record keys name conditions, in own enumerable string-key Object.entries order.
False yields `condition_failed` / `<key> did not match`; Invalid preserves its
code/message. The direct guard's Task/rule name is `guard`; false yields
`guard_failed` / `guard did not match`. Set
`guardFailure: { code: 'not_member', message: '会員ではありません' }` to customize
that reason. A guard must return boolean, not Invalid.

### SelectDefinition: named guard and rule array

```ts
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
// SelectDefinition<I,N> requires name, rules: readonly SelectionRule<N>[],
// and guard: NamedGuard<I,N> (optional when I extends N).

const members = select<User, Member>({
  name: 'members',
  guard: {
    name: 'member',
    test: (user): user is Member => user.kind === 'member',
  },
  rules: [
    {
      name: 'active',
      test: (member) => member.active,
      code: 'inactive',
      message: '利用停止中',
    },
  ],
});
```

The guard uses its name and false yields `guard_failed` / `<guard.name> did not
match`. Condition false uses the rule's code/message; Invalid overrides them.
Use the predicate form for a customized direct-guard reason. The two are separate
public definition types, not a mixed record/array configuration.

Rules may be empty. They run in declaration order, after the guard, against
still-active rows; later conditions never run for excluded rows. Unexpected
nonboolean/non-Invalid values and thenables become TypeError Err. Accepted values
are unchanged, and existing Batch rejections remain intact.

## Partial state and execution order

Every node uses fixed Frame slots `input`, `current`, `work`, `issues`, `location`.
Input is the pipeline's original input; current is its last completed stage
output. Work holds current-stage partial implementation-specific state, typed
unknown. Location contains preset/rule/path and optional original row index.
Frame issues accumulate in task execution order; Batch rejections are presented
in source order, so these orders can differ.

Callbacks run synchronously, rule-major across active rows. The builder locates
the row/path before user code and checkpoints after each row transition. Native
Err retains this Frame, failedNode, trace, cause and `error.metadata.location`.
This retains actual progress rather than simulating row-major application loops.
Readers/predicates should be independent and avoid shared mutable side effects;
[the comparison](comparison.md) states the equivalence scope.

Berylx copies/freezes ordinary objects and arrays; class instances remain by
reference. A getter can throw during the initial snapshot. `Preset.run` returns
native Err with `error.metadata.phase = 'input'`; failedNode/location are null
because no Task ran. A shallow-frozen class-backed failure Frame retains the
original input by reference without retrying its failed snapshot. Calling
compiled nodes or Root directly follows native snapshot semantics. All user
callbacks are synchronous; promise-valued leaves are unsupported.

## Development verification

`npm run check` runs whole-repository Prettier (including md/json/yml), build,
runtime/type tests, full typecheck, reproducible source comparison and isolated
tarball consumer verification. `npm run format` applies the same formatter
everywhere. `npm run compare:write` regenerates measurements after intentional
source changes. `npm run example` runs the predicate example. CI runs check on
Node 18 and 24. Compatibility is tested against the npm Berylx 0.3.1 source;
peer range is ^0.3.1 with no runtime dependencies.
