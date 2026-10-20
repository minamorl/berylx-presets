import {
  field,
  invalid,
  reshape,
  reshapeMany,
  select,
  type ReshapeDefinition,
} from '@minamorl/berylx-presets';
import type { Animal, Cat, Person, RawPerson } from './data.js';

const person: ReshapeDefinition<RawPerson, Person> = {
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

const single = reshape(person);
const many = reshapeMany(person);
const cats = select<Animal, Cat>({
  name: 'cats',
  guard: {
    name: 'cat',
    test: (animal): animal is Cat => animal.kind === 'cat',
  },
  rules: [
    {
      name: 'alive',
      test: (cat) => cat.lives > 0,
      code: 'no_lives',
      message: 'cat has no remaining lives',
    },
    {
      name: 'indoor',
      test: (cat) => cat.indoor,
      code: 'outdoor',
      message: 'cat must live indoors',
    },
  ],
});

export const reshapePersonPreset = (input: RawPerson) => single.run(input);
export const reshapePeoplePreset = (input: readonly RawPerson[]) =>
  many.run(input);
export const selectCatsPreset = (input: Parameters<typeof cats.run>[0]) =>
  cats.run(input);
