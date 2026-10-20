import {
  createPreset,
  assertSync,
  type StageRule,
} from './internal/builder.js';
import { Invalid, invalid } from './invalid.js';
import type { Preset } from './preset.js';
import type { Batch, Rejected, SelectionInput } from './types.js';

/** A position always belongs to a named input, never to an invented output row. */
export interface Origin<T> {
  readonly index: number;
  readonly input: unknown;
  readonly value: T;
}
export interface Sourced<T, S extends string> {
  readonly source: S;
  readonly origin: Origin<T>;
}
export interface SourcedRejection<S extends string> {
  readonly source: S;
  readonly rejection: Rejected;
}

function rows<T>(input: SelectionInput<T>): {
  accepted: readonly Origin<T>[];
  rejected: readonly Rejected[];
} {
  if (Array.isArray(input))
    return {
      accepted: input.map((value, index) => ({ index, input: value, value })),
      rejected: [],
    };
  const batch = input as Batch<T>;
  return {
    accepted: batch.accepted.map(({ index, input: original, value }) => ({
      index,
      input: original,
      value,
    })),
    rejected: [...batch.rejected],
  };
}
function checked<T>(value: T): T {
  assertSync(value);
  return value;
}
function checkedBoolean(value: unknown): boolean | Invalid {
  assertSync(value);
  if (value instanceof Invalid) return value;
  if (typeof value !== 'boolean')
    throw new TypeError('Predicate must return boolean or Invalid');
  return value;
}
function locate<T>(
  context: {
    locate(position: {
      readonly index?: number;
      readonly path?: readonly (string | number)[];
    }): void;
    checkpoint(work: T): void;
  },
  work: T,
  index?: number,
  path?: readonly (string | number)[],
): void {
  context.locate({
    ...(index === undefined ? {} : { index }),
    ...(path === undefined ? {} : { path }),
  });
  context.checkpoint(work);
}
type Rule<W> = StageRule<W>;

export interface FoldStep<T, A> {
  readonly name: string;
  readonly apply: (accumulator: A, value: T, origin: Origin<T>) => A | Invalid;
}
export interface FoldOutput<T, A> {
  readonly value: A;
  readonly sources: readonly Origin<T>[];
  readonly rejected: readonly Rejected[];
}
/** Fold accepted rows in order; a failed step is a whole Err. */
export function fold<T, A>(definition: {
  readonly seed: () => A | Invalid;
  readonly steps: readonly FoldStep<T, A>[];
}): Preset<SelectionInput<T>, FoldOutput<T, A>> {
  const steps = [...definition.steps];
  type Work = {
    input: SelectionInput<T>;
    rows: readonly Origin<T>[];
    rejected: readonly Rejected[];
    value?: A;
  };
  const rules: Rule<Work>[] = [
    {
      name: 'seed',
      apply(work, context) {
        locate(context, work);
        const value = checked(definition.seed());
        if (value instanceof Invalid) return value;
        return { ...work, value };
      },
    },
    ...steps.map((step): Rule<Work> => ({
      name: step.name,
      apply(work, context) {
        let value = work.value as A;
        for (const row of work.rows) {
          locate(context, { ...work, value }, row.index);
          const next = checked(step.apply(value, row.value, row));
          if (next instanceof Invalid) return next;
          value = next;
        }
        return { ...work, value };
      },
    })),
  ];
  return createPreset<SelectionInput<T>, FoldOutput<T, A>, Work>({
    name: 'fold',
    prepare(input) {
      const part = rows(input);
      return { input, rows: part.accepted, rejected: part.rejected };
    },
    rules,
    finish(work) {
      return {
        value: work.value as A,
        sources: work.rows,
        rejected: work.rejected,
      };
    },
  });
}

