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

declare class Nominal {
  private readonly brand: true;
  readonly value: number;
  constructor(value: number);
}
declare class Protected {
  protected readonly brand: true;
  readonly value: number;
}
declare class PrivateField {
  #brand: true;
  readonly value: number;
}
reshape<null, Nominal>({
  name: 'nominal',
  // @ts-expect-error Installed declarations must reject the original private-brand counterexample.
  fields: { value: field<null, number>('value', () => 1) },
});
reshapeMany<null, Protected>({
  name: 'protected',
  // @ts-expect-error Batch output cannot create hidden protected state.
  fields: { value: field<null, number>('value', () => 1) },
});
reshape<null, PrivateField>({
  name: 'private-field',
  // @ts-expect-error ECMAScript private fields must not disappear during assembly.
  fields: { value: field<null, number>('value', () => 1) },
});
reshape<null, { nested: Nominal }>({
  name: 'nested-nominal',
  fields: {
    // @ts-expect-error Nested nominal output also requires a whole-value reader.
    nested: { value: field<null, number>('value', () => 1) },
  },
});
reshape<null, new () => { value: number }>({
  name: 'constructor-only',
  // @ts-expect-error Installed declarations must reject constructor-only root output.
  fields: {},
});
reshape<null, { new (): object; readonly value: number }>({
  name: 'constructor-property',
  // @ts-expect-error A constructor signature cannot be implemented by public fields.
  fields: { value: field<null, number>('value', () => 1) },
});
interface PlainRecord {
  readonly value: number;
  readonly nested: { readonly items: readonly number[] };
}
export const record: Preset<null, PlainRecord> = reshape<null, PlainRecord>({
  name: 'record',
  fields: {
    value: field('value', () => 1),
    nested: { items: field<null, readonly number[]>('items', () => [1, 2]) },
  },
});
export const indexed: Preset<null, Record<string, number>> = reshape<
  null,
  Record<string, number>
>({
  name: 'indexed',
  fields: { only: field('only', () => 1) },
});
const inferred = reshape({
  name: 'inferred',
  fields: { value: field<unknown, number>('value', () => 1) },
}).run(null);
if (inferred.ok) inferred.value.value.toFixed();
export const whole = reshape<
  null,
  { instance: Nominal; instances: readonly Nominal[] }
>({
  name: 'whole',
  fields: {
    instance: field('instance', () => new Nominal(1)),
    instances: field<null, readonly Nominal[]>('instances', () => [
      new Nominal(1),
    ]),
  },
});
