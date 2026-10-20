import test from 'node:test';
import assert from 'node:assert/strict';
import { invalid } from '../src/invalid.js';
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
import type { Batch, Rejected } from '../src/types.js';

const inherited: Rejected = {
  index: 7,
  input: 'bad',
  issues: [{ rule: 'source', path: ['id'], code: 'bad', message: 'bad input' }],
};
const batch: Batch<number> = {
  accepted: [
    { index: 3, input: 'three', value: 3 },
    { index: 9, input: 'one', value: 1 },
    { index: 12, input: 'two', value: 2 },
  ],
  rejected: [inherited],
};

function success<T>(result: { ok: true; value: T } | { ok: false }): T {
  assert.equal(result.ok, true);
  return (result as { value: T }).value;
}

function names(preset: {
  compile(input: Batch<number>): { node: unknown };
}): string[] {
  const node = preset.compile(batch).node as {
    steps: readonly { name: string }[];
  };
  return node.steps.map((step) => step.name);
}

test('groupBy groups stably, rejects invalid keys, and preserves Batch provenance', () => {
  const preset = groupBy<number, number>({
    name: 'parity',
    key: (n) => (n === 1 ? invalid('no_one', 'one excluded') : n % 2),
  });
  assert.deepEqual(names(preset), [
    'groupBy:prepare',
    'groupBy:parity',
    'groupBy:result',
  ]);
  const output = success(preset.run(batch));
  assert.deepEqual(
    output.groups.map((g) => [g.key, g.entries.map((e) => e.index)]),
    [
      [1, [3]],
      [0, [12]],
    ],
  );
  assert.equal(output.groups[0]?.entries[0]?.input, 'three');
  assert.deepEqual(output.rejected[0], inherited);
  assert.deepEqual(output.rejected[1]?.issues[0], {
    rule: 'parity',
    path: ['key'],
    code: 'no_one',
    message: 'one excluded',
  });
  assert.deepEqual(success(preset.run([])).groups, []);
});

test('indexBy exposes collisions and policy, with genuine source records', () => {
  const first = indexBy<number, number>({
    name: 'bucket',
    key: (n) => n % 2,
    onCollision: 'first',
  });
  const last = indexBy<number, number>({
    name: 'bucket',
    key: (n) => n % 2,
    onCollision: 'last',
  });
  const reject = indexBy<number, number>({
    name: 'bucket',
    key: (n) => n % 2,
    onCollision: 'reject',
  });
  assert.deepEqual(
    success(first.run(batch)).entries.map((e) => e.entry.index),
    [3, 12],
  );
  assert.deepEqual(
    success(last.run(batch)).entries.map((e) => e.entry.index),
    [9, 12],
  );
  const output = success(reject.run(batch));
  assert.equal(output.collisions[0]?.previous.index, 3);
  assert.equal(output.collisions[0]?.incoming.index, 9);
  assert.deepEqual(output.rejected[0], inherited);
  assert.equal(output.rejected[1]?.index, 9);
  assert.deepEqual(success(first.run([])).entries, []);
  assert.ok(names(first).includes('indexBy:bucket'));
});

test('deduplicate reports discarded rows and composes through then', () => {
  const first = deduplicate<number, number>({
    name: 'same-parity',
    key: (n) => n % 2,
  });
  const last = deduplicate<number, number>({
    name: 'same-parity',
    key: (n) => n % 2,
    keep: 'last',
  });
  assert.deepEqual(
    success(first.run(batch)).accepted.map((e) => e.index),
    [3, 12],
  );
  const output = success(last.run(batch));
  assert.deepEqual(
    output.accepted.map((e) => e.index),
    [9, 12],
  );
  assert.deepEqual(output.rejected[0], inherited);
  assert.equal(output.rejected[1]?.index, 3);
  const composed = first.then(
    partition<number>({ name: 'even', test: (n) => n % 2 === 0 }),
  );
  const composedOutput = success(composed.run([1, 3, 2]));
  assert.deepEqual(
    composedOutput.yes.map((e) => e.index),
    [2],
  );
  assert.deepEqual(success(first.run([])).accepted, []);
});

test('orderBy uses named stable multi-key order and snapshots definitions', () => {
  const keys = [
    {
      name: 'tens',
      key: (n: number) => Math.floor(n / 10),
      direction: 'asc' as const,
    },
    { name: 'units', key: (n: number) => n % 10, direction: 'desc' as const },
  ];
  const preset = orderBy<number>({ keys });
  keys.pop();
  assert.deepEqual(names(preset), [
    'orderBy:prepare',
    'orderBy:tens',
    'orderBy:units',
    'orderBy:result',
  ]);
  assert.deepEqual(
    success(preset.run([11, 23, 12, 22, 12])).accepted.map((e) => e.value),
    [12, 12, 11, 23, 22],
  );
  assert.deepEqual(success(preset.run([])).accepted, []);
  const output = success(preset.run(batch));
  assert.deepEqual(output.rejected[0], inherited);
  assert.deepEqual(
    output.accepted.map((e) => e.index),
    [3, 12, 9],
  );
});

