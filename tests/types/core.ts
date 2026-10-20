import { field, invalid, type Batch, type Preset, type ReshapeDefinition, type SelectDefinition } from '../../src/index.js';
import { createPreset } from '../../src/internal/builder.js';

type Input = { text: string; age?: number };
type Output = { id: number; profile: { label: string }; age: number };

export const definition: ReshapeDefinition<Input, Output> = {
  name: 'person',
  fields: {
    id: field('id', (input) => /^\d+$/.test(input.text) ? Number(input.text) : invalid('id', 'invalid id')),
    profile: { label: field('label', (input) => input.text) },
    age: field('age', (input) => input.age, { default: 0 }),
  },
};

export const incomplete: ReshapeDefinition<Input, Output> = {
  name: 'missing',
  // @ts-expect-error Missing required age rule.
  fields: { id: field('id', () => 1), profile: { label: field('label', () => '') } },
};

export const mismatch: ReshapeDefinition<Input, Output> = {
  name: 'wrong', fields: {
    // @ts-expect-error String reader cannot supply a numeric field.
    id: field('id', (input) => input.text),
    profile: { label: field('label', () => '') }, age: field('age', () => 0),
  },
};

const parse = createPreset<string, number, string>({
  name: 'parse', prepare: (input) => input, rules: [], finish: (work) => Number(work),
});
const print = createPreset<number, string, number>({
  name: 'print', prepare: (input) => input, rules: [], finish: (work) => String(work),
});
export const composed: Preset<string, string> = parse.then(print);
// @ts-expect-error Number output cannot feed a string-input preset.
parse.then(parse);
// @ts-expect-error Input must remain string after composition.
composed.run(1);
const result = composed.run('1');
if (result.ok) {
  const value: string = result.value;
  value.toUpperCase();
  // @ts-expect-error Result value is not number.
  const wrong: number = result.value;
  void wrong;
} else {
  // @ts-expect-error Failure has no successful value.
  result.value;
}

const broad = createPreset<unknown, boolean, unknown>({
  name: 'broad', prepare: (input) => input, rules: [], finish: () => true,
});
export const wide: Preset<string, boolean> = parse.then(broad);

type Animal = { kind: 'cat'; lives: number } | { kind: 'dog'; trained: boolean };
type Cat = Extract<Animal, { kind: 'cat' }>;
export const cats: SelectDefinition<Animal, Cat> = {
  name: 'cats', guard: { name: 'cat', test: (value): value is Cat => value.kind === 'cat' },
  rules: [{ name: 'alive', test: (cat) => cat.lives > 0, code: 'dead', message: 'no lives' }],
};
// @ts-expect-error Narrowing without a guard would be unsound.
export const unsound: SelectDefinition<Animal, Cat> = { name: 'cats', rules: [] };
export const unchanged: SelectDefinition<Animal> = { name: 'all', rules: [] };
// @ts-expect-error A guard must narrow within the input union.
export type WrongGuard = SelectDefinition<Animal, string>;

declare const animals: Preset<string, Batch<Animal>>;
declare const catsOnly: Preset<readonly Animal[] | Batch<Animal>, Batch<Cat>>;
export const pipeline: Preset<string, Batch<Cat>> = animals.then(catsOnly);
// @ts-expect-error Animal batch cannot be consumed as a batch containing only cats.
animals.then(createPreset<Batch<Cat>, number, Batch<Cat>>({
  name: 'cat-count', prepare: (input) => input, rules: [], finish: (work) => work.accepted.length,
}));
