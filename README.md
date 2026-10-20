# @minamorl/berylx-presets

This package provides 30 synchronous preset factories. See the [complete factory catalog](docs/patterns.md) for transform, collection, relation, and workflow APIs with runnable package-import examples.

Transform nested records and select typed array elements with named Berylx tasks.
Presets handle defaults, validation, partial state and rejection reasons; you
supply field readers and predicates.

```ts
import { invalid, select } from '@minamorl/berylx-presets';

type Member = { kind: 'member'; active: boolean; emailVerified: boolean };
type User = Member | { kind: 'guest' };

const users: User[] = [
  { kind: 'member', active: true, emailVerified: true },
  { kind: 'member', active: false, emailVerified: false },
  { kind: 'guest' },
];

const result = select<User, Member>({
  name: 'members',
  guard: (user): user is Member => user.kind === 'member',
  rules: {
    active: (member) => member.active || invalid('inactive', '利用停止中'),
    verified: (member) =>
      member.emailVerified || invalid('unverified', 'メール未確認'),
  },
}).run(users);

if (result.ok) {
  result.value.accepted; // index, original input, typed Member value
  result.value.rejected; // index, original input, issues with rule/path/code/message
} else {
  result.result; // Native Berylx Err with partial Frame and failure position
}
```

Each guard and condition appears in Berylx's graph. Conditions run in declaration
order, stopping at the first failure for each element. A false predicate defaults
to `condition_failed`; `invalid(code, message)` supplies a specific reason. Direct
guards default to `guard_failed` / `guard did not match`, customizable with
`guardFailure: { code, message }`.

## Convert, then select

```ts
import { field, invalid, reshapeMany, select } from '@minamorl/berylx-presets';

type Raw = { id: string; label?: string; active: boolean };
type Person = { id: number; profile: { label: string }; active: boolean };

const pipeline = reshapeMany<Raw, Person>({
  name: 'people',
  fields: {
    id: field('id', (row) =>
      /^\d+$/.test(row.id)
        ? Number(row.id)
        : invalid('invalid_id', 'id must contain digits'),
    ),
    profile: {
      label: field('label', (row) => row.label?.trim(), {
        default: 'anonymous',
      }),
    },
    active: field('active', (row) => row.active),
  },
}).then(
  select<Person>({
    name: 'active_people',
    rules: {
      active: (person) => person.active || invalid('inactive', '利用停止中'),
    },
  }),
);

const result = pipeline.run([{ id: '12', active: true }]);
```

Required fields and field types are checked by TypeScript. Incompatible `.then`
connections fail to typecheck. Both examples work without consumer type assertions.

| API                             | Result                                                           |
| ------------------------------- | ---------------------------------------------------------------- |
| `reshape<I, O>(definition)`     | Single typed record; invalid data becomes Err                    |
| `reshapeMany<I, O>(definition)` | Batch with accepted records and rejected inputs                  |
| `select<I, N>(definition)`      | Selection from an array or Batch, preserving original provenance |

`PredicateSelectDefinition<I, N>` describes the direct guard + predicate-record
form above. `SelectDefinition<I, N>` describes a named guard object plus an array
of `{ name, test, code, message }` rules. Both forms compile to the same native
Berylx Task structure. See [the API contract](docs/contract.md) for both forms,
defaults, validation, supported output shapes and failure semantics.

## Inspect or run through Berylx

```ts
import { EffectTree, Graph, Root } from '@minamorl/berylx';

const { node, initialState } = pipeline.compile([{ id: '12', active: true }]);
Graph.from(node).toMermaid();
EffectTree.dryRun(node, initialState).steps;
const root = Root.of(initialState);
const nativeResult = root.pipe(node);
```

Compile and graph inspection do not call your readers or predicates. `Root`
commits the fixed Frame only on success; `pipeline.run` exposes typed output
alongside the original Berylx result. Processing is synchronous. Empty input and
all-rejected input are successful batches; unexpected callback exceptions fail
the whole workflow.

## Build and try locally

This repository can be built and consumed as a local tarball:

```sh
npm ci
npm run check
npm run example
npm pack --ignore-scripts
```

From another project, install the generated tarball and its shared runtime peer:

```sh
npm install /absolute/path/to/minamorl-berylx-presets-0.1.0.tgz @minamorl/berylx@0.3.1
```

Node.js 18+ and ESM are supported. Berylx is the only runtime peer; the package
adds no runtime dependencies or separate executor. `npm run check` includes
Prettier, runtime/type tests, [the reproducible consumer comparison](docs/comparison.md)
and an isolated installed-tarball consumer check. See the runnable
[predicate](examples/predicates.ts) and [pipeline](examples/pipeline.ts) examples.
