import assert from 'node:assert/strict';
import test from 'node:test';
import { EffectTree, Err, Graph, Ok, Sequence, Task } from '@minamorl/berylx';
import { animals, type Animal, type Cat } from '../fixtures/data.js';
import { selectCatsReference } from '../fixtures/handwritten.js';
import type { SelectDefinition } from '../src/definitions.js';
import { invalid } from '../src/invalid.js';
import { select } from '../src/select.js';
import type { Batch } from '../src/types.js';

const catDefinition: SelectDefinition<Animal, Cat> = {
  name: 'cats',
  guard: { name: 'cat', test: (animal): animal is Cat => animal.kind === 'cat' },
  rules: [
    { name: 'alive', test: (cat) => cat.lives > 0, code: 'no_lives', message: 'cat has no remaining lives' },
    { name: 'indoor', test: (cat) => cat.indoor, code: 'outdoor', message: 'cat must live indoors' },
  ],
};

test('select named guard/rules match the handwritten union selection', () => {
  const expected = selectCatsReference(animals);
  const actual = select(catDefinition).run(animals);
  assert.ok(expected.ok && actual.ok);
  assert.ok(actual.result instanceof Ok);
  assert.deepEqual(actual.value, expected.value);
  assert.deepEqual(actual.value.rejected.map((row) => row.issues.length), [1, 1, 1]);
  assert.deepEqual(actual.result.focus.toObject().issues.map((issue) => issue.rule), ['cat', 'alive', 'indoor']);
});

test('compile/dryRun expose a native Task per guard/condition without executing predicates', () => {
  const calls: string[] = [];
  const preset = select<Animal, Cat>({
    name: 'cats',
    guard: { name: 'cat', test: (value): value is Cat => {
      calls.push(`cat:${value.name}`); return value.kind === 'cat';
    } },
    rules: [
      { name: 'alive', test: (cat) => { calls.push(`alive:${cat.name}`); return cat.lives > 0; }, code: 'dead', message: 'dead' },
      { name: 'indoor', test: (cat) => { calls.push(`indoor:${cat.name}`); return cat.indoor; }, code: 'outdoor', message: 'outdoor' },
    ],
  });
  const compiled = preset.compile(animals);
  assert.ok(compiled.node instanceof Sequence);
  assert.ok(compiled.node.steps.every((step) => step instanceof Task));
  const nodes = ['cats:prepare', 'cats:cat', 'cats:alive', 'cats:indoor', 'cats:result'];
  assert.deepEqual(Graph.from(compiled.node).nodes(), nodes);
  assert.deepEqual(EffectTree.dryRun(compiled.node, compiled.initialState).steps, nodes);
  assert.deepEqual(calls, []);
  assert.ok(preset.run(animals).ok);
  assert.deepEqual(calls, [
    'cat:Mochi', 'cat:Pochi', 'cat:Ghost', 'cat:Tama',
    'alive:Mochi', 'alive:Ghost', 'alive:Tama', 'indoor:Mochi', 'indoor:Tama',
  ]);
});

type Member = { kind: 'member'; active: boolean; emailVerified: boolean };
type User = Member | { kind: 'guest' };

test('direct guard and predicate record support the presented User/Member syntax', () => {
  const users: readonly User[] = [
    { kind: 'member', active: true, emailVerified: true },
    { kind: 'member', active: false, emailVerified: false },
    { kind: 'member', active: true, emailVerified: false },
    { kind: 'guest' },
  ];
  const preset = select<User, Member>({
    name: 'members',
    guard: (user): user is Member => user.kind === 'member',
    rules: {
      active: (member) => member.active || invalid('inactive', '利用停止中'),
      verified: (member) => member.emailVerified || invalid('unverified', 'メール未確認'),
    },
  });
  const result = preset.run(users);
  assert.ok(result.ok);
  assert.deepEqual(result.value.accepted, [{ index: 0, input: users[0], value: users[0] }]);
  assert.deepEqual(result.value.rejected.map((row) => [row.index, row.issues[0]]), [
    [1, { rule: 'active', path: [], code: 'inactive', message: '利用停止中' }],
    [2, { rule: 'verified', path: [], code: 'unverified', message: 'メール未確認' }],
    [3, { rule: 'guard', path: [], code: 'guard_failed', message: 'guard did not match' }],
  ]);
  assert.deepEqual(Graph.from(preset.compile(users).node).nodes(), [
    'members:prepare', 'members:guard', 'members:active', 'members:verified', 'members:result',
  ]);
});

