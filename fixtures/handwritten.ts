import type {
  Batch,
  Issue,
  Location,
  SelectionInput,
} from '@minamorl/berylx-presets';
import type { Animal, Cat, Person, RawPerson } from './data.js';

export type ReferenceResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly kind: 'invalid' | 'exception';
      readonly issues: readonly Issue[];
      readonly partial: unknown;
      readonly location: Location;
      readonly cause?: unknown;
    };

/** Ordinary application code: explicit conversion, defaults, checks and partial state. */
export function reshapePersonReference(
  input: RawPerson,
): ReferenceResult<Person> {
  const partial: {
    id?: number;
    profile?: { label: string };
    age?: number;
    active?: boolean;
  } = {};
  let location: Location = { preset: 'person', rule: 'parse_id', path: ['id'] };
  try {
    if (!/^\d+$/.test(input.id))
      return {
        ok: false,
        kind: 'invalid',
        partial,
        location,
        issues: [
          {
            rule: 'parse_id',
            path: ['id'],
            code: 'invalid_id',
            message: 'id must contain digits',
          },
        ],
      };
    const id = Number(input.id);
    partial.id = id;
    location = {
      preset: 'person',
      rule: 'display_name',
      path: ['profile', 'label'],
    };
    const label = input.profile?.displayName?.trim() ?? 'anonymous';
    partial.profile = { label };
    location = { preset: 'person', rule: 'age', path: ['age'] };
    const rawAge = input.age;
    const age = rawAge === undefined ? 0 : rawAge;
    partial.age = age;
    location = { preset: 'person', rule: 'age/nonnegative', path: ['age'] };
    if (!(age >= 0))
      return {
        ok: false,
        kind: 'invalid',
        partial,
        location,
        issues: [
          {
            rule: 'age/nonnegative',
            path: ['age'],
            code: 'negative_age',
            message: 'age must be nonnegative',
          },
        ],
      };
    location = { preset: 'person', rule: 'active', path: ['active'] };
    const active = input.active;
    partial.active = active;
    return { ok: true, value: { id, profile: { label }, age, active } };
  } catch (cause) {
    return {
      ok: false,
      kind: 'exception',
      partial,
      location,
      cause,
      issues: [],
    };
  }
}

export function reshapePeopleReference(
  input: readonly RawPerson[],
): ReferenceResult<Batch<Person>> {
  const accepted: Batch<Person>['accepted'][number][] = [];
  const rejected: Batch<Person>['rejected'][number][] = [];
  for (const [index, original] of input.entries()) {
    const result = reshapePersonReference(original);
    if (result.ok) {
      accepted.push({ index, input: original, value: result.value });
    } else if (result.kind === 'invalid') {
      rejected.push({ index, input: original, issues: result.issues });
    } else {
      return {
        ...result,
        partial: { accepted, rejected, current: result.partial },
        location: { ...result.location, index },
      };
    }
  }
  return { ok: true, value: { accepted, rejected } };
}

/** Named first-failure conditions and a real union type guard. */
export function selectCatsReference(
  input: SelectionInput<Animal>,
): ReferenceResult<Batch<Cat>> {
  const batch: Batch<Animal> =
    'accepted' in input
      ? input
      : {
          accepted: input.map((value, index) => ({
            index,
            input: value,
            value,
          })),
          rejected: [],
        };
  const accepted: Batch<Cat>['accepted'][number][] = [];
  const rejected = [...batch.rejected];
  let location: Location = { preset: 'cats', rule: 'prepare', path: [] };
  const isCat = (animal: Animal): animal is Cat => animal.kind === 'cat';
  try {
    for (const item of batch.accepted) {
      location = { preset: 'cats', rule: 'cat', path: [], index: item.index };
      const value = item.value;
      let issue: Issue | undefined;
      if (!isCat(value)) {
        issue = {
          rule: 'cat',
          path: [],
          code: 'guard_failed',
          message: 'cat did not match',
        };
      } else {
        location = { ...location, rule: 'alive' };
        if (!(value.lives > 0)) {
          issue = {
            rule: 'alive',
            path: [],
            code: 'no_lives',
            message: 'cat has no remaining lives',
          };
        } else {
          location = { ...location, rule: 'indoor' };
          if (!value.indoor)
            issue = {
              rule: 'indoor',
              path: [],
              code: 'outdoor',
              message: 'cat must live indoors',
            };
        }
        if (!issue) accepted.push({ ...item, value });
      }
      if (issue)
        rejected.push({
          index: item.index,
          input: item.input,
          issues: [issue],
        });
    }
    return { ok: true, value: { accepted, rejected } };
  } catch (cause) {
    return {
      ok: false,
      kind: 'exception',
      partial: { accepted, rejected },
      location,
      cause,
      issues: [],
    };
  }
}
