import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fallbackResult,
  labelResult,
  salesResult,
} from '../examples/patterns.js';

test('cross-family Batch pipeline preserves transformed values and source positions', () => {
  assert.equal(salesResult.ok, true);
  if (!salesResult.ok) assert.fail('sales pipeline returned Err');
  assert.deepEqual(salesResult.value, {
    accepted: [
      {
        index: 1,
        input: { id: 'b', cents: 450 },
        value: { id: 'b', cents: 450 },
      },
      {
        index: 0,
        input: { id: ' a ', cents: 120 },
        value: { id: 'a', cents: 120 },
      },
    ],
    rejected: [],
  });
});

test('join names both sources and retains origins', () => {
  assert.equal(labelResult.ok, true);
  if (!labelResult.ok) assert.fail('join returned Err');
  assert.deepEqual(labelResult.value, {
    accepted: [
      {
        left: {
          source: 'left',
          origin: {
            index: 0,
            input: { id: 'a', cents: 120 },
            value: { id: 'a', cents: 120 },
          },
        },
        right: {
          source: 'right',
          origin: {
            index: 0,
            input: { id: 'a', label: 'first' },
            value: { id: 'a', label: 'first' },
          },
        },
      },
    ],
    unmatched: [],
    rejected: [],
  });
});

test('fallback records the explicit data failure before choosing the next branch', () => {
  assert.equal(fallbackResult.ok, true);
  if (!fallbackResult.ok) assert.fail('fallback returned Err');
  assert.deepEqual(fallbackResult.value, {
    input: 'a',
    branch: 'source',
    value: 'label:a',
    failures: [
      { branch: 'cache', code: 'cache_miss', message: 'No cached label' },
    ],
  });
});