export interface ScanOutput<T, A> {
  readonly accepted: readonly {
    readonly origin: Origin<T>;
    readonly value: A;
  }[];
  readonly rejected: readonly Rejected[];
}
/** Emit one cumulative value per accepted source row. */
export function scan<T, A>(definition: {
  readonly seed: () => A | Invalid;
  readonly name: string;
  readonly apply: (accumulator: A, value: T, origin: Origin<T>) => A | Invalid;
}): Preset<SelectionInput<T>, ScanOutput<T, A>> {
  type Work = {
    rows: readonly Origin<T>[];
    rejected: readonly Rejected[];
    value?: A;
    history: { origin: Origin<T>; value: A }[];
  };
  return createPreset<SelectionInput<T>, ScanOutput<T, A>, Work>({
    name: 'scan',
    prepare(input) {
      const part = rows(input);
      return { rows: part.accepted, rejected: part.rejected, history: [] };
    },
    rules: [
      {
        name: 'seed',
        apply(work, context) {
          locate(context, work);
          const value = checked(definition.seed());
          if (value instanceof Invalid) return value;
          return { ...work, value };
        },
      },
      {
        name: definition.name,
        apply(work, context) {
          let value = work.value as A;
          const history = [...work.history];
          for (const row of work.rows) {
            locate(context, { ...work, value, history }, row.index);
            const next = checked(definition.apply(value, row.value, row));
            if (next instanceof Invalid) return next;
            value = next;
            history.push({ origin: row, value });
          }
          return { ...work, value, history };
        },
      },
    ],
    finish(work) {
      return { accepted: work.history, rejected: work.rejected };
    },
  });
}

type PairInput<L, R> = {
  readonly left: SelectionInput<L>;
  readonly right: SelectionInput<R>;
};
type PairRejection = SourcedRejection<'left' | 'right'>;
function pair<L, R>(input: PairInput<L, R>) {
  const left = rows(input.left);
  const right = rows(input.right);
  return {
    left: left.accepted,
    right: right.accepted,
    rejected: [
      ...left.rejected.map((rejection) => ({
        source: 'left' as const,
        rejection,
      })),
      ...right.rejected.map((rejection) => ({
        source: 'right' as const,
        rejection,
      })),
    ],
  };
}
export interface JoinRow<L, R> {
  readonly left: Sourced<L, 'left'>;
  readonly right: Sourced<R, 'right'>;
}
export interface JoinOutput<L, R> {
  readonly accepted: readonly JoinRow<L, R>[];
  readonly unmatched: readonly Sourced<L, 'left'>[];
  readonly rejected: readonly PairRejection[];
}
/** One-to-one left lookup join; duplicate right keys are invalid. */
export function lookupJoin<L, R, K>(definition: {
  readonly leftKey: (value: L) => K | Invalid;
  readonly rightKey: (value: R) => K | Invalid;
}): Preset<PairInput<L, R>, JoinOutput<L, R>> {
  type Work = ReturnType<typeof pair<L, R>> & {
    leftKeys?: readonly K[];
    rightKeys?: readonly K[];
    output?: JoinOutput<L, R>;
  };
  return createPreset<PairInput<L, R>, JoinOutput<L, R>, Work>({
    name: 'lookupJoin',
    prepare(input) {
      return pair(input);
    },
    rules: [
      {
        name: 'rightKey',
        apply(work: Work, context) {
          const keys: K[] = [];
          const seen = new Set<K>();
          for (const row of work.right) {
            locate(context, { ...work, rightKeys: [...keys] }, row.index, [
              'right',
            ]);
            const key = checked(definition.rightKey(row.value));
            if (key instanceof Invalid) return key;
            if (seen.has(key))
              return invalid(
                'duplicate_key',
                'Right lookup key occurs more than once',
              );
            seen.add(key);
            keys.push(key);
          }
          return { ...work, rightKeys: keys };
        },
      },
      {
        name: 'leftKey',
        apply(work: Work, context) {
          const keys: K[] = [];
          for (const row of work.left) {
            locate(context, { ...work, leftKeys: [...keys] }, row.index, [
              'left',
            ]);
            const key = checked(definition.leftKey(row.value));
            if (key instanceof Invalid) return key;
            keys.push(key);
          }
          return { ...work, leftKeys: keys };
        },
      },
      {
        name: 'match',
        apply(work: Work) {
          const byKey = new Map(
            (work.rightKeys as K[]).map((key, i) => [key, work.right[i]!]),
          );
          const accepted: JoinRow<L, R>[] = [];
          const unmatched: Sourced<L, 'left'>[] = [];
          work.left.forEach((row, i) => {
            const right = byKey.get((work.leftKeys as K[])[i]!);
            const left = { source: 'left' as const, origin: row };
            if (right)
              accepted.push({
                left,
                right: { source: 'right', origin: right },
              });
            else unmatched.push(left);
          });
          return {
            ...work,
            output: { accepted, unmatched, rejected: work.rejected },
          };
        },
      },
    ],
    finish(work: Work) {
      return work.output as JoinOutput<L, R>;
    },
  });
}

