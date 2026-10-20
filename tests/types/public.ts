import {
  field,
  reshape,
  reshapeMany,
  select,
  type Batch,
  type Preset,
  type ReshapeDefinition,
  type Shape,
  type PredicateSelectDefinition,
  type SelectDefinition,
} from '@minamorl/berylx-presets';

declare const symbolKey: unique symbol;
type SymbolOutput = { [symbolKey]: string };

reshape<null, SymbolOutput>({
  name: 'unsupported-symbol',
  // @ts-expect-error Symbol keys cannot be silently ignored by shape traversal.
  fields: { [symbolKey]: field('symbol', () => 'value') },
});
reshape<null, readonly string[]>({
  name: 'unsupported-root-array',
  // @ts-expect-error Root arrays are not record-shaped outputs.
  fields: [],
});
reshape<null, () => string>({
  name: 'unsupported-root-function',
  // @ts-expect-error Root functions are not record-shaped outputs.
  fields: {},
});
reshape<null, { nested: SymbolOutput }>({
  name: 'unsupported-nested-symbol',
  fields: {
    // @ts-expect-error Nested symbol shape keys are also unsupported.
    nested: { [symbolKey]: field('symbol', () => 'value') },
  },
});
// @ts-expect-error Definitions cannot bypass the same root-array restriction.
export const arrayShape: Shape<null, string[]> = [];
export const records: ReshapeDefinition<
  null,
  { 0: string; nested: { list: readonly number[] } }
> = {
  name: 'records',
  fields: {
    0: field('zero', () => 'zero'),
    nested: { list: field<null, readonly number[]>('list', () => [1, 2]) },
  },
};
export const supported = reshape(records);
const inferred = reshape({
  name: 'inferred',
  fields: { value: field<unknown, number>('value', () => 1) },
}).run(null);
if (inferred.ok) inferred.value.value.toFixed();

type Member = { kind: 'member'; active: boolean };
type User = Member | { kind: 'guest' };
export const predicates: PredicateSelectDefinition<User, Member> = {
  name: 'members',
  guard: (user): user is Member => user.kind === 'member',
  rules: { active: (member) => member.active },
};
export const named: SelectDefinition<User, Member> = {
  name: 'members',
  guard: { name: 'member', test: predicates.guard },
  rules: [
    {
      name: 'active',
      test: (member) => member.active,
      code: 'inactive',
      message: 'inactive',
    },
  ],
};
export const namedPreset: Preset<
  readonly User[] | Batch<User>,
  Batch<Member>
> = select(named);
const convert = reshapeMany<string, Member>({
  name: 'convert',
  fields: {
    kind: field<string, 'member'>('kind', () => 'member'),
    active: field('active', (input) => input.length > 0),
  },
});
export const pipeline: Preset<readonly string[], Batch<Member>> = convert.then(
  select<Member>({
    name: 'active',
    rules: { active: (member) => member.active },
  }),
);
const result = pipeline.run(['ok']);
if (result.ok) {
  for (const item of result.value.accepted) {
    const kind: 'member' = item.value.kind;
    void kind;
  }
}
// @ts-expect-error A record output cannot feed a selection expecting an array/Batch.
supported.then(select<string>({ name: 'wrong', rules: {} }));
