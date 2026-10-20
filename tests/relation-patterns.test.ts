import assert from 'node:assert/strict';
import test from 'node:test';
import { invalid } from '../src/invalid.js';
import {
  choose,
  fallback,
  fanout,
  fold,
  joinMany,
  lookupJoin,
  reconcile,
  scan,
  zipStrict,
} from '../src/relation-patterns.js';
import type { PrimitiveKey } from '../src/relation-patterns.js';
import type { Batch } from '../src/types.js';

const rejected = {
  index: 8,
  input: 'bad',
  issues: [{ rule: 'source', path: ['id'], code: 'bad', message: 'bad row' }],
} as const;
const batch: Batch<{ id: number; n: number }> = {
  accepted: [{ index: 4, input: { id: 1, n: 2 }, value: { id: 1, n: 2 } }],
  rejected: [rejected],
};
function value<T>(result: { ok: true; value: T } | { ok: false }): T {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('expected Ok');
  return result.value;
}
function err(result: { ok: boolean }): void {
  assert.equal(result.ok, false);
}
function graph(
  preset: { compile(input: unknown): { node: unknown } },
  input: unknown,
  names: readonly string[],
): void {
  const source = JSON.stringify(preset.compile(input).node);
  for (const name of names)
    assert.ok(source.includes(name), `${name} missing from graph ${source}`);
}

test('fold and scan preserve Batch origins, empty values, and named rules', () => {
  let calls = 0;
  const total = fold<{ id: number; n: number }, number>({
    seed: () => {
      calls++;
      return 0;
    },
    steps: [{ name: 'add', apply: (sum, row) => sum + row.n }],
  });
  graph(total, batch, ['seed', 'add']);
  assert.equal(calls, 0);
  const output = value(total.run(batch));
  assert.equal(output.value, 2);
  assert.equal(output.sources[0]?.index, 4);
  assert.deepEqual(output.rejected, [rejected]);
  assert.equal(value(total.run([])).value, 0);
  err(
    fold<number, number>({
      seed: () => 0,
      steps: [{ name: 'reject', apply: () => invalid('bad', 'bad') }],
    }).run([1]),
  );
  const history = scan<number, number>({
    seed: () => 0,
    name: 'runningSum',
    apply: (sum, n) => sum + n,
  });
  graph(history, [1], ['seed', 'runningSum']);
  assert.deepEqual(
    value(history.run([1, 2])).accepted.map((x) => x.value),
    [1, 3],
  );
  assert.equal(
    value(
      scan<{ id: number; n: number }, number>({
        seed: () => 0,
        name: 'sum',
        apply: (sum, row) => sum + row.n,
      }).run(batch),
    ).accepted[0]?.origin.index,
    4,
  );
  assert.deepEqual(value(history.run([])).accepted, []);
  err(
    scan<number, number>({
      seed: () => 0,
      name: 'bad',
      apply: () => invalid('bad', 'bad'),
    }).run([1]),
  );
});

test('joins preserve both origins and inherited rejections', () => {
  const right = {
    accepted: [
      {
        index: 9,
        input: { id: 1, label: 'one' },
        value: { id: 1, label: 'one' },
      },
    ],
    rejected: [rejected],
  };
  const one = lookupJoin({
    leftKey: (x: { id: number; n: number }) => x.id,
    rightKey: (x: { id: number; label: string }) => x.id,
  });
  graph(one, { left: batch, right }, ['leftKey', 'rightKey', 'match']);
  const out = value(one.run({ left: batch, right }));
  assert.equal(out.accepted[0]?.left.origin.index, 4);
  assert.equal(out.accepted[0]?.right.origin.index, 9);
  assert.deepEqual(
    out.rejected.map((x) => x.source),
    ['left', 'right'],
  );
  assert.deepEqual(value(one.run({ left: [], right: [] })).accepted, []);
  const duplicate = one.run({
    left: [],
    right: [
      { id: 1, label: 'a' },
      { id: 1, label: 'b' },
    ],
  });
  err(duplicate);
  if (!duplicate.ok)
    assert.deepEqual(duplicate.result.focus.value.location?.path, ['right']);
  const many = joinMany({
    leftKey: (x: { id: number; n: number }) => x.id,
    rightKey: (x: { id: number; label: string }) => x.id,
  });
  graph(many, { left: batch, right }, ['leftKey', 'rightKey']);
  assert.equal(
    value(
      many.run({
        left: batch,
        right: [
          { id: 1, label: 'a' },
          { id: 1, label: 'b' },
        ],
      }),
    ).accepted[0]?.rights.length,
    2,
  );
  assert.deepEqual(value(many.run({ left: [], right: [] })).accepted, []);
  err(
    joinMany({
      leftKey: () => invalid('bad', 'bad'),
      rightKey: (x: number) => x,
    }).run({ left: [1], right: [] }),
  );
});