export interface JoinManyRow<L, R> {
  readonly left: Sourced<L, 'left'>;
  readonly rights: readonly Sourced<R, 'right'>[];
}
export interface JoinManyOutput<L, R> {
  readonly accepted: readonly JoinManyRow<L, R>[];
  readonly rejected: readonly PairRejection[];
}
/** One-to-many left join, retaining rows with zero matches. */
export function joinMany<L, R, K>(definition: {
  readonly leftKey: (value: L) => K | Invalid;
  readonly rightKey: (value: R) => K | Invalid;
}): Preset<PairInput<L, R>, JoinManyOutput<L, R>> {
  type Work = ReturnType<typeof pair<L, R>> & {
    keys?: Map<K, readonly Origin<R>[]>;
    output?: JoinManyOutput<L, R>;
  };
  return createPreset<PairInput<L, R>, JoinManyOutput<L, R>, Work>({
    name: 'joinMany',
    prepare(input) {
      return pair(input);
    },
    rules: [
      {
        name: 'rightKey',
        apply(work: Work, context) {
          const keys = new Map<K, readonly Origin<R>[]>();
          for (const row of work.right) {
            locate(context, { ...work, keys: new Map(keys) }, row.index, [
              'right',
            ]);
            const key = checked(definition.rightKey(row.value));
            if (key instanceof Invalid) return key;
            keys.set(key, [...(keys.get(key) ?? []), row]);
          }
          return { ...work, keys };
        },
      },
      {
        name: 'leftKey',
        apply(work: Work, context) {
          const accepted: JoinManyRow<L, R>[] = [];
          for (const row of work.left) {
            locate(
              context,
              {
                ...work,
                output: { accepted: [...accepted], rejected: work.rejected },
              },
              row.index,
              ['left'],
            );
            const key = checked(definition.leftKey(row.value));
            if (key instanceof Invalid) return key;
            accepted.push({
              left: { source: 'left', origin: row },
              rights: (work.keys?.get(key) ?? []).map((origin) => ({
                source: 'right',
                origin,
              })),
            });
          }
          return { ...work, output: { accepted, rejected: work.rejected } };
        },
      },
    ],
    finish(work: Work) {
      return work.output as JoinManyOutput<L, R>;
    },
  });
}

export interface ZipOutput<L, R> {
  readonly accepted: readonly JoinRow<L, R>[];
  readonly rejected: readonly PairRejection[];
}
/** Zip accepted rows by accepted order, failing on a length mismatch. */
export function zipStrict<L, R>(): Preset<PairInput<L, R>, ZipOutput<L, R>> {
  type Work = ReturnType<typeof pair<L, R>> & { output?: ZipOutput<L, R> };
  return createPreset<PairInput<L, R>, ZipOutput<L, R>, Work>({
    name: 'zipStrict',
    prepare(input) {
      return pair(input);
    },
    rules: [
      {
        name: 'equalLength',
        apply(work: Work) {
          return work.left.length === work.right.length
            ? work
            : invalid('length_mismatch', 'Accepted input lengths differ');
        },
      },
      {
        name: 'pair',
        apply(work: Work) {
          return {
            ...work,
            output: {
              accepted: work.left.map((origin, i) => ({
                left: { source: 'left', origin },
                right: { source: 'right', origin: work.right[i]! },
              })),
              rejected: work.rejected,
            },
          };
        },
      },
    ],
    finish(work: Work) {
      return work.output as ZipOutput<L, R>;
    },
  });
}

