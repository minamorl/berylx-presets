import type { Invalid } from './invalid.js';

export const FIELD: unique symbol = Symbol('berylx-presets.field');

export interface Validation<T> {
  readonly name: string;
  /** Return invalid(...) for expected failure, undefined for success. */
  readonly check: (value: T) => Invalid | void;
}

export interface FieldOptions<T> {
  /** Only undefined triggers the default; null never does. */
  readonly default?: T;
  readonly validate?: readonly Validation<T>[];
}

export interface Field<I, T> {
  readonly [FIELD]: true;
  readonly name: string;
  readonly read: (input: I) => T | undefined | Invalid;
  readonly options: FieldOptions<T>;
}

/** Defines a field; neither the reader nor validations execute here. */
export function field<I, T>(
  name: string,
  read: (input: I) => T | undefined | Invalid,
  options: FieldOptions<T> = {},
): Field<I, T> {
  return Object.freeze({
    [FIELD]: true as const,
    name,
    read,
    options: Object.freeze({
      ...options,
      ...(options.validate ? { validate: Object.freeze([...options.validate]) } : {}),
    }),
  });
}

type NestedField<I, T> = T extends readonly unknown[]
  ? never
  : T extends (...args: never[]) => unknown
    ? never
    : T extends object
      ? Shape<I, T>
      : never;

/** Every declared key, including optional ones, needs an explicit field rule. */
export type Shape<I, O> = {
  readonly [K in keyof O]-?: Field<I, O[K]> | NestedField<I, O[K]>;
};

export interface ReshapeDefinition<I, O extends object> {
  readonly name: string;
  readonly fields: Shape<I, O>;
}

export interface NamedGuard<I, N extends I> {
  readonly name: string;
  readonly test: (value: I) => value is N;
}

export interface SelectionRule<T> {
  readonly name: string;
  /** true accepts, false uses code/message, invalid(...) supplies its own reason. */
  readonly test: (value: T) => boolean | Invalid;
  readonly code: string;
  readonly message: string;
}

/** Narrowing requires a guard unless the input already satisfies the output. */
export type SelectDefinition<I, N extends I = I> = {
  readonly name: string;
  readonly rules: readonly SelectionRule<N>[];
} & ([I] extends [N]
  ? { readonly guard?: NamedGuard<I, N> }
  : { readonly guard: NamedGuard<I, N> });
