import assert from 'node:assert/strict';
import test from 'node:test';
import { EffectTree, Err, Graph, Ok, Sequence, Task } from '@minamorl/berylx';
import { field, type ReshapeDefinition } from '../src/definitions.js';
import { Invalid, invalid } from '../src/invalid.js';
import { reshape, reshapeMany } from '../src/reshape.js';
import {
  mixedPeople,
  throwingPeople,
  type Person,
  type RawPerson,
} from '../fixtures/data.js';
import {
  reshapePeopleReference,
  reshapePersonReference,
} from '../fixtures/handwritten.js';

const people: ReshapeDefinition<RawPerson, Person> = {
  name: 'person',
  fields: {
    id: field('parse_id', (input) =>
      /^\d+$/.test(input.id)
        ? Number(input.id)
        : invalid('invalid_id', 'id must contain digits'),
    ),
    profile: {
      label: field(
        'display_name',
        (input) => input.profile?.displayName?.trim(),
        {
          default: 'anonymous',
        },
      ),
    },
    age: field('age', (input) => input.age, {
      default: 0,
      validate: [
        {
          name: 'nonnegative',
          check: (age) =>
            age >= 0
              ? undefined
              : invalid('negative_age', 'age must be nonnegative'),
        },
      ],
    }),
    active: field('active', (input) => input.active),
  },
};

test('nested single/many reshapes match the handwritten fixture and preserve sources', () => {
  const result = reshapeMany(people).run(mixedPeople);
  const reference = reshapePeopleReference(mixedPeople);
  assert.ok(result.ok && reference.ok);
  assert.ok(result.result instanceof Ok);
  assert.deepEqual(result.value, reference.value);
  assert.deepEqual(result.result.focus.toObject().input, mixedPeople);
  assert.deepEqual(
    result.result.focus.toObject().issues,
    result.value.rejected.flatMap((row) => row.issues),
  );
  assert.deepEqual(
    result.value.accepted.map((row) => row.index),
    [0, 3],
  );
  assert.deepEqual(
    result.value.rejected.map((row) => row.index),
    [1, 2],
  );
  for (const input of mixedPeople) {
    const single = reshape(people).run(input);
    const expected = reshapePersonReference(input);
    assert.equal(single.ok, expected.ok);
    if (single.ok && expected.ok)
      assert.deepEqual(single.value, expected.value);
    if (!single.ok && !expected.ok) {
      assert.ok(single.result instanceof Err);
      assert.deepEqual(single.result.focus.toObject().issues, expected.issues);
      assert.deepEqual(
        single.result.focus.toObject().location,
        expected.location,
      );
    }
  }
  assert.equal(mixedPeople[0]?.profile?.displayName, ' Mina ');
});

test('native graph and dry run expose every depth-first rule without callbacks', () => {
  const calls: string[] = [];
  const definition: ReshapeDefinition<
    null,
    { first: { deep: number }; second: string }
  > = {
    name: 'tree',
    fields: {
      first: {
        deep: field(
          'read',
          () => {
            calls.push('read');
            return 2;
          },
          {
            validate: [
              {
                name: 'positive',
                check: () => {
                  calls.push('positive');
                },
              },
              {
                name: 'even',
                check: () => {
                  calls.push('even');
                },
              },
            ],
          },
        ),
      },
      second: field('last', () => {
        calls.push('last');
        return 'done';
      }),
    },
  };
  const preset = reshape(definition);
  const compiled = preset.compile(null);
  const compiledBatch = reshapeMany(definition).compile([null, null]);
  assert.ok(compiled.node instanceof Sequence);
  assert.ok(compiled.node.steps.every((node) => node instanceof Task));
  const names = [
    'tree:prepare',
    'tree:read',
    'tree:read/positive',
    'tree:read/even',
    'tree:last',
    'tree:result',
  ];
  assert.deepEqual(Graph.from(compiled.node).nodes(), names);
  assert.deepEqual(
    EffectTree.dryRun(compiled.node, compiled.initialState).steps,
    names,
  );
  assert.deepEqual(Graph.from(compiledBatch.node).nodes(), names);
  assert.deepEqual(
    EffectTree.dryRun(compiledBatch.node, compiledBatch.initialState).steps,
    names,
  );
  assert.deepEqual(calls, []);
  const native = compiled.node.call(compiled.initialState);
  assert.ok(native instanceof Ok);
  assert.deepEqual(native.focus.toObject().current, {
    first: { deep: 2 },
    second: 'done',
  });
  assert.deepEqual(calls, ['read', 'positive', 'even', 'last']);
});

