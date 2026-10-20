import assert from 'node:assert/strict';
import test from 'node:test';
import { EffectTree, Err, Graph, Ok, Sequence, Task } from '@minamorl/berylx';
import { field, invalid, Invalid } from '../src/index.js';
import { createPreset } from '../src/internal/builder.js';

test('compile and Graph expose native tasks without running callbacks', () => {
  const calls: string[] = [];
  const preset = createPreset<number, string, number>({
    name: 'convert',
    prepare: (input) => { calls.push('prepare'); return input; },
    rules: [
      { name: 'double', apply: (work) => { calls.push('double'); return work * 2; } },
      { name: 'increment', apply: (work) => { calls.push('increment'); return work + 1; } },
    ],
    finish: (work) => { calls.push('result'); return String(work); },
  });
  const compiled = preset.compile(3);
  assert.ok(compiled.node instanceof Sequence);
  assert.ok(compiled.node.steps.every((step) => step instanceof Task));
  assert.deepEqual(Graph.from(compiled.node).nodes(), [
    'convert:prepare', 'convert:double', 'convert:increment', 'convert:result',
  ]);
  assert.deepEqual(EffectTree.dryRun(compiled.node, compiled.initialState).steps,
    Graph.from(compiled.node).nodes());
  assert.deepEqual(calls, []);
  assert.equal(compiled.initialState.current, 3);
  const result = preset.run(3);
  assert.ok(result.ok);
  assert.equal(result.value, '7');
  assert.ok(result.result instanceof Ok);
  assert.deepEqual(calls, ['prepare', 'double', 'increment', 'result']);
});

test('then passes output as stage input, preserves root input and isolates runs', () => {
  const first = createPreset<number, { count: number }, number>({
    name: 'first', prepare: (input) => input, rules: [], finish: (work) => ({ count: work }),
  });
  const second = createPreset<{ count: number }, string, number>({
    name: 'second', prepare: (input) => input.count, rules: [], finish: (work) => `n=${work}`,
  });
  const composed = first.then(second);
  const result = composed.run(4);
  assert.ok(result.ok);
  assert.equal(result.value, 'n=4');
  assert.equal(result.result.focus.toObject().input, 4);
  assert.deepEqual(Graph.from(composed.compile(4).node).nodes(), [
    'first:prepare', 'first:result', 'second:prepare', 'second:result',
  ]);
  const again = composed.run(8);
  assert.ok(again.ok);
  assert.equal(again.value, 'n=8');
  assert.equal(result.result.focus.toObject().input, 4);
});

test('invalid retains partial work, issue path and failure node; later rules do not run', () => {
  let later = false;
  const preset = createPreset<string, number, { parsed: number }>({
    name: 'parse', prepare: () => ({ parsed: 0 }),
    rules: [
      { name: 'number', path: ['profile', 'age'], apply: (_work, context) => {
        context.checkpoint({ parsed: 12 });
        return invalid('negative', 'age must be positive');
      } },
      { name: 'later', apply: (work) => { later = true; return work; } },
    ],
    finish: (work) => work.parsed,
  });
  const outcome = preset.run('source');
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.ok(outcome.result instanceof Err);
  assert.equal(outcome.result.code, 'negative');
  assert.equal(outcome.result.failedNode, 'parse:number');
  assert.deepEqual(outcome.result.trace, ['parse:number']);
  assert.deepEqual(outcome.result.focus.toObject().work, { parsed: 12 });
  assert.deepEqual(outcome.result.focus.toObject().issues, [{
    rule: 'number', path: ['profile', 'age'], code: 'negative', message: 'age must be positive',
  }]);
  assert.equal(later, false);
});

test('unexpected exceptions retain checkpoint, input, location and original cause', () => {
  const cause = new RangeError('bad callback');
  const preset = createPreset<readonly number[], number[], readonly number[]>({
    name: 'batch', prepare: () => [],
    rules: [{ name: 'convert', apply: (_work, context) => {
      context.checkpoint([10]);
      context.locate({ index: 1, path: ['amount'] });
      throw cause;
    } }],
    finish: (work) => [...work],
  });
  const result = preset.run([1, 2]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.result.cause, cause);
  assert.equal(result.result.failedNode, 'batch:convert');
  const frame = result.result.focus.toObject();
  assert.deepEqual(frame.work, [10]);
  assert.deepEqual(frame.input, [1, 2]);
  assert.deepEqual(frame.location, { preset: 'batch', rule: 'convert', index: 1, path: ['amount'] });
  assert.deepEqual(result.result.error.metadata.location, frame.location);
});

test('input snapshot exceptions become native Err before any callback runs', () => {
  const cause = new Error('input getter failed');
  const input = { get amount(): number { throw cause; } };
  let called = false;
  const preset = createPreset<{ amount: number }, number, number>({
    name: 'snapshot', prepare: (value) => { called = true; return value.amount; },
    rules: [], finish: (value) => value,
  });
  assert.equal(preset.compile(input).initialState.input, input);
  const result = preset.run(input);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.result instanceof Err);
  assert.equal(result.result.cause, cause);
  assert.equal(result.result.failedNode, null);
  assert.equal(result.result.error.metadata.phase, 'input');
  assert.equal(result.result.focus.toObject().input, input);
  assert.equal(result.result.focus.toObject().work, undefined);
  assert.equal(called, false);
});

test('recoverable diagnostics survive composition; empty values are successful', () => {
  const issue = { rule: 'bad-row', path: [], code: 'skip', message: 'skip row' };
  const preset = createPreset<null, readonly number[], readonly number[]>({
    name: 'empty', prepare: (_input, context) => { context.issue(issue); return []; },
    rules: [], finish: (work) => work,
  });
  const next = createPreset<readonly number[], number, number>({
    name: 'count', prepare: (input) => input.length, rules: [], finish: (work) => work,
  });
  const outcome = preset.then(next).run(null);
  assert.ok(outcome.ok);
  assert.equal(outcome.value, 0);
  assert.deepEqual(outcome.result.focus.toObject().issues, [issue]);
});

test('async callback output is rejected instead of leaking a successful Promise', () => {
  const preset = createPreset<number, Promise<number>, number>({
    name: 'sync-only', prepare: (value) => value, rules: [], finish: (value) => Promise.resolve(value),
  });
  const result = preset.run(1);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.result.code, 'TypeError');
    assert.equal(result.result.failedNode, 'sync-only:result');
  }
});

test('field stores an immutable definition without evaluating reader or validations', () => {
  let calls = 0;
  const checks = [{ name: 'positive', check: (n: number) => {
    calls++; return n > 0 ? undefined : invalid('positive', 'must be positive');
  } }];
  const definition = field<string, number>('parse', (text) => { calls++; return Number(text); }, {
    default: 1, validate: checks,
  });
  checks.length = 0;
  assert.equal(calls, 0);
  assert.equal(definition.options.validate?.length, 1);
  assert.ok(Object.isFrozen(definition));
  assert.ok(invalid('code', 'message') instanceof Invalid);
});
