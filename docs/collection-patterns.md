# Collection patterns

These nine synchronous factories are exported from `src/collection-patterns.ts` (and from its built `dist/collection-patterns.js`). The package root is registered in `src/index.ts` separately; this assignment does not change that file. In this repository, a TypeScript consumer can import the source module directly:

```ts
import {
  groupBy,
  indexBy,
  deduplicate,
  orderBy,
  paginate,
  partition,
  route,
  chunk,
  window,
} from '../src/collection-patterns.js';
import { invalid } from '../src/invalid.js';

type Row = { id: string; score: number };
const rows: Row[] = [
  { id: 'a', score: 2 },
  { id: 'b', score: 1 },
  { id: 'a', score: 3 },
];

const groups = groupBy<Row, string>({ name: 'by-id', key: (row) => row.id });
const index = indexBy<Row, string>({
  name: 'by-id',
  key: (row) => row.id,
  onCollision: 'reject',
});
const unique = deduplicate<Row, string>({
  name: 'by-id',
  key: (row) => row.id,
  keep: 'first',
});
const sorted = orderBy<Row>({
  keys: [
    { name: 'score', key: (row) => row.score, direction: 'desc' },
    { name: 'id', key: (row) => row.id },
  ],
});
const page = paginate<Row>({ page: 0, size: 2 });
const split = partition<Row>({
  name: 'passing',
  test: (row) => row.score >= 2,
});
const routed = route<Row>({
  routes: [
    { name: 'passing', matches: (row) => row.score >= 2 },
    { name: 'other', matches: () => true },
  ],
});
const chunks = chunk<Row>({ size: 2 });
const windows = window<Row>({ size: 2, step: 1 });

const result = unique.then(split).run(rows);
if (result.ok) {
  // yes/no are source records: each has index, input and value.
  console.log(result.value.yes.map((source) => source.index)); // [0]
  console.log(result.value.rejected[0]?.issues[0]?.code); // duplicate_key
} else {
  console.error(result.result.error);
}

const compiled = routed.compile(rows);
// The graph has route:prepare, route:passing, route:other, route:result.
void [groups, index, sorted, page, chunks, windows, compiled, invalid];
```

## API and output contracts

Every factory returns a genuine `Preset<I, O>` with `.compile(input)`, `.run(input)`, and `.then(next)`. Its input is a `readonly T[]` or `Batch<T>`. Every output carrying rows uses `Accepted<T>` records. For an array, `index` is its zero-based position and `input` is the original value. For a Batch, `index` and `input` remain those of the incoming accepted record. All incoming `rejected` records pass through to output. An empty input succeeds with empty collections. Aggregate outputs do not invent a row index.

| Factory            | Configuration                                                                | Successful output                                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `groupBy<T,K>`     | Named `key(value, source)`                                                   | `{ groups: { key, entries: Accepted<T>[] }[], rejected }`; group and row order follow first appearance.                                                                                                      |
| `indexBy<T,K>`     | Named `key`, required `onCollision: 'first' \| 'last' \| 'reject'`           | `{ entries: { key, entry }[], collisions: { key, previous, incoming }[], rejected }`; first key position sets index order. `reject` keeps the first and adds a `duplicate_key` rejection for each later row. |
| `deduplicate<T,K>` | Named `key`, `keep: 'first' \| 'last'` (default first)                       | `Batch<T>`; discarded rows get `duplicate_key` issues. Retained rows remain in source order.                                                                                                                 |
| `orderBy<T>`       | Nonempty `keys: { name, key, direction? }[]`; key result is string or number | `Batch<T>` sorted lexicographically and stably; each named key is a graph rule. `direction` defaults to ascending.                                                                                           |
| `paginate<T>`      | Zero-based nonnegative safe integer `page`, positive safe integer `size`     | `{ page, size, accepted, skipped, rejected }`; `skipped` includes every valid row outside the page, even when the requested page is empty.                                                                   |
| `partition<T>`     | Named `test(value, source)`                                                  | `{ yes, no, rejected }`; both sides retain source records.                                                                                                                                                   |
| `route<T>`         | Nonempty ordered `routes: { name, matches }[]`                               | `{ routes: { name, entries }[], unmatched, rejected }`; a matched row never reaches later rules.                                                                                                             |
| `chunk<T>`         | Positive safe integer `size`                                                 | `{ chunks: Accepted<T>[][], rejected }`; the last chunk may be short.                                                                                                                                        |
| `window<T>`        | Positive safe integer `size`; positive `step` (default 1)                    | `{ windows: Accepted<T>[][], uncovered, rejected }`; only full windows appear, overlap is allowed, and `uncovered` retains gaps and trailing rows.                                                           |

`groupBy`, `indexBy`, and `deduplicate` use JavaScript `Map` key equality (SameValueZero). `orderBy` compares string and number keys with JavaScript `<` and `>`; callers should return `invalid(code, message)` for values that should not participate in that ordering. Definition arrays and their entry objects are snapshotted at factory construction. Multi-rule key and route names must be nonempty and distinct so every rule has a distinct graph name.

## Diagnostics and execution boundary

A key or predicate may return `invalid(code, message)` for an expected row defect. That row moves to `rejected` with its original `index` and `input`, and an issue containing the named rule, a path, code and message. `partition` and `route` accept only actual booleans or `Invalid`; a JavaScript callback that returns any other value causes a whole Err with a `TypeError` cause. An unexpected throw or a Promise/thenable return also makes the entire `.run` an Err. The Berylx error retains the thrown cause and a checkpoint immediately before the callback; `Frame.location` records preset, rule, path and source index. Construction and `.compile` build named `prepare → rule(s) → result` tasks without running callbacks. Fixed sizes and empty rule lists are checked at construction.

No factory starts an asynchronous executor, reads ambient state, logs, stores a timestamp or ID, or adds a runtime dependency. These functions own collection arrangement only; the caller supplies keys and predicates. `paginate`, `chunk`, and `window` have no user callbacks, so their rules cannot produce a row defect themselves, but inherited Batch rejections remain present.