test('strict zip and reconciliation include typed source provenance', () => {
  const zip = zipStrict<number, string>();
  graph(zip, { left: [1], right: ['a'] }, ['equalLength', 'pair']);
  assert.equal(
    value(zip.run({ left: [1], right: ['a'] })).accepted[0]?.right.origin.value,
    'a',
  );
  const zippedBatch = value(
    zipStrict<{ id: number; n: number }, number>().run({
      left: batch,
      right: [7],
    }),
  );
  assert.equal(zippedBatch.accepted[0]?.left.origin.index, 4);
  assert.equal(zippedBatch.rejected[0]?.source, 'left');
  assert.deepEqual(value(zip.run({ left: [], right: [] })).accepted, []);
  err(zip.run({ left: [1], right: [] }));
  const compare = reconcile({
    leftKey: (x: { id: number; n: number }) => x.id,
    rightKey: (x: { id: number; n: number }) => x.id,
    equal: (a, b) => a.n === b.n,
  });
  graph(compare, { left: batch, right: [] }, ['leftKey', 'rightKey', 'equal']);
  const out = value(
    compare.run({
      left: batch,
      right: [
        { id: 1, n: 3 },
        { id: 2, n: 4 },
      ],
    }),
  );
  assert.equal(out.changed[0]?.left.origin.index, 4);
  assert.equal(out.added[0]?.origin.index, 1);
  assert.equal(out.rejected[0]?.source, 'left');
  assert.deepEqual(value(compare.run({ left: [], right: [] })).changed, []);
  err(
    compare.run({
      left: [
        { id: 1, n: 1 },
        { id: 1, n: 2 },
      ],
      right: [],
    }),
  );
});

test('workflow branches are lazy, ordered, named, and composable', () => {
  let calls = 0;
  const choice = choose<number, string>([
    {
      name: 'positive',
      when: (n) => {
        calls++;
        return n > 0;
      },
      apply: (n) => String(n),
    },
    {
      name: 'negative',
      when: () => {
        throw new Error('unselected');
      },
      apply: () => {
        throw new Error('unselected');
      },
    },
  ]);
  graph(choice, 1, [
    'positive.when',
    'positive.apply',
    'negative.when',
    'negative.apply',
  ]);
  assert.equal(calls, 0);
  assert.equal(value(choice.run(1)).value, '1');
  err(choose<number, string>([]).run(1));
  const fallbackPreset = fallback<number, string>([
    { name: 'first', apply: () => invalid('missing', 'not here') },
    { name: 'second', apply: (n) => String(n) },
  ]);
  graph(fallbackPreset, 2, ['first', 'second']);
  assert.equal(value(fallbackPreset.run(2)).failures[0]?.code, 'missing');
  err(fallback<number, string>([]).run(1));
  const spread = fanout<number, number>([
    { name: 'double', apply: (n) => n * 2 },
    { name: 'triple', apply: (n) => n * 3 },
  ]);
  graph(spread, 2, ['uniqueNames', 'double', 'triple']);
  assert.deepEqual(value(spread.run(2)).values, { double: 4, triple: 6 });
  assert.deepEqual(value(fanout<number, number>([]).run(2)).values, {});
  err(
    fanout<number, number>([
      { name: 'same', apply: (n) => n },
      { name: 'same', apply: (n) => n },
    ]).run(2),
  );
  assert.equal(
    value(
      choice
        .then(
          fanout<{ input: number; branch: string; value: string }, number>([
            { name: 'length', apply: (x) => x.value.length },
          ]),
        )
        .run(1),
    ).values.length,
    1,
  );
  assert.deepEqual(
    value(
      choose<Batch<{ id: number; n: number }>, number>([
        { name: 'all', when: () => true, apply: (x) => x.accepted.length },
      ]).run(batch),
    ).input,
    batch,
  );
  assert.deepEqual(
    value(
      fallback<Batch<{ id: number; n: number }>, number>([
        { name: 'all', apply: (x) => x.accepted.length },
      ]).run(batch),
    ).input,
    batch,
  );
  assert.deepEqual(
    value(
      fanout<Batch<{ id: number; n: number }>, number>([
        { name: 'all', apply: (x) => x.accepted.length },
      ]).run(batch),
    ).input,
    batch,
  );
});

