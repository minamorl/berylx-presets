import test from 'node:test';
import assert from 'node:assert/strict';
import { Invalid } from '../src/invalid.js';
import {
  mapValue,
  mapAccepted,
  expandAccepted,
  validateValue,
  refineValue,
  auditValue,
  countAccepted,
  acceptedValues,
  issueReport,
} from '../src/transform-patterns.js';

const oldRejection = {
  index: 7,
  input: 'old',
  issues: [{ rule: 'prior', path: ['old'], code: 'old', message: 'old' }],
} as const;

test('mapValue is lazy, composable, and locates expected failure', () => {
  let calls = 0;
  const definition = {
    name: 'double',
    path: ['amount'],
    transform: (n: number) => {
      calls++;
      return n * 2;
    },
  };
  const preset = mapValue(definition);
  assert.equal(calls, 0);
  assert.deepEqual(
    preset.compile(3).node.steps.map((step) => Reflect.get(step, 'name')),
    ['mapValue:prepare', 'mapValue:double', 'mapValue:result'],
  );
  assert.equal(calls, 0);
  const result = preset
    .then(mapValue({ name: 'plusOne', transform: (n: number) => n + 1 }))
    .run(3);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 7);
  assert.equal(calls, 1);
  const bad = mapValue({
    name: 'parse',
    path: ['n'],
    transform: () => new Invalid('bad_number', 'bad'),
  }).run('x');
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.result.error.code, 'bad_number');
    assert.deepEqual(bad.result.focus.value.location?.path, ['n']);
    assert.equal((bad.result.focus.value.work as { value: string }).value, 'x');
  }
});

test('mapAccepted keeps source positions, inherited rejection, and new invalid reasons', () => {
  const preset = mapAccepted({
    name: 'scale',
    path: ['value'],
    transform: (n: number) =>
      n < 0 ? new Invalid('negative', 'negative') : n * 10,
  });
  const batch = {
    accepted: [
      { index: 4, input: { id: 4 }, value: 2 },
      { index: 6, input: { id: 6 }, value: -1 },
    ],
    rejected: [oldRejection],
  };
  const result = preset.run(batch);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.accepted, [
      { index: 4, input: { id: 4 }, value: 20 },
    ]);
    assert.deepEqual(
      result.value.rejected.map((row) => row.index),
      [7, 6],
    );
    assert.deepEqual(result.value.rejected[1]?.issues[0], {
      rule: 'scale',
      path: ['value'],
      code: 'negative',
      message: 'negative',
    });
    assert.equal(result.result.focus.value.issues.at(-1)?.rule, 'scale');
  }
  const empty = preset.run([]);
  assert.equal(empty.ok, true);
  if (empty.ok) assert.deepEqual(empty.value, { accepted: [], rejected: [] });
  const allRejected = preset.run([-1]);
  assert.equal(allRejected.ok, true);
  if (allRejected.ok) assert.deepEqual(allRejected.value.accepted, []);
});

test('expandAccepted carries honest source provenance through zero or many outputs', () => {
  const preset = expandAccepted({
    name: 'tokens',
    transform: (s: string) =>
      s === 'bad' ? new Invalid('bad', 'bad') : s.split(' ').filter(Boolean),
  });
  const result = preset.run({
    accepted: [
      { index: 3, input: 'source', value: 'a b' },
      { index: 5, input: 'empty', value: '' },
      { index: 8, input: 'bad', value: 'bad' },
    ],
    rejected: [oldRejection],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.accepted, [
      { index: 3, input: 'source', value: 'a' },
      { index: 3, input: 'source', value: 'b' },
    ]);
    assert.deepEqual(
      result.value.rejected.map((row) => row.index),
      [7, 8],
    );
  }
});

