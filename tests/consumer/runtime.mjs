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
