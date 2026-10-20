import assert from 'node:assert/strict';
import test from 'node:test';
import { EffectTree, Err, Graph, Ok, Root } from '@minamorl/berylx';
import { field, reshape, select, type Batch } from '@minamorl/berylx-presets';
import {
  animals,
  mixedPeople,
  throwingPeople,
  type Animal,
} from '../fixtures/data.js';
import {
  reshapePersonReference,
  reshapePeopleReference,
  selectCatsReference,
} from '../fixtures/handwritten.js';
import {
  reshapePersonPreset,
  reshapePeoplePreset,
  selectCatsPreset,
} from '../fixtures/presets.js';
import {
  pipeline,
  input,
  planned,
  graph,
  result,
  nativeResult,
  root,
  type User as ConvertedUser,
} from '../examples/pipeline.js';
import { result as members } from '../examples/predicates.js';

test('public package fixtures match handwritten values, reasons and provenance', () => {
  for (const inputs of [mixedPeople, [], [{ id: 'x', active: true }]]) {
    const expected = reshapePeopleReference(inputs);
    const actual = reshapePeoplePreset(inputs);
    assert.ok(expected.ok && actual.ok);
    assert.deepEqual(actual.value, expected.value);
  }
  for (const person of mixedPeople) {
    const expected = reshapePersonReference(person);
    const actual = reshapePersonPreset(person);
    assert.equal(actual.ok, expected.ok);
    if (actual.ok && expected.ok)
      assert.deepEqual(actual.value, expected.value);
    if (!actual.ok && !expected.ok) {
      assert.deepEqual(actual.result.focus.toObject().issues, expected.issues);
      assert.deepEqual(
        actual.result.focus.toObject().location,
        expected.location,
      );
    }
  }
  const original: Batch<Animal> = {
    accepted: animals.map((value, index) => ({
      index: index + 10,
      input: { raw: index },
      value,
    })),
    rejected: [
      {
        index: 2,
        input: 'old',
        issues: [{ rule: 'old', path: ['id'], code: 'bad', message: 'bad' }],
      },
    ],
  };
  for (const values of [animals, [], animals.slice(1, 2), original]) {
    const expected = selectCatsReference(values);
    const actual = selectCatsPreset(values);
    assert.ok(expected.ok && actual.ok);
    assert.deepEqual(actual.value, expected.value);
  }
  const nonfinite: readonly Animal[] = [
    { kind: 'cat', name: 'NaN', lives: NaN, indoor: true },
  ];
  const expected = selectCatsReference(nonfinite);
  const actual = selectCatsPreset(nonfinite);
  assert.ok(expected.ok && actual.ok);
  assert.deepEqual(actual.value, expected.value);
});

test('union selection source exceptions agree on cause, location and earlier rejection', () => {
  const cause = new Error('lives unavailable');
  class SourceCat {
    readonly kind = 'cat';
    readonly name = 'source';
    readonly indoor = true;
    get lives(): number {
      throw cause;
    }
  }
  const input: readonly Animal[] = [
    { kind: 'dog', name: 'dog', trained: true },
    { kind: 'cat', name: 'ok', lives: 9, indoor: true },
    new SourceCat(),
  ];
  const expected = selectCatsReference(input);
  const actual = selectCatsPreset(input);
  assert.ok(!expected.ok && !actual.ok);
  assert.equal(expected.cause, cause);
  assert.equal(actual.result.cause, cause);
  assert.deepEqual(actual.result.focus.toObject().location, expected.location);
  assert.deepEqual(actual.result.focus.toObject().issues, [
    {
      rule: 'cat',
      path: [],
      code: 'guard_failed',
      message: 'cat did not match',
    },
  ]);
});

test('source exceptions retain the same failure cause/location and valid partial fields', () => {
  const expected = reshapePeopleReference(throwingPeople);
  const actual = reshapePeoplePreset(throwingPeople);
  assert.ok(!actual.ok && !expected.ok);
  assert.ok(actual.result instanceof Err);
  assert.ok(
    actual.result.cause instanceof Error && expected.cause instanceof Error,
  );
  assert.equal(actual.result.cause.message, expected.cause.message);
  assert.deepEqual(actual.result.focus.toObject().location, expected.location);
  // Presets execute rule-major; the handwritten baseline completes one row at a time.
  assert.deepEqual(actual.result.focus.toObject().work, [
    {
      index: 0,
      input: throwingPeople[0],
      value: { id: 1, profile: { label: 'anonymous' }, age: 0 },
      issues: [],
    },
    {
      index: 1,
      input: throwingPeople[1],
      value: { id: 2, profile: { label: 'anonymous' } },
      issues: [],
    },
  ]);
});