test('paginate retains skipped rows; chunk and window preserve full provenance', () => {
  const page = paginate<number>({ page: 1, size: 2 });
  const pageOutput = success(page.run(batch));
  assert.deepEqual(
    pageOutput.accepted.map((e) => e.index),
    [12],
  );
  assert.deepEqual(
    pageOutput.skipped.map((e) => e.index),
    [3, 9],
  );
  assert.deepEqual(pageOutput.rejected[0], inherited);
  assert.deepEqual(success(page.run([])).accepted, []);
  assert.ok(names(page).includes('paginate:select-page'));

  const chunks = chunk<number>({ size: 2 });
  assert.deepEqual(
    success(chunks.run(batch)).chunks.map((c) => c.map((e) => e.index)),
    [[3, 9], [12]],
  );
  assert.deepEqual(success(chunks.run(batch)).rejected[0], inherited);
  assert.deepEqual(success(chunks.run([])).chunks, []);
  assert.ok(names(chunks).includes('chunk:make-chunks'));

  const windows = window<number>({ size: 2, step: 3 });
  const output = success(windows.run(batch));
  assert.deepEqual(
    output.windows.map((w) => w.map((e) => e.index)),
    [[3, 9]],
  );
  assert.deepEqual(
    output.uncovered.map((e) => e.index),
    [12],
  );
  assert.deepEqual(output.rejected[0], inherited);
  assert.deepEqual(success(windows.run([])).windows, []);
  assert.ok(names(windows).includes('window:make-windows'));
  const shared = { index: 4, input: 'shared', value: 4 };
  const repeated: Batch<number> = {
    accepted: [shared, shared, shared],
    rejected: [],
  };
  assert.equal(success(windows.run(repeated)).uncovered.length, 1);
});

test('partition has two honest sides and route stops at the first match', () => {
  const partitioned = partition<number>({
    name: 'positive',
    test: (n) => (n === 1 ? invalid('excluded', 'one') : n > 0),
  });
  const output = success(partitioned.run(batch));
  assert.deepEqual(
    output.yes.map((e) => e.index),
    [3, 12],
  );
  assert.deepEqual(output.no, []);
  assert.deepEqual(output.rejected[0], inherited);
  assert.equal(output.rejected[1]?.index, 9);
  assert.deepEqual(success(partitioned.run([])).yes, []);
  assert.ok(names(partitioned).includes('partition:positive'));

  let laterCalls = 0;
  const routes = [
    { name: 'odd', matches: (n: number) => n % 2 === 1 },
    {
      name: 'other',
      matches: (_n: number) => {
        laterCalls++;
        return true;
      },
    },
  ];
  const routed = route<number>({ routes });
  routes.pop();
  assert.deepEqual(names(routed), [
    'route:prepare',
    'route:odd',
    'route:other',
    'route:result',
  ]);
  const routedOutput = success(routed.run(batch));
  assert.deepEqual(
    routedOutput.routes.map((r) => r.entries.map((e) => e.index)),
    [[3, 9], [12]],
  );
  assert.equal(laterCalls, 1);
  assert.deepEqual(routedOutput.unmatched, []);
  assert.deepEqual(routedOutput.rejected[0], inherited);
  assert.deepEqual(
    success(routed.run([])).routes.map((r) => r.entries),
    [[], []],
  );
});

test('callback defects are row rejections; throws and thenables are whole Err with checkpoint', () => {
  const callbacks = [
    (fn: (n: number) => any) =>
      groupBy<number, number>({ name: 'risk', key: fn }),
    (fn: (n: number) => any) =>
      indexBy<number, number>({ name: 'risk', key: fn, onCollision: 'first' }),
    (fn: (n: number) => any) =>
      deduplicate<number, number>({ name: 'risk', key: fn }),
    (fn: (n: number) => any) =>
      orderBy<number>({ keys: [{ name: 'risk', key: fn }] }),
    (fn: (n: number) => any) => partition<number>({ name: 'risk', test: fn }),
    (fn: (n: number) => any) =>
      route<number>({ routes: [{ name: 'risk', matches: fn }] }),
  ];
  for (const make of callbacks) {
    let called = 0;
    const lazy = make(() => {
      called++;
      return 1;
    });
    lazy.compile([1]);
    assert.equal(called, 0);
    const defect = make(() => invalid('invalid_data', 'bad row'));
    const defectResult = defect.run([1]);
    assert.equal(defectResult.ok, true);
    if (defectResult.ok) {
      assert.equal(defectResult.value.rejected[0]?.index, 0);
      assert.equal(
        defectResult.value.rejected[0]?.issues[0]?.code,
        'invalid_data',
      );
    }
    const thrown = new Error('sentinel');
    const failed = make(() => {
      throw thrown;
    }).run([1]);
    assert.equal(failed.ok, false);
    if (!failed.ok) {
      const error = failed.result.error as Error & { cause?: unknown };
      assert.equal(error.cause, thrown);
      const frame = failed.result.focus.value;
      assert.equal(frame.location?.rule, 'risk');
      assert.equal(frame.location?.index, 0);
      assert.ok(frame.work);
    }
    const asyncResult = make(() => Promise.resolve(1)).run([1]);
    assert.equal(asyncResult.ok, false);
    if (!asyncResult.ok)
      assert.equal(asyncResult.result.focus.value.location?.rule, 'risk');
  }
});