test('every factory defers user callbacks until run and snapshots definition arrays', () => {
  let calls = 0;
  const bump = () => {
    calls++;
    return 1;
  };
  const foldSteps = [{ name: 'one', apply: (sum: number) => sum + bump() }];
  const folds = fold<number, number>({ seed: bump, steps: foldSteps });
  foldSteps.push({ name: 'late', apply: (sum) => sum + bump() });
  const builds = [
    () => folds.compile([1]),
    () =>
      scan<number, number>({
        seed: bump,
        name: 'scan',
        apply: (sum) => sum + bump(),
      }).compile([1]),
    () =>
      lookupJoin<number, number, number>({
        leftKey: bump,
        rightKey: bump,
      }).compile({ left: [1], right: [1] }),
    () =>
      joinMany<number, number, number>({
        leftKey: bump,
        rightKey: bump,
      }).compile({ left: [1], right: [1] }),
    () => zipStrict<number, number>().compile({ left: [1], right: [1] }),
    () =>
      reconcile<number, number, number>({
        leftKey: bump,
        rightKey: bump,
        equal: () => {
          calls++;
          return true;
        },
      }).compile({ left: [1], right: [1] }),
    () =>
      choose<number, number>([
        {
          name: 'one',
          when: () => {
            calls++;
            return true;
          },
          apply: bump,
        },
      ]).compile(1),
    () => fallback<number, number>([{ name: 'one', apply: bump }]).compile(1),
    () => fanout<number, number>([{ name: 'one', apply: bump }]).compile(1),
  ];
  for (const build of builds) build();
  assert.equal(calls, 0);
  graph(folds, [1], ['one']);
  assert.ok(!JSON.stringify(folds.compile([1]).node).includes('late'));
  assert.equal(value(folds.run([1])).value, 2);
});

test('invalid, throws, and thenables do not become successful results', () => {
  const thrown = new Error('boom');
  const cases = [
    fold<number, number>({
      seed: () => 0,
      steps: [
        {
          name: 'throw',
          apply: () => {
            throw thrown;
          },
        },
      ],
    }).run([1]),
    scan<number, number>({
      seed: () => 0,
      name: 'throw',
      apply: () => {
        throw thrown;
      },
    }).run([1]),
    lookupJoin({
      leftKey: () => {
        throw thrown;
      },
      rightKey: (n: number) => n,
    }).run({ left: [1], right: [] }),
    joinMany({
      leftKey: () => {
        throw thrown;
      },
      rightKey: (n: number) => n,
    }).run({ left: [1], right: [] }),
    reconcile({
      leftKey: () => {
        throw thrown;
      },
      rightKey: (n: number) => n,
      equal: () => true,
    }).run({ left: [1], right: [] }),
    choose<number, number>([
      {
        name: 'throw',
        when: () => {
          throw thrown;
        },
        apply: (n) => n,
      },
    ]).run(1),
    fallback<number, number>([
      {
        name: 'throw',
        apply: () => {
          throw thrown;
        },
      },
    ]).run(1),
    fanout<number, number>([
      {
        name: 'throw',
        apply: () => {
          throw thrown;
        },
      },
    ]).run(1),
  ];
  cases.forEach(err);
  const failure = cases[0];
  if (failure?.ok === false) {
    assert.equal(failure.result.error.cause, thrown);
    assert.deepEqual(failure.result.focus.value.location, {
      preset: 'fold',
      rule: 'throw',
      path: [],
      index: 0,
    });
    assert.equal(
      (failure.result.focus.value.work as { value: number }).value,
      0,
    );
  }
  const thenable = {
    then() {
      /* intentionally synchronous-looking */
    },
  };
  err(
    fanout<number, unknown>([{ name: 'async', apply: () => thenable }]).run(1),
  );
  err(
    choose<number, unknown>([
      { name: 'async', when: () => true, apply: () => thenable },
    ]).run(1),
  );
  err(fold<number, unknown>({ seed: () => thenable, steps: [] }).run([]));
  err(
    scan<number, unknown>({
      seed: () => thenable,
      name: 'scan',
      apply: (x) => x,
    }).run([]),
  );
  err(
    fallback<number, unknown>([{ name: 'async', apply: () => thenable }]).run(
      1,
    ),
  );
});