test('predicate false has a stable default and guard failure can be customized', () => {
  const preset = select<User, Member>({
    name: 'members', guard: (user): user is Member => user.kind === 'member',
    guardFailure: { code: 'not_member', message: '会員ではありません' },
    rules: { active: (member) => member.active },
  });
  const result = preset.run([{ kind: 'guest' }, { kind: 'member', active: false, emailVerified: true }]);
  assert.ok(result.ok);
  assert.deepEqual(result.value.rejected.map((row) => row.issues[0]), [
    { rule: 'guard', path: [], code: 'not_member', message: '会員ではありません' },
    { rule: 'active', path: [], code: 'condition_failed', message: 'active did not match' },
  ]);
});

test('Batch keeps provenance, inherited rejections and source order across distinct failing tasks', () => {
  const inherited = { index: 100, input: { raw: 'bad' }, issues: [
    { rule: 'convert', path: ['id'], code: 'bad_id', message: 'bad id' },
  ] };
  const input: Batch<Animal> = {
    accepted: [
      { index: 70, input: { raw: 'outdoor' }, value: { kind: 'cat', name: 'A', lives: 4, indoor: false } },
      { index: 2, input: { raw: 'dog' }, value: { kind: 'dog', name: 'B', trained: true } },
      { index: 14, input: { raw: 'dead' }, value: { kind: 'cat', name: 'C', lives: 0, indoor: false } },
      { index: 9, input: { raw: 'accepted' }, value: { kind: 'cat', name: 'D', lives: 9, indoor: true } },
    ], rejected: [inherited],
  };
  const result = select(catDefinition).run(input);
  assert.ok(result.ok);
  assert.deepEqual(result.value.rejected[0], inherited);
  assert.deepEqual(result.value.rejected.map((row) => row.index), [100, 70, 2, 14]);
  assert.deepEqual(result.value.rejected.map((row) => row.input), [
    inherited.input, ...input.accepted.slice(0, 3).map((row) => row.input),
  ]);
  assert.deepEqual(result.value.accepted, [input.accepted[3]]);
  assert.deepEqual(input.rejected, [inherited]);
  assert.equal(input.accepted.length, 4);
});

test('first failed condition skips subsequent predicates for that row; Invalid overrides configured reason', () => {
  const calls: number[] = [];
  const result = select<number>({ name: 'positive', rules: [
    { name: 'positive', test: (n) => n > 0 || invalid('negative', 'negative value'), code: 'fallback', message: 'fallback' },
    { name: 'even', test: (n) => { calls.push(n); return n % 2 === 0; }, code: 'odd', message: 'odd value' },
  ] }).run([-1, 3, 2]);
  assert.ok(result.ok);
  assert.deepEqual(calls, [3, 2]);
  assert.deepEqual(result.value.rejected.map((row) => row.issues[0]?.code), ['negative', 'odd']);
  assert.deepEqual(result.value.accepted.map((row) => row.value), [2]);
});

test('empty arrays, all-rejected input and empty condition sets succeed, with independent runs', () => {
  const cats = select(catDefinition);
  const empty = cats.run([]);
  assert.ok(empty.ok);
  assert.deepEqual(empty.value, { accepted: [], rejected: [] });
  const none = cats.run([{ kind: 'dog', name: 'D', trained: true }]);
  assert.ok(none.ok);
  assert.deepEqual(none.value.accepted, []);
  assert.equal(none.value.rejected.length, 1);
  for (const rules of [[], {}]) {
    const all = Array.isArray(rules)
      ? select<number>({ name: 'all', rules: [] })
      : select<number>({ name: 'all', rules: {} });
    const result = all.run([1, 0, 2]);
    assert.ok(result.ok);
    assert.deepEqual(result.value.accepted.map((row) => row.value), [1, 0, 2]);
    assert.deepEqual(result.value.rejected, []);
  }
  const repeated = cats.run(animals);
  assert.ok(repeated.ok);
  assert.equal(repeated.value.rejected.length, 3);
  assert.deepEqual(cats.compile([]).initialState.issues, []);
});