test('defaults apply only to undefined, are validated, and preserve explicit undefined', () => {
  type Value = string | number | boolean | null;
  const seen: unknown[] = [];
  const preset = reshape<
    { value?: Value },
    { value: Value; optional?: string }
  >({
    name: 'defaults',
    fields: {
      value: field('value', (input) => input.value, {
        default: 'fallback',
        validate: [
          {
            name: 'observe',
            check: (value) => {
              seen.push(value);
            },
          },
        ],
      }),
      optional: field<{ value?: Value }, string | undefined>(
        'optional',
        () => undefined,
        {
          default: undefined,
        },
      ),
    },
  });
  for (const value of [null, false, 0, '', 'text']) {
    const outcome = preset.run({ value });
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.value, { value, optional: undefined });
    assert.ok(Object.hasOwn(outcome.value, 'optional'));
  }
  const outcome = preset.run({});
  assert.ok(outcome.ok);
  assert.deepEqual(outcome.value, { value: 'fallback', optional: undefined });
  assert.deepEqual(seen, [null, false, 0, '', 'text', 'fallback']);
});

test('missing and invalid defaults fail at their distinct field/validation tasks', () => {
  const missing = reshape<null, { nested: { value: string } }>({
    name: 'missing',
    fields: {
      nested: { value: field<null, string>('required', () => undefined) },
    },
  }).run(null);
  assert.ok(!missing.ok);
  assert.equal(missing.result.code, 'missing');
  assert.equal(missing.result.failedNode, 'missing:required');
  assert.deepEqual(missing.result.focus.toObject().issues, [
    {
      rule: 'required',
      path: ['nested', 'value'],
      code: 'missing',
      message: 'Value is required',
    },
  ]);
  const badDefault = reshape<null, { value: number }>({
    name: 'default',
    fields: {
      value: field('value', () => undefined, {
        default: -1,
        validate: [
          {
            name: 'positive',
            check: () => invalid('negative', 'must be positive'),
          },
        ],
      }),
    },
  }).run(null);
  assert.ok(!badDefault.ok);
  assert.equal(badDefault.result.failedNode, 'default:value/positive');
  assert.deepEqual(badDefault.result.focus.toObject().work, [
    {
      index: 0,
      input: null,
      value: { value: -1 },
      issues: [
        {
          rule: 'value/positive',
          path: ['value'],
          code: 'negative',
          message: 'must be positive',
        },
      ],
    },
  ]);
});

test('each row stops on its first data failure; rejection order follows the input', () => {
  const calls: string[] = [];
  const definition: ReshapeDefinition<number, { a: number; b: number }> = {
    name: 'ordered',
    fields: {
      a: field(
        'a',
        (value) => {
          calls.push(`a:${value}`);
          return value === 2 ? invalid('a', 'bad a') : value;
        },
        {
          validate: [
            {
              name: 'first',
              check: (value) => {
                calls.push(`first:${value}`);
                return value === 1 ? invalid('first', 'bad first') : undefined;
              },
            },
            {
              name: 'second',
              check: (value) => {
                calls.push(`second:${value}`);
              },
            },
          ],
        },
      ),
      b: field('b', (value) => {
        calls.push(`b:${value}`);
        return value * 10;
      }),
    },
  };
  const result = reshapeMany(definition).run([1, 2, 3]);
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.accepted.map((row) => row.value),
    [{ a: 3, b: 30 }],
  );
  assert.deepEqual(
    result.value.rejected.map((row) => [row.index, row.input, row.issues]),
    [
      [
        0,
        1,
        [{ rule: 'a/first', path: ['a'], code: 'first', message: 'bad first' }],
      ],
      [1, 2, [{ rule: 'a', path: ['a'], code: 'a', message: 'bad a' }]],
    ],
  );
  assert.deepEqual(calls, [
    'a:1',
    'a:2',
    'a:3',
    'first:1',
    'first:3',
    'second:3',
    'b:3',
  ]);
  calls.length = 0;
  const single = reshape(definition).run(1);
  assert.ok(!single.ok);
  assert.deepEqual(calls, ['a:1', 'first:1']);
  assert.deepEqual(single.result.trace, ['ordered:a/first']);
});

