import type { SelectDefinition, SelectionRule } from './definitions.js';
import {
  assertSync,
  createPreset,
  type StageRule,
} from './internal/builder.js';
import { Invalid } from './invalid.js';
import type { Preset } from './preset.js';
import type {
  Accepted,
  Batch,
  Issue,
  Rejected,
  SelectionInput,
} from './types.js';

export type SelectionPredicate<T> = (value: T) => boolean | Invalid;

export interface GuardFailure {
  readonly code: string;
  readonly message: string;
}

/**
 * Record keys name conditions. false produces condition_failed / "<key> did not
 * match"; invalid(...) preserves its explicit code/message. A direct guard is
 * named "guard" and defaults to guard_failed / "guard did not match".
 * guardFailure overrides the direct guard's reason, not its task name.
 */
export type PredicateSelectDefinition<I, N extends I = I> = {
  readonly name: string;
  readonly rules: Readonly<Record<string, SelectionPredicate<N>>>;
  readonly guardFailure?: GuardFailure;
} & ([I] extends [N]
  ? { readonly guard?: (value: I) => value is N }
  : { readonly guard: (value: I) => value is N });

interface Row<I> {
  readonly entry: Accepted<I>;
  readonly issue: Issue | null;
}

interface SelectionWork<I> {
  readonly rows: readonly Row<I>[];
  readonly rejected: readonly Rejected[];
}

function condition<I, T extends I>(
  rule: SelectionRule<T>,
  guard = false,
): StageRule<SelectionWork<I>> {
  return {
    name: rule.name,
    apply(work, context) {
      let next = work;
      for (const [position, row] of work.rows.entries()) {
        if (row.issue !== null) continue;
        context.locate({ index: row.entry.index, path: [] });
        // Only conditions after a successful guard use the narrower T. Without
        // a guard, the public definition requires I to already satisfy T.
        const result = rule.test(row.entry.value as T);
        assertSync(result);
        if (
          typeof result !== 'boolean' &&
          (guard || !(result instanceof Invalid))
        ) {
          throw new TypeError(
            'Selection callbacks must return boolean' +
              (guard ? '' : ' or Invalid'),
          );
        }
        if (result !== true) {
          const issue: Issue = {
            rule: rule.name,
            path: [],
            code: result instanceof Invalid ? result.code : rule.code,
            message: result instanceof Invalid ? result.message : rule.message,
          };
          next = {
            ...next,
            rows: next.rows.map((current, index) =>
              index === position ? { ...current, issue } : current,
            ),
          };
          context.issue(issue);
        }
        context.checkpoint(next);
      }
      return next;
    },
  };
}

export function select<I, N extends I = I>(
  definition: SelectDefinition<I, N>,
): Preset<SelectionInput<I>, Batch<N>>;
export function select<I, N extends I = I>(
  definition: PredicateSelectDefinition<I, N>,
): Preset<SelectionInput<I>, Batch<N>>;
export function select<I, N extends I = I>(
  definition: SelectDefinition<I, N> | PredicateSelectDefinition<I, N>,
): Preset<SelectionInput<I>, Batch<N>> {
  const rules: StageRule<SelectionWork<I>>[] = [];
  const guard = definition.guard;
  if (guard) {
    const direct = typeof guard === 'function';
    const name = direct ? 'guard' : guard.name;
    const reason =
      'guardFailure' in definition ? definition.guardFailure : undefined;
    rules.push(
      condition<I, I>(
        {
          name,
          test: direct ? guard : guard.test,
          code: reason?.code ?? 'guard_failed',
          message: reason?.message ?? `${name} did not match`,
        },
        true,
      ),
    );
  }
  if (Array.isArray(definition.rules)) {
    for (const rule of definition.rules)
      rules.push(condition<I, N>({ ...rule }));
  } else {
    // Array.isArray does not narrow readonly arrays out of this union. This is
    // the local dynamic-definition boundary; named arrays took the branch above.
    const predicates = definition.rules as Readonly<
      Record<string, SelectionPredicate<N>>
    >;
    for (const [name, test] of Object.entries(predicates)) {
      rules.push(
        condition<I, N>({
          name,
          test,
          code: 'condition_failed',
          message: `${name} did not match`,
        }),
      );
    }
  }

  return createPreset<SelectionInput<I>, Batch<N>, SelectionWork<I>>({
    name: definition.name,
    prepare(input) {
      const batch: Batch<I> =
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
      return {
        rows: batch.accepted.map((entry) => ({ entry, issue: null })),
        rejected: batch.rejected,
      };
    },
    rules,
    finish(work) {
      const accepted: Accepted<N>[] = [];
      const rejected = [...work.rejected];
      for (const { entry, issue } of work.rows) {
        if (issue === null) {
          // The guard task has checked every surviving entry; this is the sole
          // successful output-narrowing boundary (I already extends N otherwise).
          accepted.push(entry as Accepted<N>);
        } else {
          rejected.push({
            index: entry.index,
            input: entry.input,
            issues: [issue],
          });
        }
      }
      return { accepted, rejected };
    },
  });
}