test('expandAccepted rejects nonarrays as whole Err with source checkpoint', () => {
  const badValues: readonly [string, unknown][] = [
    ['string', 'abc'],
    ['set', new Set(['a', 'b'])],
    [
      'generator',
      (function* () {
        yield 'a';
      })(),
    ],
    ['object', { 0: 'a', length: 1 }],
    ['null', null],
  ];
  for (const [label, badValue] of badValues) {
    const escaped = ((n: number) =>
      n === 1 ? ['ok'] : badValue) as unknown as (
      n: number,
    ) => readonly string[];
    const preset = expandAccepted<number, string>({
      name: 'expandRows',
      path: ['parts'],
      transform: escaped,
    });
    const result = preset.run({
      accepted: [
        { index: 11, input: 'first', value: 1 },
        { index: 23, input: 'second', value: 2 },
      ],
      rejected: [oldRejection],
    });
    assert.equal(result.ok, false, label);
    if (!result.ok) {
      assert.ok(result.result.error.cause instanceof TypeError, label);
      assert.equal(result.result.focus.value.location?.rule, 'expandRows');
      assert.equal(result.result.focus.value.location?.index, 23);
      assert.deepEqual(result.result.focus.value.location?.path, ['parts']);
      const checkpoint = result.result.focus.value.work as {
        accepted: { index: number; input: unknown; value: string }[];
        source: { rejected: { index: number }[] };
      };
      assert.deepEqual(checkpoint.accepted, [
        { index: 11, input: 'first', value: 'ok' },
      ]);
      assert.deepEqual(
        checkpoint.source.rejected.map((row) => row.index),
        [7],
      );
    }
  }

  const empty = expandAccepted<number, string>({
    name: 'emptyArray',
    transform: () => [],
  }).run([1]);
  assert.equal(empty.ok, true);
  if (empty.ok) assert.deepEqual(empty.value.accepted, []);
});

test('expandAccepted still rejects thenables before array validation', () => {
  const escaped = (() => Promise.resolve(['a'])) as unknown as (
    n: number,
  ) => readonly string[];
  const result = expandAccepted<number, string>({
    name: 'asyncExpansion',
    transform: escaped,
  }).run([1]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.result.focus.value.location?.rule, 'asyncExpansion');
    assert.equal(result.result.focus.value.location?.index, 0);
  }
});

test('validateValue uses declaration order and snapshots mutable rules', () => {
  const seen: string[] = [];
  const rules = [
    {
      name: 'first',
      check: (n: number) => {
        seen.push('first');
        return n > 0;
      },
    },
    {
      name: 'second',
      check: (n: number) => {
        seen.push('second');
        return n < 10;
      },
    },
  ];
  const preset = validateValue(rules);
  rules.pop();
  assert.deepEqual(
    preset.compile(5).node.steps.map((step) => Reflect.get(step, 'name')),
    [
      'validateValue:prepare',
      'validateValue:first',
      'validateValue:second',
      'validateValue:result',
    ],
  );
  assert.deepEqual(seen, []);
  assert.equal(preset.run(5).ok, true);
  assert.deepEqual(seen, ['first', 'second']);
  seen.length = 0;
  assert.equal(preset.run(-1).ok, false);
  assert.deepEqual(seen, ['first']);
  assert.equal(validateValue<number>([]).run(1).ok, false);
});

test('refineValue narrows a union and rejects failed guards', () => {
  type Animal = { kind: 'cat'; lives: number } | { kind: 'dog'; bark: string };
  const cat = refineValue<Animal, Extract<Animal, { kind: 'cat' }>>({
    name: 'cat',
    guard: (animal): animal is Extract<Animal, { kind: 'cat' }> =>
      animal.kind === 'cat',
  });
  const yes = cat.run({ kind: 'cat', lives: 9 });
  assert.equal(yes.ok, true);
  if (yes.ok) assert.equal(yes.value.lives, 9);
  const no = cat.run({ kind: 'dog', bark: 'woof' });
  assert.equal(no.ok, false);
  if (!no.ok) assert.equal(no.result.error.code, 'refinement_failed');
});

test('auditValue visits all rules and retains every issue', () => {
  const preset = auditValue<number>([
    { name: 'positive', path: ['n'], check: (n) => n > 0 },
    { name: 'even', check: (n) => n % 2 === 0 },
  ]);
  const failed = preset.run(-1);
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.deepEqual(
      failed.result.focus.value.issues.map((issue) => issue.rule).slice(0, 2),
      ['positive', 'even'],
    );
    assert.equal(
      (failed.result.focus.value.work as { value: number }).value,
      -1,
    );
  }
  assert.equal(preset.run(2).ok, true);
  assert.equal(auditValue<number>([]).run(2).ok, false);
});

