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

// Installed-package root surface: every added factory and the guard alias.
import {
  mapValue as pattern30_mapValue,
  mapAccepted as pattern30_mapAccepted,
  expandAccepted as pattern30_expandAccepted,
  validateValue as pattern30_validateValue,
  refineValue as pattern30_refineValue,
  auditValue as pattern30_auditValue,
  countAccepted as pattern30_countAccepted,
  acceptedValues as pattern30_acceptedValues,
  issueReport as pattern30_issueReport,
  groupBy as pattern30_groupBy,
  indexBy as pattern30_indexBy,
  deduplicate as pattern30_deduplicate,
  orderBy as pattern30_orderBy,
  paginate as pattern30_paginate,
  partition as pattern30_partition,
  route as pattern30_route,
  chunk as pattern30_chunk,
  window as pattern30_window,
  fold as pattern30_fold,
  scan as pattern30_scan,
  lookupJoin as pattern30_lookupJoin,
  joinMany as pattern30_joinMany,
  zipStrict as pattern30_zipStrict,
  reconcile as pattern30_reconcile,
  choose as pattern30_choose,
  fallback as pattern30_fallback,
  fanout as pattern30_fanout,
  type NamedGuard as Pattern30LegacyGuard,
  type RefinementGuard as Pattern30RefinementGuard,
} from '@minamorl/berylx-presets';

void [
  pattern30_mapValue,
  pattern30_expandAccepted,
  pattern30_validateValue,
  pattern30_refineValue,
  pattern30_auditValue,
  pattern30_acceptedValues,
  pattern30_issueReport,
  pattern30_groupBy,
  pattern30_indexBy,
  pattern30_deduplicate,
  pattern30_paginate,
  pattern30_partition,
  pattern30_route,
  pattern30_chunk,
  pattern30_window,
  pattern30_fold,
  pattern30_scan,
  pattern30_lookupJoin,
  pattern30_joinMany,
  pattern30_zipStrict,
  pattern30_reconcile,
  pattern30_choose,
  pattern30_fallback,
  pattern30_fanout,
];

interface Pattern30Row {
  readonly id: string;
  readonly amount: number;
}

const pattern30_pipeline = pattern30_mapAccepted<Pattern30Row, Pattern30Row>({
  name: 'copy-installed',
  transform: (row) => ({ id: row.id, amount: row.amount }),
})
  .then(
    pattern30_orderBy<Pattern30Row>({
      keys: [{ name: 'amount', key: (row) => row.amount }],
    }),
  )
  .then(pattern30_countAccepted<Pattern30Row>({ min: 1 }));
pattern30_pipeline.run([{ id: 'one', amount: 1 }]);

const pattern30_guard: Pattern30RefinementGuard<
  Pattern30Row | null,
  Pattern30Row
> = {
  name: 'present',
  guard: (row): row is Pattern30Row => row !== null,
};
const pattern30_legacyGuard: Pattern30LegacyGuard<
  Pattern30Row | null,
  Pattern30Row
> = {
  name: 'present',
  test: (row): row is Pattern30Row => row !== null,
};
pattern30_refineValue(pattern30_guard);
void pattern30_legacyGuard;

pattern30_pipeline.then(
  // @ts-expect-error a string-input preset cannot follow a Batch<Pattern30Row>
  pattern30_mapAccepted<string, string>({
    name: 'text',
    transform: (value) => value,
  }),
);

pattern30_mapAccepted<Pattern30Row, number>({
  name: 'wrong-output',
  // @ts-expect-error the declared numeric output cannot be a string
  transform: (row) => row.id,
});
