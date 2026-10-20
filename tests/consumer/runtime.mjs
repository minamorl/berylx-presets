import assert from 'node:assert/strict';
import test from 'node:test';
import { EffectTree, Err, Graph, Ok, Root } from '@minamorl/berylx';
import {
  field,
  invalid,
  reshape,
  reshapeMany,
  select,
} from '@minamorl/berylx-presets';

test('installed package runs both selection APIs and configurable guard reasons', () => {
  const users = [
    { kind: 'member', active: true, emailVerified: true },
    { kind: 'member', active: false, emailVerified: true },
    { kind: 'guest' },
  ];
  const direct = select({
    name: 'members',
    guard: (user) => user.kind === 'member',
    rules: {
      active: (member) => member.active || invalid('inactive', '利用停止中'),
      verified: (member) =>
        member.emailVerified || invalid('unverified', 'メール未確認'),
    },
  }).run(users);
  assert.ok(direct.ok && direct.result instanceof Ok);
  assert.deepEqual(
    direct.value.rejected.map((row) => row.issues[0].code),
    ['inactive', 'guard_failed'],
  );
  const named = select({
    name: 'named',
    guard: { name: 'member', test: (user) => user.kind === 'member' },
    rules: [
      {
        name: 'active',
        test: (member) => member.active,
        code: 'inactive',
        message: '利用停止中',
      },
    ],
  }).run(users);
  assert.ok(named.ok);
  assert.deepEqual(named.value.accepted, direct.value.accepted);
  const custom = select({
    name: 'custom',
    guard: (user) => user.kind === 'member',
    guardFailure: { code: 'not_member', message: '会員ではありません' },
    rules: {},
  }).run([{ kind: 'guest' }]);
  assert.ok(custom.ok);
  assert.equal(custom.value.rejected[0].issues[0].code, 'not_member');
});

test('installed conversion/predicate pipeline interoperates with native Graph, dry-run and Root', () => {
  let calls = 0;
  const pipeline = reshapeMany({
    name: 'users',
    fields: {
      id: field('id', (user) => {
        calls++;
        return /^\d+$/.test(user.id)
          ? Number(user.id)
          : invalid('id', 'bad id');
      }),
      profile: {
        label: field('label', (user) => user.name, { default: 'anonymous' }),
      },
      active: field('active', (user) => user.active),
    },
  }).then(
    select({
      name: 'active',
      rules: {
        enabled: (user) => user.active || invalid('inactive', 'inactive'),
      },
    }),
  );
  const input = [
    { id: '1', active: true },
    { id: 'x', active: true },
    { id: '2', active: false },
  ];
  const compiled = pipeline.compile(input);
  const nodes = [
    'users:prepare',
    'users:id',
    'users:label',
    'users:active',
    'users:result',
    'active:prepare',
    'active:enabled',
    'active:result',
  ];
  assert.deepEqual(Graph.from(compiled.node).nodes(), nodes);
  assert.deepEqual(
    EffectTree.dryRun(compiled.node, compiled.initialState).steps,
    nodes,
  );
  assert.equal(calls, 0);
  const owner = Root.of(compiled.initialState);
  assert.ok(owner.pipe(compiled.node) instanceof Ok);
  const result = pipeline.run(input);
  assert.ok(result.ok);
  assert.deepEqual(owner.state().current, result.value);
  assert.deepEqual(result.value.accepted, [
    {
      index: 0,
      input: input[0],
      value: { id: 1, profile: { label: 'anonymous' }, active: true },
    },
  ]);
  assert.deepEqual(
    result.value.rejected.map((row) => [
      row.index,
      row.input,
      row.issues[0].code,
    ]),
    [
      [1, input[1], 'id'],
      [2, input[2], 'inactive'],
    ],
  );
  const empty = pipeline.run([]);
  assert.ok(empty.ok);
  assert.deepEqual(empty.value, { accepted: [], rejected: [] });
});

test('installed failures retain native Err and partial rule state', () => {
  const cause = new Error('source unavailable');
  const result = reshape({
    name: 'failure',
    fields: {
      safe: field('safe', () => 1),
      nested: {
        value: field('throws', () => {
          throw cause;
        }),
      },
    },
  }).run('source');
  assert.ok(!result.ok && result.result instanceof Err);
  assert.equal(result.result.cause, cause);
  assert.equal(result.result.failedNode, 'failure:throws');
  assert.deepEqual(result.result.focus.toObject().work, [
    { index: 0, input: 'source', value: { safe: 1, nested: {} }, issues: [] },
  ]);
  assert.deepEqual(result.result.focus.toObject().location.path, [
    'nested',
    'value',
  ]);
  const invalidResult = reshape({
    name: 'bad',
    fields: { id: field('id', () => invalid('id', 'bad id')) },
  }).run(null);
  assert.ok(!invalidResult.ok && invalidResult.result instanceof Err);
  assert.equal(invalidResult.result.code, 'id');
});

