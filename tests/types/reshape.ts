import { field, type ReshapeDefinition } from '../../src/definitions.js';
import { invalid } from '../../src/invalid.js';
import type { Preset } from '../../src/preset.js';
import { reshape, reshapeMany } from '../../src/reshape.js';
import type { Batch } from '../../src/types.js';

type Input = { readonly id: string; readonly age?: number };
type Output = { readonly id: number; readonly profile: { readonly label: string }; readonly age: number };

export const valid: ReshapeDefinition<Input, Output> = {
  name: 'person', fields: {
    id: field('id', (input) => /^\d+$/.test(input.id) ? Number(input.id) : invalid('id', 'invalid')),
    profile: { label: field('label', (input) => input.id) },
    age: field('age', (input) => input.age, { default: 0, validate: [
      { name: 'positive', check: (age) => age >= 0 ? undefined : invalid('age', 'invalid') },
    ] }),
  },
};

export const single: Preset<Input, Output> = reshape(valid);
export const many: Preset<readonly Input[], Batch<Output>> = reshapeMany(valid);
const next = reshape<Output, { display: string }>({
  name: 'display', fields: { display: field('display', (person) => `${person.profile.label}:${person.age}`) },
});
export const composed: Preset<Input, { display: string }> = single.then(next);
const result = composed.run({ id: '1' });
if (result.ok) {
  result.value.display.toUpperCase();
  // @ts-expect-error Typed output is not numeric.
  const numeric: number = result.value.display;
  void numeric;
}
const batch = many.run([{ id: '1' }]);
if (batch.ok) {
  for (const row of batch.value.accepted) {
    row.value.profile.label.toUpperCase();
    row.value.id.toFixed();
  }
}

reshape<Input, Output>({
  name: 'missing',
  // @ts-expect-error Every output key must have a rule.
  fields: { id: field('id', () => 1), profile: { label: field('label', () => '') } },
});
reshapeMany<Input, Output>({
  name: 'wrong', fields: {
    // @ts-expect-error Explicit conversion to number is required.
    id: field('id', (input) => input.id),
    profile: { label: field('label', () => '') }, age: field('age', () => 0),
  },
});
reshape<Input, Output>({
  name: 'nested', fields: {
    id: field('id', () => 1),
    // @ts-expect-error Nested required label cannot be omitted.
    profile: {},
    age: field('age', () => 0),
  },
});
reshape<null, { optional?: string }>({
  name: 'optional',
  // @ts-expect-error Optional properties still require an explicit rule.
  fields: {},
});
export const optional = reshape<null, { optional?: string }>({
  name: 'optional', fields: { optional: field<null, string | undefined>('optional', () => undefined, {
    default: undefined,
  }) },
});
reshape<null, { count: number }>({
  name: 'default', fields: {
    // @ts-expect-error Default and reader must match the output type.
    count: field('count', () => 1, { default: '1' }),
  },
});
// @ts-expect-error Incompatible output/input types cannot compose.
single.then(single);
// @ts-expect-error A batch cannot feed a single-output-record consumer.
many.then(next);
// @ts-expect-error Input records must have a string id.
many.run([{ id: 1 }]);
// @ts-expect-error Reshape outputs are objects.
reshape<string, number>({ name: 'primitive', fields: {} });

export const wholeValues = reshape<null, { values: readonly number[]; fn: () => string }>({
  name: 'whole', fields: {
    values: field<null, readonly number[]>('values', () => [1, 2]), fn: field('fn', () => () => 'value'),
  },
});
reshape<null, { values: readonly number[] }>({
  name: 'array', fields: {
    // @ts-expect-error Arrays require a whole-value field.
    values: {},
  },
});
