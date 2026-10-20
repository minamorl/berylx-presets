import assert from 'node:assert/strict';
import test from 'node:test';
import {
  animals,
  mixedPeople,
  throwingPeople,
  type Animal,
} from '../fixtures/data.js';
import {
  reshapePeopleReference,
  reshapePersonReference,
  selectCatsReference,
} from '../fixtures/handwritten.js';

test('handwritten baseline transforms nested records and records original provenance', () => {
  const result = reshapePeopleReference(mixedPeople);
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.accepted.map((item) => item.value),
    [
      { id: 12, profile: { label: 'Mina' }, age: 21, active: true },
      { id: 14, profile: { label: 'anonymous' }, age: 0, active: false },
    ],
  );
  assert.deepEqual(
    result.value.rejected.map((item) => [item.index, item.issues[0]?.code]),
    [
      [1, 'invalid_id'],
      [2, 'negative_age'],
    ],
  );
  assert.equal(result.value.accepted[1]?.input, mixedPeople[3]);
  const single = reshapePersonReference({ id: 'x', active: true });
  assert.equal(single.ok, false);
});

test('handwritten union guard and ordered conditions record only the first failure', () => {
  const result = selectCatsReference(animals);
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.accepted.map((item) => item.value.name),
    ['Mochi'],
  );
  assert.deepEqual(
    result.value.rejected.map((item) => [item.index, item.issues[0]?.rule]),
    [
      [1, 'cat'],
      [2, 'alive'],
      [3, 'indoor'],
    ],
  );
  const inherited = {
    index: 9,
    input: 'original',
    issues: [{ rule: 'old', path: [], code: 'old', message: 'old' }],
  };
  const existing = selectCatsReference({
    accepted: [
      {
        index: 5,
        input: 'source',
        value: {
          kind: 'cat',
          name: 'M',
          lives: 9,
          indoor: true,
        } satisfies Animal,
      },
    ],
    rejected: [inherited],
  });
  assert.ok(existing.ok);
  assert.equal(existing.value.rejected[0], inherited);
  assert.equal(existing.value.accepted[0]?.input, 'source');
  assert.equal(existing.value.accepted[0]?.index, 5);
});

test('handwritten empty and all-rejected cases are successful batches', () => {
  const empty = reshapePeopleReference([]);
  assert.deepEqual(empty, { ok: true, value: { accepted: [], rejected: [] } });
  const none = reshapePeopleReference([{ id: 'x', active: true }]);
  assert.ok(none.ok);
  assert.deepEqual(none.value.accepted, []);
  const selected = selectCatsReference([
    { kind: 'dog', name: 'D', trained: true },
  ]);
  assert.ok(selected.ok);
  assert.deepEqual(selected.value.accepted, []);
});

test('handwritten unexpected exception retains earlier items and failing position', () => {
  const result = reshapePeopleReference(throwingPeople);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.kind, 'exception');
  assert.equal(result.location.index, 1);
  assert.deepEqual(result.location.path, ['age']);
  assert.ok(result.cause instanceof Error);
  assert.equal(result.cause.message, 'age source unavailable');
  assert.deepEqual(result.partial, {
    accepted: [
      {
        index: 0,
        input: throwingPeople[0],
        value: {
          id: 1,
          profile: { label: 'anonymous' },
          age: 0,
          active: true,
        },
      },
    ],
    rejected: [],
    current: { id: 2, profile: { label: 'anonymous' } },
  });
});
