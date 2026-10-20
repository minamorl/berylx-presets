# Relation and workflow presets

These nine factories are defined in `src/relation-patterns.ts`. This partition does not edit the package's `src/index.ts`; import the module path directly inside this repository until the public registration step exports it. Each factory returns `Preset<I, O>` with `.compile(input)`, `.run(input)`, and typed `.then(next)`.

## Complete configuration example

```ts
import { invalid } from '../src/invalid.js';
import {
  fold,
  scan,
  lookupJoin,
  joinMany,
  zipStrict,
  reconcile,
  choose,
  fallback,
  fanout,
} from '../src/relation-patterns.js';
import type { Batch } from '../src/types.js';

type Item = { id: number; amount: number };
const items: Batch<Item> = {
  accepted: [
    { index: 3, input: { id: 1, amount: 4 }, value: { id: 1, amount: 4 } },
  ],
  rejected: [],
};

const total = fold<Item, number>({
  seed: () => 0,
  steps: [{ name: 'sum', apply: (sum, item) => sum + item.amount }],
});
const cumulative = scan<Item, number>({
  seed: () => 0,
  name: 'sum',
  apply: (sum, item) => sum + item.amount,
});
const byId = lookupJoin<Item, Item, number>({
  leftKey: (item) => item.id,
  rightKey: (item) => item.id,
});
const allMatches = joinMany<Item, Item, number>({
  leftKey: (item) => item.id,
  rightKey: (item) => item.id,
});
const paired = zipStrict<Item, Item>();
const diff = reconcile<Item, Item, number>({
  leftKey: (item) => item.id,
  rightKey: (item) => item.id,
  equal: (a, b) => a.amount === b.amount,
});
const selected = choose<Item, string>([
  {
    name: 'nonzero',
    when: (item) => item.amount > 0,
    apply: (item) => String(item.amount),
  },
]);
const recovered = fallback<Item, string>([
  { name: 'lookup', apply: () => invalid('missing', 'missing') },
  { name: 'render', apply: (item) => String(item.amount) },
]);
const projected = fanout<Item, number>([
  { name: 'id', apply: (item) => item.id },
  { name: 'amount', apply: (item) => item.amount },
]);

const folded = total.run(items);
if (folded.ok)
  console.log(folded.value.value, folded.value.sources, folded.value.rejected);
const joined = byId.run({ left: items, right: [{ id: 1, amount: 5 }] });
if (joined.ok)
  console.log(
    joined.value.accepted,
    joined.value.unmatched,
    joined.value.rejected,
  );
const graphInput = selected.compile({ id: 1, amount: 4 });
console.log(graphInput.node, graphInput.initialState);

void cumulative;
void allMatches;
void paired;
void diff;
void recovered;
void projected;
```

The same imports and configurations are compiled in `tests/types/relation-patterns.ts`; the runtime behavior is exercised in `tests/relation-patterns.test.ts`.

## Outputs and decisions

| Factory      | Input                                  | Successful output and expected failure                                                                                                     |
| ------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `fold`       | array or `Batch<T>`                    | `{ value, sources, rejected }`; `seed` runs once, then each named step traverses accepted rows in order. `Invalid` stops with whole `Err`. |
| `scan`       | array or `Batch<T>`                    | `{ accepted: [{ origin, value }], rejected }`; empty input returns empty history. `Invalid` stops with whole `Err`.                        |
| `lookupJoin` | `{ left, right }`, each array or Batch | `{ accepted, unmatched, rejected }`; one right row per key. Duplicate right key yields whole `Err`.                                        |
| `joinMany`   | same pair input                        | `{ accepted: [{ left, rights }], rejected }`; every accepted left row remains, with zero or more right matches.                            |
| `zipStrict`  | same pair input                        | `{ accepted, rejected }`; accepted rows pair by their accepted order. Length mismatch yields whole `Err`.                                  |
| `reconcile`  | same pair input                        | `{ added, removed, changed, unchanged, rejected }`; keys must be unique on each side; `equal` decides changed versus unchanged.            |
| `choose`     | one input                              | `{ input, branch, value }`; first true `when` wins. No match yields whole `Err`.                                                           |
| `fallback`   | one input                              | `{ input, branch, value, failures }`; only `Invalid` proceeds to the next named branch. All invalid yields whole `Err`.                    |
| `fanout`     | one input                              | `{ input, values }`; branch names are keys; duplicate names yield whole `Err`.                                                             |

For pair operations, `accepted` and comparison rows contain `{ source: 'left' | 'right', origin: { index, input, value } }` objects. Their `rejected` entries contain `{ source, rejection }`. The index is always from that source, never a fabricated aggregate row index. `fold` and `scan` retain accepted origins and inherited `Rejected` records. Plain arrays receive their array positions as origins. Empty and fully rejected inputs succeed with empty accepted outputs where applicable.

## Execution and diagnostics

Construction and `.compile(input)` build named Sequence rules without calling `seed`, key selectors, predicates, reducers, or branch bodies. The graph exposes `seed`, each fold step, both join key rules, `equalLength`, `equal`, `branch.when`, `branch.apply`, fallback names, and fanout names. A named rule may iterate rows; the graph shows that rule, not a node per row. For `choose`, skipped branch predicates and bodies do not run. For `fallback`, later bodies do not run after success.

Every callback is synchronous. A returned thenable becomes a whole `Err`; a thrown exception becomes a whole `Err` and does not trigger fallback. `choose.when` and `reconcile.equal` must return a boolean or `Invalid` even when called from JavaScript; any other value throws `TypeError` and produces a whole `Err`. The result retains its original cause, the named rule and source index as failure location, and a checkpoint of partial work before invoking risky user code. During key extraction, that checkpoint includes keys and source origins accumulated before the next callback. Explicit `invalid(code, message)` is the expected data failure signal. Pair key matching uses JavaScript `Map` key equality; callers should supply stable primitive or canonical object keys. Definition arrays are copied at construction, so later array edits do not add or remove rules.

`choose`, `fallback`, and `fanout` return their original input alongside the derived value. This preserves a Batch input for a later consumer, although callbacks that themselves transform a Batch are responsible for any provenance inside their returned value. The workflow factories expose each named callback as a rule; they do not hide a nested `Preset.run` inside a single task.
