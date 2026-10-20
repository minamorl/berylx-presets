# Preset catalog

`@minamorl/berylx-presets` provides 30 synchronous factories. Each factory returns a typed `Preset<I, O>`; call `.run(input)` to execute it or `.compile(input)` to inspect its Berylx graph without evaluating rules. Compatible presets compose with `.then(next)`. Named transformation and selection rules appear as individual graph tasks.

The original structural presets are **`reshape`**, **`reshapeMany`**, and **`select`**. See the [README examples](../README.md) for nested reshaping and typed selection.

## Transform and diagnostics

| Factory          | Purpose                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `mapValue`       | Transform one value; explicit `invalid(code, message)` becomes an error.                                        |
| `mapAccepted`    | Transform accepted rows into a `Batch`, retaining source positions and inherited rejections.                    |
| `expandAccepted` | Expand each accepted row into multiple accepted rows.                                                           |
| `validateValue`  | Apply named checks to a single value.                                                                           |
| `refineValue`    | Narrow a value through a named type guard.                                                                      |
| `auditValue`     | Run named checks and retain diagnostic context.                                                                 |
| `countAccepted`  | Enforce bounds on the number of accepted rows.                                                                  |
| `acceptedValues` | Extract plain values from a selection input. This deliberately discards source positions and rejection records. |
| `issueReport`    | Collect accepted rows, rejected rows, and issue records.                                                        |

See the [transform API and examples](transform-patterns.md). An issue record identifies `index`, `input`, `rule`, `path`, `code`, and `message`; a `Batch` retains accepted source records and rejected diagnostics.

## Collections

| Factory       | Purpose                                                                         |
| ------------- | ------------------------------------------------------------------------------- |
| `groupBy`     | Group by a named key while keeping source records.                              |
| `indexBy`     | Build a unique key index with explicit collision policy and visible collisions. |
| `deduplicate` | Keep first or last per key and report discarded rows.                           |
| `orderBy`     | Stable ordering by named keys.                                                  |
| `paginate`    | Select a zero-based page and retain skipped rows.                               |
| `partition`   | Split accepted rows into yes and no groups.                                     |
| `route`       | Route rows through ordered, first-match predicates.                             |
| `chunk`       | Form fixed-size, nonoverlapping chunks.                                         |
| `window`      | Form full sliding windows and report uncovered rows.                            |

See the [collection API and examples](collection-patterns.md). Collection outputs keep original accepted records where the result type describes entries; they also retain inherited rejections.

`groupBy`, `indexBy`, `deduplicate`, and relational key callbacks accept only `PrimitiveKey` (`string | number | boolean | bigint | symbol | null | undefined`). Object or function keys produce a whole `TypeError` Err. For `orderBy`, mixed numeric and string keys place numbers before strings in ascending order; a `NaN` key rejects its row with `invalid_sort_key`.

## Relations and workflows

| Factory      | Purpose                                                              |
| ------------ | -------------------------------------------------------------------- |
| `fold`       | Fold accepted rows with named steps; a failed step is a whole error. |
| `scan`       | Emit a cumulative value for each accepted source row.                |
| `lookupJoin` | One-to-one left lookup join with invalid duplicate right keys.       |
| `joinMany`   | One-to-many left join, including left rows with no matches.          |
| `zipStrict`  | Zip accepted rows in order; differing lengths are invalid.           |
| `reconcile`  | Classify keyed rows as added, removed, changed, or unchanged.        |
| `choose`     | Run the first matching named branch.                                 |
| `fallback`   | Try the next branch only after an explicit `Invalid`.                |
| `fanout`     | Run every named branch in order.                                     |

See the [relation and workflow API and examples](relation-patterns.md). A sourced join row identifies `source` and an `origin` with the source `index`, original `input`, and accepted `value`; it does not invent an output-row position.

## Batch pipeline

This runnable example is in [examples/patterns.ts](../examples/patterns.ts). `mapAccepted` produces a `Batch<Sale>`, and `orderBy` and `countAccepted` consume it. The callbacks run synchronously when `.run` executes.

```ts
import { countAccepted, mapAccepted, orderBy } from '@minamorl/berylx-presets';

interface Sale {
  readonly id: string;
  readonly cents: number;
}

const salesPipeline = mapAccepted<Sale, Sale>({
  name: 'normalize-sale',
  transform: (sale) => ({ id: sale.id.trim(), cents: sale.cents }),
})
  .then(
    orderBy<Sale>({
      keys: [
        { name: 'largest-first', key: (sale) => sale.cents, direction: 'desc' },
      ],
    }),
  )
  .then(countAccepted<Sale>({ min: 1 }));

const salesResult = salesPipeline.run([
  { id: ' a ', cents: 120 },
  { id: 'b', cents: 450 },
]);
```

## Join and fallback

The same [runnable example](../examples/patterns.ts) also demonstrates source provenance and explicit data failure:

```ts
import { fallback, invalid, lookupJoin } from '@minamorl/berylx-presets';

interface Sale {
  readonly id: string;
  readonly cents: number;
}

const labelJoin = lookupJoin<
  Sale,
  { readonly id: string; readonly label: string },
  string
>({
  leftKey: (sale) => sale.id,
  rightKey: (label) => label.id,
});

const labelResult = labelJoin.run({
  left: [{ id: 'a', cents: 120 }],
  right: [{ id: 'a', label: 'first' }],
});

const cachedLabel = fallback<string, string>([
  { name: 'cache', apply: () => invalid('cache_miss', 'No cached label') },
  { name: 'source', apply: (id) => `label:${id}` },
]);

const fallbackResult = cachedLabel.run('a');
```

Failures have different scopes: an explicit invalid row can appear in a `Batch` rejection, while a failed single-value or whole-operation rule returns a Berylx error. The returned result retains Berylx diagnostics; see the group API docs for each factory's precise output type.
