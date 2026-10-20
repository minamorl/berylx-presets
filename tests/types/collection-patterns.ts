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
} from '../../src/collection-patterns.js';
import type { PrimitiveKey } from '../../src/collection-patterns.js';
import { invalid } from '../../src/invalid.js';
import type { Batch, SelectionInput } from '../../src/types.js';
import type { Preset } from '../../src/preset.js';

type Row = { readonly id: string; readonly score: number };
const rows: readonly Row[] = [{ id: 'a', score: 2 }];

const grouped = groupBy<Row, string>({ name: 'id', key: (row) => row.id });
const indexed = indexBy<Row, string>({
  name: 'id',
  key: (row) => row.id,
  onCollision: 'reject',
});
const unique = deduplicate<Row, string>({ name: 'id', key: (row) => row.id });
const ordered = orderBy<Row>({
  keys: [{ name: 'score', key: (row) => row.score, direction: 'desc' }],
});
const paged = paginate<Row>({ page: 0, size: 10 });
const partitioned = partition<Row>({
  name: 'passing',
  test: (row) => row.score >= 1,
});
const routed = route<Row>({
  routes: [{ name: 'passing', matches: (row) => row.score >= 1 }],
});
const chunked = chunk<Row>({ size: 2 });
const windowed = window<Row>({ size: 2, step: 1 });

const c: Preset<SelectionInput<Row>, Batch<Row>> = unique;
const d: Preset<SelectionInput<Row>, Batch<Row>> = ordered;
void [c, d];
const groupedResult = grouped.run(rows);
if (groupedResult.ok) {
  const key: string = groupedResult.value.groups[0]!.key;
  void key;
}
const indexedResult = indexed.run(rows);
if (indexedResult.ok) {
  const key: string = indexedResult.value.entries[0]!.key;
  void key;
}
const pagedResult = paged.run(rows);
if (pagedResult.ok) {
  const page: number = pagedResult.value.page;
  void page;
}
const partitionResult = partitioned.run(rows);
if (partitionResult.ok) {
  const count: number = partitionResult.value.yes.length;
  void count;
}
const routedResult = routed.run(rows);
if (routedResult.ok) {
  const count: number = routedResult.value.routes.length;
  void count;
}
const chunkResult = chunked.run(rows);
if (chunkResult.ok) {
  const count: number = chunkResult.value.chunks.length;
  void count;
}
const windowResult = windowed.run(rows);
if (windowResult.ok) {
  const count: number = windowResult.value.uncovered.length;
  void count;
}

const connected = unique.then(partitioned);
const connectedResult = connected.run(rows);
if (connectedResult.ok) {
  const count: number = connectedResult.value.yes.length;
  void count;
}

const invalidKey = groupBy<Row, string>({
  name: 'id',
  key: (row) => (row.id ? row.id : invalid('missing', 'id missing')),
});
void invalidKey;

// @ts-expect-error a number key is incompatible with a string key contract
groupBy<Row, string>({ name: 'wrong', key: (row) => row.score });
// @ts-expect-error object keys are not stable primitive keys
groupBy<Row, { id: string }>({ name: 'wrong', key: (row) => ({ id: row.id }) });
// @ts-expect-error object keys are not stable primitive keys
indexBy<Row, { id: string }>({
  name: 'wrong',
  key: (row) => ({ id: row.id }),
  onCollision: 'first',
});
// @ts-expect-error object keys are not stable primitive keys
deduplicate<Row, { id: string }>({
  name: 'wrong',
  key: (row) => ({ id: row.id }),
});
// @ts-expect-error a predicate must return boolean or Invalid
partition<Row>({ name: 'wrong', test: (row) => row.score });
indexBy<Row, string>({
  name: 'id',
  key: (row) => row.id,
  // @ts-expect-error collision handling must be one of the declared policies
  onCollision: 'merge',
});
const pageThenPartition = paged.then(partitioned);
void pageThenPartition;
// @ts-expect-error GroupResult is not a Batch<Row>
grouped.then(unique);

const primitiveGroup: Preset<
  SelectionInput<PrimitiveKey>,
  {
    readonly groups: readonly { readonly key: PrimitiveKey }[];
    readonly rejected: readonly unknown[];
  }
> = groupBy<PrimitiveKey, PrimitiveKey>({
  name: 'primitive',
  key: (value) => value,
});
void primitiveGroup;
// @ts-expect-error orderBy keys must be number or string
orderBy<Row>({ keys: [{ name: 'wrong', key: () => true }] });

// The complete configuration shown in docs/collection-patterns.md is kept type-checked here.
{
  type DocRow = { id: string; score: number };
  const docRows: DocRow[] = [
    { id: 'a', score: 2 },
    { id: 'b', score: 1 },
    { id: 'a', score: 3 },
  ];
  const docGroups = groupBy<DocRow, string>({
    name: 'by-id',
    key: (row) => row.id,
  });
  const docIndex = indexBy<DocRow, string>({
    name: 'by-id',
    key: (row) => row.id,
    onCollision: 'reject',
  });
  const docUnique = deduplicate<DocRow, string>({
    name: 'by-id',
    key: (row) => row.id,
    keep: 'first',
  });
  const docSorted = orderBy<DocRow>({
    keys: [
      { name: 'score', key: (row) => row.score, direction: 'desc' },
      { name: 'id', key: (row) => row.id },
    ],
  });
  const docPage = paginate<DocRow>({ page: 0, size: 2 });
  const docSplit = partition<DocRow>({
    name: 'passing',
    test: (row) => row.score >= 2,
  });
  const docRouted = route<DocRow>({
    routes: [
      { name: 'passing', matches: (row) => row.score >= 2 },
      { name: 'other', matches: () => true },
    ],
  });
  const docChunks = chunk<DocRow>({ size: 2 });
  const docWindows = window<DocRow>({ size: 2, step: 1 });
  const docResult = docUnique.then(docSplit).run(docRows);
  if (docResult.ok) {
    const indices: number[] = docResult.value.yes.map((source) => source.index);
    const code: string | undefined =
      docResult.value.rejected[0]?.issues[0]?.code;
    void [indices, code];
  }
  const compiled = docRouted.compile(docRows);
  void [
    docGroups,
    docIndex,
    docSorted,
    docPage,
    docChunks,
    docWindows,
    compiled,
  ];
}