export interface ReconcileOutput<L, R> {
  readonly added: readonly Sourced<R, 'right'>[];
  readonly removed: readonly Sourced<L, 'left'>[];
  readonly changed: readonly JoinRow<L, R>[];
  readonly unchanged: readonly JoinRow<L, R>[];
  readonly rejected: readonly PairRejection[];
}
/** Compare unique keys; duplicate keys on either side are invalid. */
export function reconcile<L, R, K>(definition: {
  readonly leftKey: (value: L) => K | Invalid;
  readonly rightKey: (value: R) => K | Invalid;
  readonly equal: (left: L, right: R) => boolean | Invalid;
}): Preset<PairInput<L, R>, ReconcileOutput<L, R>> {
  type Work = ReturnType<typeof pair<L, R>> & {
    leftMap?: Map<K, Origin<L>>;
    rightMap?: Map<K, Origin<R>>;
    output?: ReconcileOutput<L, R>;
  };
  return createPreset<PairInput<L, R>, ReconcileOutput<L, R>, Work>({
    name: 'reconcile',
    prepare(input) {
      return pair(input);
    },
    rules: [
      {
        name: 'leftKey',
        apply(work: Work, context) {
          const leftMap = new Map<K, Origin<L>>();
          for (const row of work.left) {
            locate(context, { ...work, leftMap: new Map(leftMap) }, row.index, [
              'left',
            ]);
            const key = checked(definition.leftKey(row.value));
            if (key instanceof Invalid) return key;
            if (leftMap.has(key))
              return invalid('duplicate_key', 'Left key occurs more than once');
            leftMap.set(key, row);
          }
          return { ...work, leftMap };
        },
      },
      {
        name: 'rightKey',
        apply(work: Work, context) {
          const rightMap = new Map<K, Origin<R>>();
          for (const row of work.right) {
            locate(
              context,
              { ...work, rightMap: new Map(rightMap) },
              row.index,
              ['right'],
            );
            const key = checked(definition.rightKey(row.value));
            if (key instanceof Invalid) return key;
            if (rightMap.has(key))
              return invalid(
                'duplicate_key',
                'Right key occurs more than once',
              );
            rightMap.set(key, row);
          }
          return { ...work, rightMap };
        },
      },
      {
        name: 'equal',
        apply(work: Work, context) {
          const added: Sourced<R, 'right'>[] = [];
          const removed: Sourced<L, 'left'>[] = [];
          const changed: JoinRow<L, R>[] = [];
          const unchanged: JoinRow<L, R>[] = [];
          for (const [key, leftOrigin] of work.leftMap!) {
            const rightOrigin = work.rightMap!.get(key);
            if (!rightOrigin) {
              removed.push({ source: 'left', origin: leftOrigin });
              continue;
            }
            locate(
              context,
              {
                ...work,
                output: {
                  added: [...added],
                  removed: [...removed],
                  changed: [...changed],
                  unchanged: [...unchanged],
                  rejected: work.rejected,
                },
              },
              leftOrigin.index,
              ['left', 'right'],
            );
            const same = checkedBoolean(
              definition.equal(leftOrigin.value, rightOrigin.value),
            );
            if (same instanceof Invalid) return same;
            (same ? unchanged : changed).push({
              left: { source: 'left', origin: leftOrigin },
              right: { source: 'right', origin: rightOrigin },
            });
          }
          for (const [key, origin] of work.rightMap!)
            if (!work.leftMap!.has(key))
              added.push({ source: 'right', origin });
          return {
            ...work,
            output: {
              added,
              removed,
              changed,
              unchanged,
              rejected: work.rejected,
            },
          };
        },
      },
    ],
    finish(work: Work) {
      return work.output as ReconcileOutput<L, R>;
    },
  });
}

export interface Choice<I, O> {
  readonly name: string;
  readonly when: (input: I) => boolean | Invalid;
  readonly apply: (input: I) => O | Invalid;
}
/** First matching branch wins. Unselected branch bodies never run. */
export function choose<I, O>(
  definitions: readonly Choice<I, O>[],
): Preset<
  I,
  { readonly input: I; readonly branch: string; readonly value: O }