test('public pipeline example keeps original sources and exposes graph, dry-run and Root', () => {
  assert.ok(result.ok);
  const accepted: ConvertedUser['id'] = result.value.accepted[0]?.value.id ?? 0;
  assert.equal(accepted, 1);
  assert.deepEqual(
    result.value.rejected.map((item) => [item.index, item.issues[0]?.code]),
    [
      [1, 'invalid_id'],
      [2, 'inactive'],
    ],
  );
  assert.deepEqual(result.value.accepted[0]?.input, input[0]);
  assert.deepEqual(result.value.rejected[1]?.input, input[2]);
  assert.deepEqual(planned, [
    'users:prepare',
    'users:parse_id',
    'users:display_name',
    'users:active',
    'users:result',
    'enabled:prepare',
    'enabled:active',
    'enabled:result',
  ]);
  assert.match(graph, /users:parse_id/);
  assert.ok(nativeResult instanceof Ok);
  assert.deepEqual(root.state().current, result.value);
  assert.deepEqual(root.state().input, input);
  const empty = pipeline.run([]);
  assert.ok(empty.ok);
  assert.deepEqual(empty.value, { accepted: [], rejected: [] });
  assert.ok(members.ok);
  assert.deepEqual(
    members.value.rejected.map((item) => item.issues[0]?.code),
    ['inactive', 'unverified', 'guard_failed'],
  );
});

test('compile is inert and a native Root retains committed state on a rule exception', () => {
  let calls = 0;
  const cause = new Error('unavailable');
  const preset = reshape<string, { first: number; second: string }>({
    name: 'failure',
    fields: {
      first: field('first', (input) => {
        calls++;
        return input.length;
      }),
      second: field<string, string>('second', () => {
        throw cause;
      }),
    },
  });
  const compiled = preset.compile('source');
  assert.deepEqual(Graph.from(compiled.node).nodes(), [
    'failure:prepare',
    'failure:first',
    'failure:second',
    'failure:result',
  ]);
  EffectTree.dryRun(compiled.node, compiled.initialState);
  assert.equal(calls, 0);
  const owner = Root.of(compiled.initialState);
  const outcome = owner.pipe(compiled.node);
  assert.ok(outcome instanceof Err);
  assert.equal(outcome.cause, cause);
  assert.equal(outcome.failedNode, 'failure:second');
  assert.deepEqual(outcome.focus.toObject().location, {
    preset: 'failure',
    rule: 'second',
    path: ['second'],
  });
  assert.deepEqual(outcome.focus.toObject().work, [
    { index: 0, input: 'source', value: { first: 6 }, issues: [] },
  ]);
  assert.deepEqual(owner.state(), compiled.initialState);
});

test('numeric record keys and array leaf values survive shape traversal', () => {
  const outcome = reshape<
    null,
    { 0: string; nested: { values: readonly number[] } }
  >({
    name: 'supported',
    fields: {
      0: field('zero', () => 'value'),
      nested: {
        values: field<null, readonly number[]>('values', () => [1, 2]),
      },
    },
  }).run(null);
  assert.ok(outcome.ok);
  assert.deepEqual(outcome.value, { 0: 'value', nested: { values: [1, 2] } });
});

test('a predicate exception after conversion retains the last output and original source', () => {
  const cause = new Error('selection unavailable');
  const failing = pipeline
    .then(
      select<ConvertedUser>({
        name: 'remote',
        rules: {
          check: () => {
            throw cause;
          },
        },
      }),
    )
    .run(input);
  assert.ok(!failing.ok);
  assert.equal(failing.result.cause, cause);
  assert.equal(failing.result.failedNode, 'remote:check');
  assert.equal(failing.result.focus.toObject().location?.index, 0);
  assert.deepEqual(failing.result.focus.toObject().input, input);
  assert.ok(result.ok);
  assert.deepEqual(failing.result.focus.toObject().current, result.value);
});