test('unexpected condition exception fails the whole workflow, retaining checkpoint/location/cause', () => {
  const cause = new RangeError('predicate unavailable');
  let later = false;
  const input: Batch<number> = {
    accepted: [
      { index: 5, input: 'first', value: -1 },
      { index: 8, input: 'second', value: 2 },
      { index: 13, input: 'third', value: 3 },
    ], rejected: [{ index: 1, input: 'old', issues: [{ rule: 'old', path: [], code: 'old', message: 'old' }] }],
  };
  const result = select<number>({ name: 'numbers', rules: {
    positive: (n) => {
      if (n === 3) throw cause;
      return n > 0 || invalid('negative', 'negative value');
    },
    later: () => { later = true; return true; },
  } }).run(input);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.result instanceof Err);
  assert.equal(result.result.cause, cause);
  assert.equal(result.result.failedNode, 'numbers:positive');
  assert.deepEqual(result.result.trace, ['numbers:positive']);
  const frame = result.result.focus.toObject();
  const issue = { rule: 'positive', path: [], code: 'negative', message: 'negative value' };
  assert.deepEqual(frame.work, {
    rows: input.accepted.map((entry, index) => ({ entry, issue: index === 0 ? issue : null })),
    rejected: input.rejected,
  });
  assert.deepEqual(frame.issues, [issue]);
  assert.deepEqual(frame.location, { preset: 'numbers', rule: 'positive', path: [], index: 13 });
  assert.deepEqual(result.result.error.metadata.location, frame.location);
  assert.deepEqual(frame.input, input);
  assert.equal(later, false);
});

test('throwing a returned-failure type remains a fatal exception', () => {
  const cause = invalid('thrown', 'not a returned failure');
  const result = select<number>({ name: 'throw', rules: { throws: () => { throw cause; } } }).run([1]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.result.cause, cause);
    assert.equal(result.result.failedNode, 'throw:throws');
    assert.deepEqual(result.result.focus.toObject().issues, []);
  }
});

test('guard exceptions retain original array index and earlier guard rejection', () => {
  const cause = new Error('guard failed unexpectedly');
  const result = select<Animal, Cat>({ name: 'cats',
    guard: (value): value is Cat => {
      if (value.name === 'Ghost') throw cause;
      return value.kind === 'cat';
    },
    rules: {},
  }).run(animals);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.result.cause, cause);
    assert.equal(result.result.failedNode, 'cats:guard');
    assert.equal(result.result.focus.toObject().location?.index, 2);
    assert.deepEqual(result.result.focus.toObject().issues, [
      { rule: 'guard', path: [], code: 'guard_failed', message: 'guard did not match' },
    ]);
  }
});

test('conditions and guards reject thenables and nonboolean values instead of accepting truthiness', () => {
  const badValues: readonly unknown[] = [
    undefined, null, 0, 1, '', 'true', {}, new Boolean(false), Promise.resolve(true),
    { then() { throw new Error('then must not be called'); } },
  ];
  for (const value of badValues) {
    const result = select<number>({ name: 'bad', rules: { predicate: () => value as boolean } }).run([1]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.result.code, 'TypeError');
      assert.equal(result.result.failedNode, 'bad:predicate');
      assert.equal(result.result.focus.toObject().location?.index, 0);
    }
    const guardResult = select<number>({ name: 'bad', guard: (_n): _n is number => value as boolean, rules: {} }).run([1]);
    assert.equal(guardResult.ok, false);
    if (!guardResult.ok) {
      assert.equal(guardResult.result.code, 'TypeError');
      assert.equal(guardResult.result.failedNode, 'bad:guard');
    }
  }
  const invalidGuard = select<number>({ name: 'bad',
    guard: (_n): _n is number => invalid('not_boolean', 'invalid guard') as unknown as boolean,
    rules: {},
  }).run([1]);
  assert.equal(invalidGuard.ok, false);
  if (!invalidGuard.ok) assert.equal(invalidGuard.result.code, 'TypeError');
});

test('named conditions also reject an unexpected callback result', () => {
  const result = select<number>({ name: 'named', rules: [
    { name: 'bad', test: () => 'truthy' as unknown as boolean, code: 'false', message: 'false' },
  ] }).run([1]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.result.failedNode, 'named:bad');
});

test('then composes selected batches while keeping earlier reasons and original provenance', () => {
  const selected = select<number>({ name: 'positive', rules: { positive: (n) => n > 0 } })
    .then(select<number>({ name: 'even', rules: { even: (n) => n % 2 === 0 } }));
  const result = selected.run([-1, 1, 2]);
  assert.ok(result.ok);
  assert.deepEqual(result.value.accepted, [{ index: 2, input: 2, value: 2 }]);
  assert.deepEqual(result.value.rejected.map((row) => [row.index, row.issues[0]?.rule]), [[0, 'positive'], [1, 'even']]);
  assert.deepEqual(result.result.focus.toObject().issues.map((issue) => issue.rule), ['positive', 'even']);
});