test('countAccepted checks both bounds and keeps batch records', () => {
  const preset = countAccepted<number>({ min: 1, max: 2 });
  assert.deepEqual(
    preset.compile([1]).node.steps.map((step) => Reflect.get(step, 'name')),
    [
      'countAccepted:prepare',
      'countAccepted:minAccepted',
      'countAccepted:maxAccepted',
      'countAccepted:result',
    ],
  );
  const good = preset.run({
    accepted: [{ index: 9, input: 'source', value: 4 }],
    rejected: [oldRejection],
  });
  assert.equal(good.ok, true);
  if (good.ok) assert.deepEqual(good.value.rejected, [oldRejection]);
  const few = preset.run([]);
  assert.equal(few.ok, false);
  if (!few.ok) assert.equal(few.result.error.code, 'too_few_accepted');
  const many = preset.run([1, 2, 3]);
  assert.equal(many.ok, false);
  if (!many.ok) assert.equal(many.result.error.code, 'too_many_accepted');
  const malformed = countAccepted<number>({ min: 3, max: 1 }).run([1]);
  assert.equal(malformed.ok, false);
  if (!malformed.ok)
    assert.equal(malformed.result.error.code, 'invalid_bounds');
  assert.equal(countAccepted<number>({}).run([1]).ok, false);
});

test('acceptedValues is an explicit terminal extraction', () => {
  const preset = acceptedValues<number>();
  const result = preset.run({
    accepted: [{ index: 3, input: 'source', value: 8 }],
    rejected: [oldRejection],
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, [8]);
  const empty = preset.run([]);
  assert.equal(empty.ok, true);
  if (empty.ok) assert.deepEqual(empty.value, []);
});

test('issueReport flattens rejection diagnostics with source position and input', () => {
  const preset = issueReport<number>();
  const result = preset.run({
    accepted: [{ index: 2, input: 'source', value: 5 }],
    rejected: [oldRejection],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.accepted, [
      { index: 2, input: 'source', value: 5 },
    ]);
    assert.deepEqual(result.value.issues, [
      {
        index: 7,
        input: 'old',
        rule: 'prior',
        path: ['old'],
        code: 'old',
        message: 'old',
      },
    ]);
  }
  const empty = preset.run([]);
  assert.equal(empty.ok, true);
  if (empty.ok) assert.deepEqual(empty.value.issues, []);
});

test('throw and thenable callbacks produce whole Err with checkpoint and original cause', () => {
  const cause = new Error('boom');
  const thrower = mapAccepted({
    name: 'explode',
    transform: (n: number) => {
      if (n === 2) throw cause;
      return n;
    },
  });
  const failed = thrower.run([1, 2]);
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.result.error.cause, cause);
    assert.equal(failed.result.focus.value.location?.index, 1);
    assert.deepEqual(
      (
        failed.result.focus.value.work as { accepted: { value: number }[] }
      ).accepted.map((row) => row.value),
      [1],
    );
  }
  const thenable = mapValue<number, number>({
    name: 'async',
    transform: (() => Promise.resolve(1)) as unknown as (n: number) => number,
  });
  const asyncFailure = thenable.run(1);
  assert.equal(asyncFailure.ok, false);
  if (!asyncFailure.ok)
    assert.equal(asyncFailure.result.focus.value.location?.rule, 'async');
});