test('empty and all-invalid arrays succeed without later readers or validations', () => {
  const calls: number[] = [];
  const preset = reshapeMany<number, { id: number; later: number }>({
    name: 'none',
    fields: {
      id: field<number, number>(
        'reject',
        () => invalid('invalid', 'rejected'),
        {
          validate: [
            {
              name: 'unused',
              check: () => {
                assert.fail('rejected field must not be validated');
              },
            },
          ],
        },
      ),
      later: field('later', (input) => {
        calls.push(input);
        return input;
      }),
    },
  });
  const empty = preset.run([]);
  assert.ok(empty.ok);
  assert.deepEqual(empty.value, { accepted: [], rejected: [] });
  const none = preset.run([1, 2]);
  assert.ok(none.ok);
  assert.deepEqual(none.value.accepted, []);
  assert.deepEqual(
    none.value.rejected.map((row) => row.index),
    [0, 1],
  );
  assert.deepEqual(calls, []);
});

test('source exceptions retain rule-major partial values and exact fixture position', () => {
  const result = reshapeMany(people).run(throwingPeople);
  const reference = reshapePeopleReference(throwingPeople);
  assert.ok(!result.ok && !reference.ok);
  assert.equal(reference.kind, 'exception');
  assert.equal(result.result.failedNode, 'person:age');
  assert.deepEqual(result.result.focus.toObject().location, reference.location);
  assert.deepEqual(result.result.error.metadata.location, reference.location);
  assert.ok(result.result.cause instanceof Error);
  assert.equal(result.result.cause.message, 'age source unavailable');
  assert.deepEqual(result.result.focus.toObject().work, [
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
  assert.deepEqual(result.result.focus.toObject().input, throwingPeople);
});

test('single reader exceptions retain earlier values, source and nested location', () => {
  const cause = new Error('source failed');
  let later = false;
  const result = reshape<
    string,
    { id: number; profile: { label: string }; later: boolean }
  >({
    name: 'single',
    fields: {
      id: field('id', (input) => Number(input)),
      profile: {
        label: field<string, string>('label', () => {
          throw cause;
        }),
      },
      later: field('later', () => {
        later = true;
        return true;
      }),
    },
  }).run('12');
  assert.ok(!result.ok);
  assert.equal(result.result.cause, cause);
  assert.equal(result.result.failedNode, 'single:label');
  assert.deepEqual(result.result.focus.toObject().location, {
    preset: 'single',
    rule: 'label',
    path: ['profile', 'label'],
  });
  assert.deepEqual(result.result.focus.toObject().work, [
    {
      index: 0,
      input: '12',
      value: { id: 12, profile: {} },
      issues: [],
    },
  ]);
  assert.equal(result.result.focus.toObject().input, '12');
  assert.equal(later, false);
});

test('a validation exception preserves converted values and earlier row rejections', () => {
  const cause = new RangeError('validator unavailable');
  let later = false;
  const preset = reshapeMany<
    number,
    { nested: { value: number }; later: boolean }
  >({
    name: 'failure',
    fields: {
      nested: {
        value: field(
          'value',
          (value) => (value === 0 ? invalid('zero', 'zero is invalid') : value),
          {
            validate: [
              {
                name: 'check',
                check: (value) => {
                  if (value === 2) throw cause;
                },
              },
            ],
          },
        ),
      },
      later: field('later', () => {
        later = true;
        return true;
      }),
    },
  });
  const result = preset.run([0, 1, 2, 3]);
  assert.ok(!result.ok);
  assert.equal(result.result.cause, cause);
  assert.equal(result.result.failedNode, 'failure:value/check');
  assert.deepEqual(result.result.focus.toObject().location, {
    preset: 'failure',
    rule: 'value/check',
    path: ['nested', 'value'],
    index: 2,
  });
  const issue = {
    rule: 'value',
    path: ['nested', 'value'],
    code: 'zero',
    message: 'zero is invalid',
  };
  assert.deepEqual(result.result.focus.toObject().issues, [issue]);
  assert.deepEqual(result.result.focus.toObject().work, [
    { index: 0, input: 0, value: { nested: {} }, issues: [issue] },
    ...[1, 2, 3].map((value) => ({
      index: value,
      input: value,
      value: { nested: { value } },
      issues: [],
    })),
  ]);
  assert.equal(later, false);
});

test('throwing Invalid is fatal rather than a recoverable rejected row', () => {
  const cause = invalid('thrown', 'not a returned data failure');
  assert.ok(cause instanceof Invalid);
  let calls = 0;
  const result = reshapeMany<number, { value: number }>({
    name: 'throw',
    fields: {
      value: field<number, number>('value', () => {
        calls++;
        throw cause;
      }),
    },
  }).run([1, 2]);
  assert.ok(!result.ok);
  assert.equal(result.result.cause, cause);
  assert.deepEqual(result.result.focus.toObject().issues, []);
  assert.equal(calls, 1);
});

test('Promise and thenable readers/validators become whole-workflow Err', () => {
  const asyncValues: readonly unknown[] = [Promise.resolve(1), { then() {} }];
  for (const value of asyncValues) {
    const definition: ReshapeDefinition<null, { value: unknown }> = {
      name: 'sync',
      fields: { value: field('read', () => value) },
    };
    for (const result of [
      reshape(definition).run(null),
      reshapeMany(definition).run([null]),
    ]) {
      assert.ok(!result.ok);
      assert.equal(result.result.code, 'TypeError');
      assert.equal(result.result.failedNode, 'sync:read');
      assert.deepEqual(result.result.focus.toObject().issues, []);
    }
    const check: () => void = () => value; // void-return callbacks can discard arbitrary values.
    const validation: ReshapeDefinition<null, { value: number }> = {
      name: 'sync',
      fields: {
        value: field('read', () => 1, {
          validate: [{ name: 'check', check }],
        }),
      },
    };
    for (const result of [
      reshape(validation).run(null),
      reshapeMany(validation).run([null]),
    ]) {
      assert.ok(!result.ok);
      assert.equal(result.result.code, 'TypeError');
      assert.equal(result.result.failedNode, 'sync:read/check');
      assert.deepEqual(result.result.focus.toObject().issues, []);
      assert.deepEqual(result.result.focus.toObject().work, [
        {
          index: 0,
          input: null,
          value: { value: 1 },
          issues: [],
        },
      ]);
    }
  }
});

test('whole-value arrays/functions and empty nested objects are assembled unchanged', () => {
  const fn = (value: number) => value + 1;
  const result = reshape<
    null,
    { list: readonly number[]; fn: typeof fn; empty: object }
  >({
    name: 'values',
    fields: {
      list: field<null, readonly number[]>('list', () => [1, 2]),
      fn: field('function', () => fn),
      empty: {},
    },
  }).run(null);
  assert.ok(result.ok);
  assert.deepEqual(result.value.list, [1, 2]);
  assert.equal(result.value.fn, fn);
  assert.deepEqual(result.value.empty, {});
});

test('own enumerable string keys and special output names do not pollute prototypes', () => {
  const fields: Record<PropertyKey, unknown> = Object.create({
    inherited: field('unused', () => {
      assert.fail('inherited');
    }),
  });
  Object.defineProperty(fields, '__proto__', {
    enumerable: true,
    value: field('safe', () => 1),
  });
  Object.defineProperty(fields, 'hidden', {
    enumerable: false,
    value: field('unused', () => {
      assert.fail('hidden');
    }),
  });
  fields[Symbol('ignored')] = field('unused', () => {
    assert.fail('symbol');
  });
  const result = reshape<null, object>({ name: 'keys', fields }).run(null);
  assert.ok(result.ok);
  assert.deepEqual(Object.keys(result.value), ['__proto__']);
  assert.equal(
    Object.getOwnPropertyDescriptor(result.value, '__proto__')?.value,
    1,
  );
  assert.equal(Object.getPrototypeOf(result.value), Object.prototype);
});

test('preset reuse isolates work and typed composition feeds the next original input', () => {
  const first = reshape<string, { value: number }>({
    name: 'parse',
    fields: { value: field('number', (input) => Number(input)) },
  });
  const second = reshape<{ value: number }, { nested: { text: string } }>({
    name: 'format',
    fields: { nested: { text: field('text', (input) => String(input.value)) } },
  });
  const pipeline = first.then(second);
  const one = pipeline.run('1');
  const two = pipeline.run('2');
  assert.ok(one.ok && two.ok);
  assert.deepEqual(one.value, { nested: { text: '1' } });
  assert.deepEqual(two.value, { nested: { text: '2' } });
  assert.equal(one.result.focus.toObject().input, '1');
});