// Public-root coverage for the expanded preset catalog.
import pattern30_assert from 'node:assert/strict';
import pattern30_test from 'node:test';
import {
  mapValue as pattern30_mapValue,
  mapAccepted as pattern30_mapAccepted,
  expandAccepted as pattern30_expandAccepted,
  validateValue as pattern30_validateValue,
  refineValue as pattern30_refineValue,
  auditValue as pattern30_auditValue,
  countAccepted as pattern30_countAccepted,
  acceptedValues as pattern30_acceptedValues,
  issueReport as pattern30_issueReport,
  groupBy as pattern30_groupBy,
  indexBy as pattern30_indexBy,
  deduplicate as pattern30_deduplicate,
  orderBy as pattern30_orderBy,
  paginate as pattern30_paginate,
  partition as pattern30_partition,
  route as pattern30_route,
  chunk as pattern30_chunk,
  window as pattern30_window,
  fold as pattern30_fold,
  scan as pattern30_scan,
  lookupJoin as pattern30_lookupJoin,
  joinMany as pattern30_joinMany,
  zipStrict as pattern30_zipStrict,
  reconcile as pattern30_reconcile,
  choose as pattern30_choose,
  fallback as pattern30_fallback,
  fanout as pattern30_fanout,
  invalid as pattern30_invalid,
} from '@minamorl/berylx-presets';

pattern30_test('installed root exposes all 27 added factories', () => {
  for (const pattern30_factory of [
    pattern30_mapValue,
    pattern30_mapAccepted,
    pattern30_expandAccepted,
    pattern30_validateValue,
    pattern30_refineValue,
    pattern30_auditValue,
    pattern30_countAccepted,
    pattern30_acceptedValues,
    pattern30_issueReport,
    pattern30_groupBy,
    pattern30_indexBy,
    pattern30_deduplicate,
    pattern30_orderBy,
    pattern30_paginate,
    pattern30_partition,
    pattern30_route,
    pattern30_chunk,
    pattern30_window,
    pattern30_fold,
    pattern30_scan,
    pattern30_lookupJoin,
    pattern30_joinMany,
    pattern30_zipStrict,
    pattern30_reconcile,
    pattern30_choose,
    pattern30_fallback,
    pattern30_fanout,
  ]) {
    pattern30_assert.equal(typeof pattern30_factory, 'function');
  }
});

pattern30_test(
  'installed cross-family pipeline returns ordered values with source records',
  () => {
    const pattern30_result = pattern30_mapAccepted({
      name: 'copy-public',
      transform: (row) => ({ id: row.id, amount: row.amount }),
    })
      .then(
        pattern30_orderBy({
          keys: [{ name: 'amount', key: (row) => row.amount }],
        }),
      )
      .then(pattern30_countAccepted({ min: 1 }))
      .run([
        { id: 'source-a', amount: 2 },
        { id: 'source-b', amount: 1 },
      ]);
    pattern30_assert.equal(pattern30_result.ok, true);
    if (!pattern30_result.ok) pattern30_assert.fail('pipeline returned Err');
    pattern30_assert.deepEqual(pattern30_result.value, {
      accepted: [
        {
          index: 1,
          input: { id: 'source-b', amount: 1 },
          value: { id: 'source-b', amount: 1 },
        },
        {
          index: 0,
          input: { id: 'source-a', amount: 2 },
          value: { id: 'source-a', amount: 2 },
        },
      ],
      rejected: [],
    });
  },
);

pattern30_test(
  'installed lookup join returns exact left and right provenance',
  () => {
    const pattern30_result = pattern30_lookupJoin({
      leftKey: (row) => row.id,
      rightKey: (row) => row.id,
    }).run({
      left: [{ id: 'left-a' }],
      right: [{ id: 'left-a', label: 'joined' }],
    });
    pattern30_assert.equal(pattern30_result.ok, true);
    if (!pattern30_result.ok) pattern30_assert.fail('join returned Err');
    pattern30_assert.deepEqual(pattern30_result.value, {
      accepted: [
        {
          left: {
            source: 'left',
            origin: {
              index: 0,
              input: { id: 'left-a' },
              value: { id: 'left-a' },
            },
          },
          right: {
            source: 'right',
            origin: {
              index: 0,
              input: { id: 'left-a', label: 'joined' },
              value: { id: 'left-a', label: 'joined' },
            },
          },
        },
      ],
      unmatched: [],
      rejected: [],
    });
  },
);

pattern30_test(
  'installed fallback records explicit failure and chosen value',
  () => {
    const pattern30_result = pattern30_fallback([
      {
        name: 'unavailable',
        apply: () => pattern30_invalid('data_missing', 'No cached value'),
      },
      { name: 'source', apply: (value) => `loaded:${value}` },
    ]).run('item');
    pattern30_assert.equal(pattern30_result.ok, true);
    if (!pattern30_result.ok) pattern30_assert.fail('fallback returned Err');
    pattern30_assert.deepEqual(pattern30_result.value, {
      input: 'item',
      branch: 'source',
      value: 'loaded:item',
      failures: [
        {
          branch: 'unavailable',
          code: 'data_missing',
          message: 'No cached value',
        },
      ],
    });
  },
);

pattern30_test('installed countAccepted bounds return an Err', () => {
  const pattern30_result = pattern30_countAccepted({ min: 2 }).run([
    { id: 'only' },
  ]);
  pattern30_assert.equal(pattern30_result.ok, false);
  pattern30_assert.equal(pattern30_result.value, undefined);
});
