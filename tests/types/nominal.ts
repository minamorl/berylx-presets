import {
  field,
  reshape,
  reshapeMany,
  type Preset,
  type Shape,
} from '../../src/index.js';

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

type MustBeNever<T extends never> = T;
export type NoPrivateShape = MustBeNever<Shape<null, Nominal>>;
export type NoProtectedShape = MustBeNever<Shape<null, Protected>>;
export type NoPrivateFieldShape = MustBeNever<Shape<null, PrivateField>>;
export type NoConstructorShape = MustBeNever<
  Shape<null, new () => { value: number }>
>;

reshape<null, Nominal>({
  name: 'nominal',
  // @ts-expect-error Public value alone cannot create the private brand.
  fields: { value: field<null, number>('value', () => 1) },
});
reshapeMany<null, Nominal>({
  name: 'nominal-many',
  // @ts-expect-error Batch output must not claim private state either.
  fields: { value: field<null, number>('value', () => 1) },
});
reshape<null, Protected>({
  name: 'protected',
  // @ts-expect-error Protected members are absent from the public mapped view.
  fields: { value: field<null, number>('value', () => 1) },
});
reshape<null, PrivateField>({
  name: 'private-field',
  // @ts-expect-error ECMAScript private state cannot be assembled from public keys.
  fields: { value: field<null, number>('value', () => 1) },
});
reshape<null, { nested: Nominal }>({
  name: 'nested-nominal',
  fields: {
    // @ts-expect-error Nested shape assembly has the same private-state boundary.
    nested: { value: field<null, number>('value', () => 1) },
  },
});
reshape<null, new () => { value: number }>({
  name: 'constructor-only',
  // @ts-expect-error An empty record cannot implement a constructor signature.
  fields: {},
});
reshape<null, { new (): object; readonly value: number }>({
  name: 'constructor-and-property',
  // @ts-expect-error Public properties do not preserve construction signatures.
  fields: { value: field<null, number>('value', () => 1) },
});

interface RecordOutput {
  readonly value: number;
  readonly nested: { readonly values: readonly number[] };
  readonly optional?: string;
}
export const record: Preset<null, RecordOutput> = reshape<null, RecordOutput>({
  name: 'record',
  fields: {
    value: field('value', () => 1),
    nested: { values: field<null, readonly number[]>('values', () => [1, 2]) },
    optional: field<null, string | undefined>('optional', () => undefined, {
      default: undefined,
    }),
  },
});
export const batch = reshapeMany<null, RecordOutput>({
  name: 'record-many',
  fields: {
    value: field('value', () => 1),
    nested: { values: field<null, readonly number[]>('values', () => [1, 2]) },
    optional: field<null, string | undefined>('optional', () => undefined, {
      default: undefined,
    }),
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

// Whole-value fields supply actual nominal/constructor values instead of
// claiming that a public-key record assembled those hidden capabilities.
export const whole = reshape<
  null,
  { instance: Nominal; instances: readonly Nominal[]; factory: typeof Nominal }
>({
  name: 'whole',
  fields: {
    instance: field('instance', () => new Nominal(1)),
    instances: field<null, readonly Nominal[]>('instances', () => [
      new Nominal(1),
    ]),
    factory: field('factory', () => Nominal),
  },
});
