import { invalid } from '../../src/invalid.js';
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
} from '../../src/relation-patterns.js';
import type { Batch } from '../../src/types.js';

type Item = { id: number; amount: number };
const input: Batch<Item> = {
  accepted: [
    { index: 3, input: { id: 1, amount: 4 }, value: { id: 1, amount: 4 } },
  ],
  rejected: [],
};

// The complete import/config example in docs/relation-patterns.md is checked here.
const total = fold<Item, number>({
  seed: () => 0,
  steps: [{ name: 'sum', apply: (sum, item) => sum + item.amount }],
});
const totalResult = total.run(input);
const totalOutput: number | undefined = totalResult.ok
  ? totalResult.value.value
  : undefined;
void totalOutput;
const cumulative = scan<Item, number>({
  seed: () => 0,
  name: 'sum',
  apply: (sum, item) => sum + item.amount,
});
const history = cumulative.run(input);
if (history.ok) {
  const n: number | undefined = history.value.accepted[0]?.value;
  void n;
}

const byId = lookupJoin<Item, Item, number>({
  leftKey: (item) => item.id,
  rightKey: (item) => item.id,
});
const joined = byId.run({ left: input, right: [{ id: 1, amount: 5 }] });
if (joined.ok) {
  const side: 'right' | undefined = joined.value.accepted[0]?.right.source;
  void side;
}
const many = joinMany<Item, Item, number>({
  leftKey: (item) => item.id,
  rightKey: (item) => item.id,
});
const manyResult = many.run({ left: input, right: [] });
if (manyResult.ok) {
  const origin: number | undefined =
    manyResult.value.accepted[0]?.left.origin.index;
  void origin;
}
const zipped = zipStrict<Item, Item>().run({ left: input, right: input });
if (zipped.ok) {
  const source: 'left' | undefined = zipped.value.accepted[0]?.left.source;
  void source;
}
const comparison = reconcile<Item, Item, number>({
  leftKey: (item) => item.id,
  rightKey: (item) => item.id,
  equal: (a, b) => a.amount === b.amount,
});
const compared = comparison.run({ left: input, right: input });
if (compared.ok) {
  const amount: number | undefined =
    compared.value.unchanged[0]?.left.origin.value.amount;
  void amount;
}

const selected = choose<Item, string>([
  {
    name: 'nonzero',
    when: (item) => item.amount > 0,
    apply: (item) => String(item.amount),
  },
]);
const recovered = fallback<Item, string>([
  { name: 'lookup', apply: () => invalid('missing', 'missing') },
  { name: 'render', apply: (item) => String(item.amount) },
]);
const projected = fanout<Item, number>([
  { name: 'id', apply: (item) => item.id },
  { name: 'amount', apply: (item) => item.amount },
]);
const chain = selected.then(
  fanout<{ input: Item; branch: string; value: string }, number>([
    { name: 'length', apply: (item) => item.value.length },
  ]),
);
void recovered;
void projected;
void chain;

// @ts-expect-error source values must have the declared Item shape
total.run([{ id: 'wrong', amount: 1 }]);
fold<Item, number>({
  seed: () => 0,
  // @ts-expect-error reducer output must match accumulator type
  steps: [{ name: 'wrong', apply: () => 'not a number' }],
});
// @ts-expect-error a string output cannot feed an Item input
selected.then(total);
lookupJoin<Item, Item, number>({
  leftKey: (item) => item.id,
  // @ts-expect-error rightKey must return the same key type as leftKey
  rightKey: (item) => String(item.id),
});
reconcile<Item, Item, number>({
  leftKey: (item) => item.id,
  rightKey: (item) => item.id,
  // @ts-expect-error comparison must return boolean or Invalid
  equal: () => 'same',
});