test('JavaScript callers cannot return truthy nonbooleans from predicates', () => {
  const jsTruthy = () => 'yes' as unknown as boolean;
  const choice = choose<number, number>([
    { name: 'bad', when: jsTruthy, apply: (n) => n },
  ]).run(1);
  err(choice);
  if (!choice.ok) {
    assert.ok(choice.result.error.cause instanceof TypeError);
    assert.equal(choice.result.focus.value.location?.rule, 'bad.when');
    assert.deepEqual(choice.result.focus.value.work, { input: 1 });
  }

  const comparison = reconcile<number, number, number>({
    leftKey: (n) => n,
    rightKey: (n) => n,
    equal: jsTruthy,
  }).run({ left: [1], right: [1] });
  err(comparison);
  if (!comparison.ok) {
    assert.ok(comparison.result.error.cause instanceof TypeError);
    assert.equal(comparison.result.focus.value.location?.rule, 'equal');
    assert.deepEqual(comparison.result.focus.value.location?.path, [
      'left',
      'right',
    ]);
    assert.equal(comparison.result.focus.value.location?.index, 0);
    const work = comparison.result.focus.value.work as {
      leftMap: Map<number, { index: number }>;
      rightMap: Map<number, { index: number }>;
    };
    assert.equal(work.leftMap.get(1)?.index, 0);
    assert.equal(work.rightMap.get(1)?.index, 0);
  }
});

test('later key exceptions retain earlier keys and origins at the checkpoint', () => {
  const thrown = new Error('later key');
  const failOnTwo = (n: number) => {
    if (n === 2) throw thrown;
    return n;
  };
  const lookupRight = lookupJoin<number, number, number>({
    leftKey: (n) => n,
    rightKey: failOnTwo,
  }).run({ left: [], right: [1, 2] });
  err(lookupRight);
  if (!lookupRight.ok) {
    assert.equal(lookupRight.result.error.cause, thrown);
    assert.deepEqual(lookupRight.result.focus.value.location?.path, ['right']);
    assert.equal(lookupRight.result.focus.value.location?.index, 1);
    assert.deepEqual(
      (lookupRight.result.focus.value.work as { rightKeys: number[] })
        .rightKeys,
      [1],
    );
  }

  const lookupLeft = lookupJoin<number, number, number>({
    leftKey: failOnTwo,
    rightKey: (n) => n,
  }).run({ left: [1, 2], right: [1] });
  err(lookupLeft);
  if (!lookupLeft.ok) {
    const work = lookupLeft.result.focus.value.work as {
      leftKeys: number[];
      rightKeys: number[];
    };
    assert.deepEqual(work.leftKeys, [1]);
    assert.deepEqual(work.rightKeys, [1]);
  }

  const manyRight = joinMany<number, number, number>({
    leftKey: (n) => n,
    rightKey: failOnTwo,
  }).run({ left: [], right: [1, 2] });
  err(manyRight);
  if (!manyRight.ok) {
    const work = manyRight.result.focus.value.work as {
      keys: Map<number, { index: number }[]>;
    };
    assert.equal(work.keys.get(1)?.[0]?.index, 0);
  }

  const manyLeft = joinMany<number, number, number>({
    leftKey: failOnTwo,
    rightKey: (n) => n,
  }).run({ left: [1, 2], right: [1] });
  err(manyLeft);
  if (!manyLeft.ok) {
    const work = manyLeft.result.focus.value.work as {
      output: { accepted: { left: { origin: { index: number } } }[] };
    };
    assert.equal(work.output.accepted[0]?.left.origin.index, 0);
  }

  const reconcileLeft = reconcile<number, number, number>({
    leftKey: failOnTwo,
    rightKey: (n) => n,
    equal: (a, b) => a === b,
  }).run({ left: [1, 2], right: [] });
  err(reconcileLeft);
  if (!reconcileLeft.ok) {
    const work = reconcileLeft.result.focus.value.work as {
      leftMap: Map<number, { index: number }>;
    };
    assert.equal(work.leftMap.get(1)?.index, 0);
  }

  const reconcileRight = reconcile<number, number, number>({
    leftKey: (n) => n,
    rightKey: failOnTwo,
    equal: (a, b) => a === b,
  }).run({ left: [1], right: [1, 2] });
  err(reconcileRight);
  if (!reconcileRight.ok) {
    const work = reconcileRight.result.focus.value.work as {
      leftMap: Map<number, { index: number }>;
      rightMap: Map<number, { index: number }>;
    };
    assert.equal(work.leftMap.get(1)?.index, 0);
    assert.equal(work.rightMap.get(1)?.index, 0);
  }
});

