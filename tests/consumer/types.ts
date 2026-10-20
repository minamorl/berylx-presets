import { Root } from '@minamorl/berylx';
import {
  field,
  invalid,
  reshape,
  reshapeMany,
  select,
  type Batch,
  type Preset,
  type PredicateSelectDefinition,
  type SelectDefinition,
  type ReshapeDefinition,
} from '@minamorl/berylx-presets';

type Member = { kind: 'member'; active: boolean; emailVerified: boolean };
type User = Member | { kind: 'guest' };
declare const users: readonly User[];
const result = select<User, Member>({
  name: 'members',
  guard: (user): user is Member => user.kind === 'member',
  rules: {
    active: (member) => member.active || invalid('inactive', '利用停止中'),
    verified: (member) =>
      member.emailVerified || invalid('unverified', 'メール未確認'),
  },
}).run(users);
if (result.ok) {
  const value: Batch<Member> = result.value;
  value.accepted.forEach((row) => row.value.emailVerified);
}
export const predicates: PredicateSelectDefinition<User, Member> = {
  name: 'members',
  guard: (user): user is Member => user.kind === 'member',
  rules: {},
};
export const named: SelectDefinition<User, Member> = {
  name: 'members',
  guard: { name: 'member', test: predicates.guard },
  rules: [],
};
export const namedPreset = select(named);
type Converted = { id: number; profile: { label: string }; active: boolean };
export const definition: ReshapeDefinition<string, Converted> = {
  name: 'convert',
  fields: {
    id: field('id', (input) => Number(input)),
    profile: { label: field('label', (input) => input) },
    active: field('active', (input) => input.length > 0),
  },
};
const single: Preset<string, Converted> = reshape(definition);
const pipeline = reshapeMany(definition).then(
  select<Converted>({
    name: 'active',
    rules: { active: (value) => value.active },
  }),
);
const compiled = pipeline.compile(['1']);
Root.of(compiled.initialState).pipe(compiled.node);
// @ts-expect-error A single record cannot feed array/Batch selection.
single.then(select<Converted>({ name: 'bad', rules: {} }));
// @ts-expect-error Narrowing requires a guard through installed declarations too.
select<User, Member>({ name: 'bad', rules: {} });
reshape<string, Converted>({
  name: 'bad',
  // @ts-expect-error Required profile and active rules are missing.
  fields: { id: field('id', (input) => Number(input)) },
});
declare const key: unique symbol;
reshape<null, { [key]: string }>({
  name: 'bad',
  // @ts-expect-error Symbol output shapes are unsupported.
  fields: { [key]: field('symbol', () => '') },
});
reshape<null, string[]>({
  name: 'bad',
  // @ts-expect-error Root arrays are unsupported.
  fields: [],
});