test('all factory graphs expose their named rules without evaluating callbacks', () => {
  let calls = 0;
  const graphNames = [
    mapValue({
      name: 'whole',
      transform: (n: number) => {
        calls++;
        return n;
      },
    }).compile(1).node,
    mapAccepted({
      name: 'row',
      transform: (n: number) => {
        calls++;
        return n;
      },
    }).compile([1]).node,
    expandAccepted({
      name: 'expand',
      transform: (n: number) => {
        calls++;
        return [n];
      },
    }).compile([1]).node,
    validateValue<number>([
      {
        name: 'check',
        check: () => {
          calls++;
          return true;
        },
      },
    ]).compile(1).node,
    refineValue<number, number>({
      name: 'guard',
      guard: (n): n is number => {
        calls++;
        return Number.isFinite(n);
      },
    }).compile(1).node,
    auditValue<number>([
      {
        name: 'audit',
        check: () => {
          calls++;
          return true;
        },
      },
    ]).compile(1).node,
    countAccepted<number>({ min: 1 }).compile([1]).node,
    acceptedValues<number>().compile([1]).node,
    issueReport<number>().compile([1]).node,
  ].flatMap((node) => node.steps.map((step) => Reflect.get(step, 'name')));
  assert.equal(calls, 0);
  for (const name of [
    'whole',
    'row',
    'expand',
    'check',
    'guard',
    'audit',
    'minAccepted',
    'extractAccepted',
    'collectIssues',
  ]) {
    assert.ok(
      graphNames.some((graphName) => graphName.endsWith(`:${name}`)),
      name,
    );
  }
});

test('escaped nonboolean checks fail the whole run with TypeError and checkpoint', () => {
  const truthy = (() => 'yes') as unknown as (value: number) => boolean;
  const validation = validateValue<number>([
    { name: 'first', check: () => true },
    { name: 'badCheck', path: ['check'], check: truthy },
  ]).run(12);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    assert.ok(validation.result.error.cause instanceof TypeError);
    assert.equal(validation.result.focus.value.location?.rule, 'badCheck');
    assert.deepEqual(validation.result.focus.value.location?.path, ['check']);
    assert.equal(validation.result.focus.value.work, 12);
  }

  const truthyGuard = (() => 'yes') as unknown as (
    value: number,
  ) => value is number;
  const refinement = refineValue<number, number>({
    name: 'badGuard',
    path: ['guard'],
    guard: truthyGuard,
  }).run(13);
  assert.equal(refinement.ok, false);
  if (!refinement.ok) {
    assert.ok(refinement.result.error.cause instanceof TypeError);
    assert.equal(refinement.result.focus.value.location?.rule, 'badGuard');
    assert.deepEqual(refinement.result.focus.value.location?.path, ['guard']);
    assert.equal(refinement.result.focus.value.work, 13);
  }

  const audit = auditValue<number>([
    { name: 'prior', check: () => false },
    { name: 'badAudit', path: ['audit'], check: truthy },
  ]).run(14);
  assert.equal(audit.ok, false);
  if (!audit.ok) {
    assert.ok(audit.result.error.cause instanceof TypeError);
    assert.equal(audit.result.focus.value.location?.rule, 'badAudit');
    assert.deepEqual(audit.result.focus.value.location?.path, ['audit']);
    const checkpoint = audit.result.focus.value.work as {
      value: number;
      failures: { rule: string }[];
    };
    assert.equal(checkpoint.value, 14);
    assert.deepEqual(
      checkpoint.failures.map((issue) => issue.rule),
      ['prior'],
    );
  }
});

test('false and Invalid still follow expected data failure paths', () => {
  const invalidCheck = validateValue<number>([
    { name: 'named', check: () => new Invalid('specific', 'specific reason') },
  ]).run(1);
  assert.equal(invalidCheck.ok, false);
  if (!invalidCheck.ok)
    assert.equal(invalidCheck.result.error.code, 'specific');

  const invalidAudit = auditValue<number>([
    { name: 'named', check: () => new Invalid('specific', 'specific reason') },
  ]).run(1);
  assert.equal(invalidAudit.ok, false);
  if (!invalidAudit.ok) {
    assert.equal(invalidAudit.result.focus.value.issues[0]?.code, 'specific');
  }

  const falseGuard = refineValue<number, number>({
    name: 'falseGuard',
    guard: (n): n is number => n > 5,
  }).run(1);
  assert.equal(falseGuard.ok, false);
  if (!falseGuard.ok)
    assert.equal(falseGuard.result.error.code, 'refinement_failed');
});