test('JavaScript object and function keys are explicit whole errors', () => {
  const shared = { id: 1 };
  const rows = [{ key: shared }];
  const escapedKey = (row: { key: object }) => row.key as unknown as string;
  const cases = [
    {
      result: lookupJoin<{ key: object }, { key: object }, string>({
        leftKey: escapedKey,
        rightKey: escapedKey,
      }).run({ left: rows, right: rows }),
      rule: 'rightKey',
      side: 'right',
    },
    {
      result: joinMany<{ key: object }, { key: object }, string>({
        leftKey: escapedKey,
        rightKey: escapedKey,
      }).run({ left: rows, right: rows }),
      rule: 'rightKey',
      side: 'right',
    },
    {
      result: reconcile<{ key: object }, { key: object }, string>({
        leftKey: escapedKey,
        rightKey: escapedKey,
        equal: () => true,
      }).run({ left: rows, right: rows }),
      rule: 'leftKey',
      side: 'left',
    },
  ];
  for (const { result, rule, side } of cases) {
    err(result);
    if (!result.ok) {
      assert.ok(result.result.error.cause instanceof TypeError);
      assert.equal(result.result.focus.value.location?.rule, rule);
      assert.deepEqual(result.result.focus.value.location?.path, [side]);
      assert.equal(result.result.focus.value.location?.index, 0);
      const work = result.result.focus.value.work as {
        left: { index: number }[];
        right: { index: number }[];
      };
      assert.equal(work.left[0]?.index, 0);
      assert.equal(work.right[0]?.index, 0);
    }
  }
  const functionKey = () => 1;
  const functionResult = lookupJoin<{ key: object }, { key: object }, string>({
    leftKey: escapedKey,
    rightKey: escapedKey,
  }).run({ left: [{ key: functionKey }], right: [{ key: functionKey }] });
  err(functionResult);
  if (!functionResult.ok)
    assert.ok(functionResult.result.error.cause instanceof TypeError);
});

test('primitive key equality, mismatch and duplicate behavior', () => {
  const symbol = Symbol('shared');
  const keys: PrimitiveKey[] = [
    'text',
    0,
    NaN,
    true,
    1n,
    symbol,
    null,
    undefined,
  ];
  const lookup = lookupJoin<PrimitiveKey, PrimitiveKey, PrimitiveKey>({
    leftKey: (key) => key,
    rightKey: (key) => key,
  });
  assert.equal(
    value(lookup.run({ left: keys, right: keys })).accepted.length,
    keys.length,
  );
  assert.equal(
    value(lookup.run({ left: ['absent'], right: keys })).unmatched.length,
    1,
  );
  err(lookup.run({ left: [], right: [1, 1] }));

  const many = joinMany<PrimitiveKey, PrimitiveKey, PrimitiveKey>({
    leftKey: (key) => key,
    rightKey: (key) => key,
  });
  assert.equal(
    value(many.run({ left: [null], right: [null, null] })).accepted[0]?.rights
      .length,
    2,
  );

  const compare = reconcile<PrimitiveKey, PrimitiveKey, PrimitiveKey>({
    leftKey: (key) => key,
    rightKey: (key) => key,
    equal: (left, right) => Object.is(left, right),
  });
  assert.equal(
    value(compare.run({ left: keys, right: keys })).unchanged.length,
    keys.length,
  );
  err(compare.run({ left: [true, true], right: [] }));
});