test('a later callback failure retains progress in the pre-callback checkpoint', () => {
  const thrown = new Error('second row');
  const preset = groupBy<number, number>({
    name: 'key',
    key: (n) => {
      if (n === 2) throw thrown;
      return n;
    },
  });
  const result = preset.run([1, 2]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(
      (result.result.error as Error & { cause?: unknown }).cause,
      thrown,
    );
    assert.equal(result.result.focus.value.location?.index, 1);
    const work = result.result.focus.value.work as {
      keyed: readonly unknown[];
    };
    assert.equal(work.keyed.length, 1);
  }
});

test('escaped nonboolean predicate results are whole Err with their rule checkpoint', () => {
  const partitioned = partition<number>({
    name: 'is-positive',
    test: (n) => (n === 2 ? ({ truthy: true } as unknown as boolean) : false),
  });
  const partitionFailure = partitioned.run([0, 2]);
  assert.equal(partitionFailure.ok, false);
  if (!partitionFailure.ok) {
    assert.ok(
      (partitionFailure.result.error as Error & { cause?: unknown })
        .cause instanceof TypeError,
    );
    assert.deepEqual(partitionFailure.result.focus.value.location, {
      preset: 'partition',
      rule: 'is-positive',
      path: ['test'],
      index: 1,
    });
    const work = partitionFailure.result.focus.value.work as {
      no: readonly unknown[];
    };
    assert.equal(work.no.length, 1);
  }

  const routed = route<number>({
    routes: [
      {
        name: 'first',
        matches: (n) => (n === 2 ? ('yes' as unknown as boolean) : false),
      },
    ],
  });
  const routeFailure = routed.run([0, 2]);
  assert.equal(routeFailure.ok, false);
  if (!routeFailure.ok) {
    assert.ok(
      (routeFailure.result.error as Error & { cause?: unknown })
        .cause instanceof TypeError,
    );
    assert.deepEqual(routeFailure.result.focus.value.location, {
      preset: 'route',
      rule: 'first',
      path: ['routes', 'first'],
      index: 1,
    });
    const work = routeFailure.result.focus.value.work as {
      remaining: readonly unknown[];
    };
    assert.equal(work.remaining.length, 2);
  }

  const normalPartition = partition<number>({
    name: 'positive',
    test: (n) => (n === 1 ? invalid('bad', 'excluded') : false),
  });
  const partitionOutput = success(normalPartition.run([0, 1]));
  assert.deepEqual(
    partitionOutput.no.map((entry) => entry.index),
    [0],
  );
  assert.equal(partitionOutput.rejected[0]?.issues[0]?.code, 'bad');

  const normalRoute = route<number>({
    routes: [
      {
        name: 'first',
        matches: (n) => (n === 1 ? invalid('bad', 'excluded') : false),
      },
      { name: 'second', matches: () => true },
    ],
  });
  const routeOutput = success(normalRoute.run([0, 1]));
  assert.deepEqual(
    routeOutput.routes.map((item) => item.entries.map((entry) => entry.index)),
    [[], [0]],
  );
  assert.equal(routeOutput.rejected[0]?.issues[0]?.code, 'bad');
});

test('documented composition example returns the stated indices and diagnostic', () => {
  type Row = { id: string; score: number };
  const rows: Row[] = [
    { id: 'a', score: 2 },
    { id: 'b', score: 1 },
    { id: 'a', score: 3 },
  ];
  const unique = deduplicate<Row, string>({
    name: 'by-id',
    key: (row) => row.id,
    keep: 'first',
  });
  const split = partition<Row>({
    name: 'passing',
    test: (row) => row.score >= 2,
  });
  const result = success(unique.then(split).run(rows));
  assert.deepEqual(
    result.yes.map((source) => source.index),
    [0],
  );
  assert.equal(result.rejected[0]?.issues[0]?.code, 'duplicate_key');
});
