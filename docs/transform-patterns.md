# Transform patterns

These nine factories live in `src/transform-patterns.ts`. This partition does not edit `src/index.ts`, so package-root registration is a separate integration step. Every factory returns `Preset<I, O>` with `.compile(input)`, `.run(input)`, and typed `.then(next)`.

## Single value

```ts
import { invalid } from '../src/invalid.js';
import {
  mapValue,
  validateValue,
  auditValue,
  refineValue,
} from '../src/transform-patterns.js';

const positive = validateValue<number>([
  { name: 'positive', path: ['amount'], check: (n) => n > 0 },
]);
const doubled = mapValue<number, number>({
  name: 'double',
  transform: (n) => n * 2,
});
const pipeline = positive.then(doubled);
const output = pipeline.run(4); // { ok: true, value: 8, result: Berylx Ok }

const audited = auditValue<number>([
  { name: 'finite', check: (n) => Number.isFinite(n) },
  {
    name: 'small',
    check: (n) => n < 100 || invalid('large', 'must be below 100'),
  },
]);

type Animal = { kind: 'cat'; lives: number } | { kind: 'dog'; bark: string };
type Cat = Extract<Animal, { kind: 'cat' }>;
const cats = refineValue<Animal, Cat>({
  name: 'cat',
  guard: (animal): animal is Cat => animal.kind === 'cat',
});
const lives = cats.then(
  mapValue<Cat, number>({ name: 'lives', transform: (cat) => cat.lives }),
);
```

`mapValue` transforms one value. `validateValue` stops at the first failed named check. `refineValue` narrows a union through a type guard. `auditValue` runs every check in declaration order, records all failed rules, then returns a whole `Err` if any failed. A check can return `false` or `invalid(code, message)`; the latter preserves the supplied reason. `validateValue`, `refineValue`, and `auditValue` preserve the input on success. An empty validation or audit rule list produces `empty_rules` on run.

## Batch conversion and terminal results

```ts
import { invalid } from '../src/invalid.js';
import {
  mapAccepted,
  expandAccepted,
  countAccepted,
  acceptedValues,
  issueReport,
} from '../src/transform-patterns.js';

const parsed = mapAccepted<string, number>({
  name: 'parse',
  path: ['number'],
  transform: (s) => {
    const n = Number(s);
    return Number.isFinite(n) ? n : invalid('nan', 'not numeric');
  },
});
const duplicated = expandAccepted<number, number>({
  name: 'duplicate',
  transform: (n) => [n, n],
});
const bounded = countAccepted<number>({ min: 1, max: 4 });
const pipeline = parsed.then(duplicated).then(bounded);
const output = pipeline.run(['2', 'bad']);
// ok value: accepted [{ index: 0, input: '2', value: 2 },
//                     { index: 0, input: '2', value: 2 }]
//           rejected [{ index: 1, input: 'bad', issues: [{ rule: 'parse',
//                       path: ['number'], code: 'nan', message: 'not numeric' }] }]

if (output.ok) {
  const report = issueReport<number>().run(output.value);
  const values = acceptedValues<number>().run(output.value);
  // report.ok: report.value includes accepted, rejected and flat source-aware issues
  // values.ok: values.value is [2, 2]
  void report;
  void values;
}
```

`mapAccepted` changes one accepted value into one value or a rejection. `expandAccepted` changes one accepted value into zero or more values or a rejection. Each expanded output retains the original `index` and `input`; duplicate indices are intentional source provenance. Both accept an array or a `Batch<T>`, retain inherited rejections, and return a successful empty batch for empty input or all rejected input. `countAccepted` checks accepted row count against optional inclusive `min` and `max`, returning a whole `Err` when out of bounds. Provide at least one bound. Bounds must be nonnegative safe integers with `min <= max`; missing or malformed bounds produce `invalid_bounds`. It preserves accepted and rejected records when successful. `acceptedValues` deliberately discards provenance and rejection diagnostics; call it only at the terminal boundary. `issueReport` retains both partitions and flattens rejected issues into records carrying the original index and input.

## Diagnostics and execution boundary

Each named rule appears as its own Sequence task between `prepare` and `result` in `.compile(input).node`. Construction and compilation do not call user functions. Rule arrays and rule paths are copied when a preset is constructed. `.run(input)` returns the Berylx result alongside the typed value on success. A single value `invalid(code, message)` becomes an `Err`; a Batch row `invalid` becomes a `Rejected` record. Validation and audit checks accept only booleans or `Invalid`; refinement guards accept only booleans. A different runtime return value, a thrown exception, or a thenable fails the whole run. Unexpected predicate return values cause a `TypeError`. The Berylx `Err` retains its original cause, current checkpoint, named rule, path, and source index where applicable. Batch transforms checkpoint before each user callback.

All callbacks are synchronous. No retry or async executor is introduced. A Batch's `index` always names the source row; aggregated `IssueReport` does not invent an output row index. The original input is retained in every accepted or rejected row. Array and Batch definition containers are snapshotted at run preparation; nested user values remain caller owned.

## API list

| Factory          | Input → output                       | Distinct responsibility             |
| ---------------- | ------------------------------------ | ----------------------------------- |
| `mapValue`       | `I → O`                              | Whole value conversion              |
| `mapAccepted`    | `SelectionInput<I> → Batch<O>`       | One to one accepted row conversion  |
| `expandAccepted` | `SelectionInput<I> → Batch<O>`       | Zero to many accepted row expansion |
| `validateValue`  | `T → T`                              | Ordered first failure validation    |
| `refineValue`    | `T → U extends T`                    | Type guard refinement               |
| `auditValue`     | `T → T`                              | Accumulated named diagnostics       |
| `countAccepted`  | `SelectionInput<T> → Batch<T>`       | Accepted count bounds               |
| `acceptedValues` | `SelectionInput<T> → readonly T[]`   | Explicit terminal value extraction  |
| `issueReport`    | `SelectionInput<T> → IssueReport<T>` | Source-aware diagnostic report      |

## Integration overlap

Use `mapAccepted` when each accepted source produces one value; use `expandAccepted` when it produces an array of values. `expandAccepted` accepts real arrays, including `[]`, and treats `Invalid` as a rejected source row. A runtime string, `Set`, other iterable, or nonarray value from its callback causes a whole `Err` with a `TypeError` cause. The checkpoint keeps previously expanded rows and inherited rejections, while the location identifies the failing source index and named rule. Thenables also cause a whole `Err` before array validation. Package-root registration in `src/index.ts` remains outside this module's assigned files.