> {
  const branches = [...definitions];
  type Work = { input: I; selected?: number; value?: O };
  const rules: Rule<Work>[] = branches.flatMap(
    (branch, index): Rule<Work>[] => [
      {
        name: `${branch.name}.when`,
        apply(work, context) {
          if (work.selected !== undefined) return work;
          locate(context, work);
          const result = checkedBoolean(branch.when(work.input));
          if (result instanceof Invalid) return result;
          return result ? { ...work, selected: index } : work;
        },
      },
      {
        name: `${branch.name}.apply`,
        apply(work, context) {
          if (work.selected !== index) return work;
          locate(context, work);
          const value = checked(branch.apply(work.input));
          return value instanceof Invalid ? value : { ...work, value };
        },
      },
    ],
  );
  return createPreset<
    I,
    { readonly input: I; readonly branch: string; readonly value: O },
    Work
  >({
    name: 'choose',
    prepare(input) {
      return { input };
    },
    rules,
    finish(work) {
      return work.selected === undefined
        ? invalid('no_match', 'No choice matched')
        : {
            input: work.input,
            branch: branches[work.selected]!.name,
            value: work.value as O,
          };
    },
  });
}

export interface Fallback<I, O> {
  readonly name: string;
  readonly apply: (input: I) => O | Invalid;
}
export interface FallbackFailure {
  readonly branch: string;
  readonly code: string;
  readonly message: string;
}
/** Only explicit Invalid advances to the next fallback. */
export function fallback<I, O>(
  definitions: readonly Fallback<I, O>[],
): Preset<
  I,
  {
    readonly input: I;
    readonly branch: string;
    readonly value: O;
    readonly failures: readonly FallbackFailure[];
  }
> {
  const branches = [...definitions];
  type Work = {
    input: I;
    selected?: string;
    value?: O;
    failures: FallbackFailure[];
  };
  return createPreset<
    I,
    {
      readonly input: I;
      readonly branch: string;
      readonly value: O;
      readonly failures: readonly FallbackFailure[];
    },
    Work
  >({
    name: 'fallback',
    prepare(input) {
      return { input, failures: [] };
    },
    rules: branches.map((branch): Rule<Work> => ({
      name: branch.name,
      apply(work, context) {
        if (work.selected !== undefined) return work;
        locate(context, work);
        const result = checked(branch.apply(work.input));
        return result instanceof Invalid
          ? {
              ...work,
              failures: [
                ...work.failures,
                {
                  branch: branch.name,
                  code: result.code,
                  message: result.message,
                },
              ],
            }
          : { ...work, selected: branch.name, value: result };
      },
    })),
    finish(work) {
      return work.selected === undefined
        ? invalid('all_fallbacks_failed', 'Every fallback returned Invalid')
        : {
            input: work.input,
            branch: work.selected,
            value: work.value as O,
            failures: work.failures,
          };
    },
  });
}

export interface FanoutBranch<I, O> {
  readonly name: string;
  readonly apply: (input: I) => O | Invalid;
}
/** Evaluate every named branch in order; duplicate names are invalid. */
export function fanout<I, O>(
  definitions: readonly FanoutBranch<I, O>[],
): Preset<
  I,
  { readonly input: I; readonly values: Readonly<Record<string, O>> }
> {
  const branches = [...definitions];
  type Work = { input: I; values: Record<string, O> };
  return createPreset<
    I,
    { readonly input: I; readonly values: Readonly<Record<string, O>> },
    Work
  >({
    name: 'fanout',
    prepare(input) {
      return { input, values: {} };
    },
    rules: [
      {
        name: 'uniqueNames',
        apply(work: Work) {
          return new Set(branches.map((branch) => branch.name)).size ===
            branches.length
            ? work
            : invalid('duplicate_branch', 'Fanout branch names must be unique');
        },
      },
      ...branches.map((branch): Rule<Work> => ({
        name: branch.name,
        apply(work, context) {
          locate(context, work);
          const value = checked(branch.apply(work.input));
          return value instanceof Invalid
            ? value
            : { ...work, values: { ...work.values, [branch.name]: value } };
        },
      })),
    ],
    finish(work: Work) {
      return { input: work.input, values: work.values };
    },
  });
}
