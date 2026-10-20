import {
  createPreset,
  assertSync,
  type StageRule,
} from './internal/builder.js';
import { Invalid } from './invalid.js';
import type { Preset } from './preset.js';
import type {
  Accepted,
  Batch,
  Issue,
  Path,
  Rejected,
  SelectionInput,
} from './types.js';

export interface NamedTransform<I, O> {
  readonly name: string;
  readonly path?: Path;
  readonly transform: (value: I) => O | Invalid;
}

export interface NamedCheck<T> {
  readonly name: string;
  readonly path?: Path;
  readonly check: (value: T) => boolean | Invalid;
}

export interface NamedGuard<T, U extends T> {
  readonly name: string;
  readonly path?: Path;
  readonly guard: (value: T) => value is U;
}

export interface CountBounds {
  readonly min?: number;
  readonly max?: number;
}

export interface ReportIssue {
  readonly index: number;
  readonly input: unknown;
  readonly rule: string;
  readonly path: Path;
  readonly code: string;
  readonly message: string;
}

export interface IssueReport<T> {
  readonly accepted: readonly Accepted<T>[];
  readonly rejected: readonly Rejected[];
  readonly issues: readonly ReportIssue[];
}

const copyPath = (path?: Path): Path => (path ? [...path] : []);
const issueFor = (name: string, path: Path, failure: Invalid): Issue => ({
  rule: name,
  path: [...path],
  code: failure.code,
  message: failure.message,
});

function snapshotBatch<T>(input: SelectionInput<T>): Batch<T> {
  if (Array.isArray(input)) {
    return {
      accepted: input.map((value, index) => ({ index, input: value, value })),
      rejected: [],
    };
  }
  const batch = input as Batch<T>;
  return {
    accepted: batch.accepted.map((row) => ({ ...row })),
    rejected: batch.rejected.map((row) => ({
      ...row,
      issues: row.issues.map((issue) => ({ ...issue, path: [...issue.path] })),
    })),
  };
}

export function mapValue<I, O>(definition: NamedTransform<I, O>): Preset<I, O> {
  const name = definition.name;
  const path = copyPath(definition.path);
  const transform = definition.transform;
  return createPreset<I, O, { readonly value: unknown }>({
    name: 'mapValue',
    prepare: (input) => ({ value: input }),
    rules: [
      {
        name,
        path,
        apply: (work, context) => {
          context.locate({ path });
          context.checkpoint(work);
          const value = transform(work.value as I);
          assertSync(value);
          return value instanceof Invalid ? value : { value };
        },
      },
    ],
    finish: (work) => work.value as O,
  });
}

interface BatchWork<I, O> {
  readonly source: Batch<I>;
  readonly accepted: readonly Accepted<O>[];
  readonly rejected: readonly Rejected[];
}

function batchTransform<I, O>(
  stageName: string,
  definition: NamedTransform<I, O | readonly O[]>,
  expand: boolean,
): Preset<SelectionInput<I>, Batch<O>> {
  const name = definition.name;
  const path = copyPath(definition.path);
  const transform = definition.transform;
  return createPreset<SelectionInput<I>, Batch<O>, BatchWork<I, O>>({
    name: stageName,
    prepare: (input) => ({
      source: snapshotBatch(input),
      accepted: [],
      rejected: [],
    }),
    rules: [
      {
        name,
        path,
        apply: (work, context) => {
          const accepted: Accepted<O>[] = [...work.accepted];
          const rejected: Rejected[] = [...work.rejected];
          for (const row of work.source.accepted) {
            context.locate({ index: row.index, path });
            context.checkpoint({
              ...work,
              accepted: [...accepted],
              rejected: [...rejected],
            });
            const value = transform(row.value);
            assertSync(value);
            if (value instanceof Invalid) {
              const issue = issueFor(name, path, value);
              context.issue(issue);
              rejected.push({
                index: row.index,
                input: row.input,
                issues: [issue],
              });
            } else if (expand) {
              for (const item of value as readonly O[]) {
                accepted.push({
                  index: row.index,
                  input: row.input,
                  value: item,
                });
              }
            } else {
              accepted.push({
                index: row.index,
                input: row.input,
                value: value as O,
              });
            }
          }
          return { source: work.source, accepted, rejected };
        },
      },
    ],
    finish: (work) => ({
      accepted: work.accepted,
      rejected: [...work.source.rejected, ...work.rejected],
    }),
  });
}

export function mapAccepted<I, O>(
  definition: NamedTransform<I, O>,
): Preset<SelectionInput<I>, Batch<O>> {
  return batchTransform<I, O>('mapAccepted', definition, false);
}

export function expandAccepted<I, O>(
  definition: NamedTransform<I, readonly O[]>,
): Preset<SelectionInput<I>, Batch<O>> {
  return batchTransform<I, O>('expandAccepted', definition, true);
}

export function validateValue<T>(
  rules: readonly NamedCheck<T>[],
): Preset<T, T> {
  const snapshot = rules.map((rule) => ({
    ...rule,
    path: copyPath(rule.path),
  }));
  return createPreset<T, T, T>({
    name: 'validateValue',
    prepare: (input) =>
      snapshot.length === 0
        ? new Invalid('empty_rules', 'at least one validation rule is required')
        : input,
    rules: snapshot.map(({ name, path, check }): StageRule<T> => ({
      name,
      path,
      apply: (value, context) => {
        context.locate({ path });
        context.checkpoint(value);
        const result = check(value);
        assertSync(result);
        if (result instanceof Invalid) return result;
        if (typeof result !== 'boolean') {
          throw new TypeError(`${name} must return a boolean or Invalid`);
        }
        return result
          ? value
          : new Invalid('validation_failed', `${name} failed`);
      },
    })),
    finish: (value) => value,
  });
}

export function refineValue<T, U extends T>(
  definition: NamedGuard<T, U>,
): Preset<T, U> {
  const name = definition.name;
  const path = copyPath(definition.path);
  const guard = definition.guard;
  return createPreset<T, U, T>({
    name: 'refineValue',
    prepare: (input) => input,
    rules: [
      {
        name,
        path,
        apply: (value, context) => {
          context.locate({ path });
          context.checkpoint(value);
          const passed = guard(value);
          assertSync(passed);
          if (typeof passed !== 'boolean') {
            throw new TypeError(`${name} must return a boolean`);
          }
          return passed
            ? value
            : new Invalid('refinement_failed', `${name} failed`);
        },
      },
    ],
    finish: (value) => value as U,
  });
}

interface AuditWork<T> {
  readonly value: T;
  readonly failures: readonly Issue[];
}

export function auditValue<T>(rules: readonly NamedCheck<T>[]): Preset<T, T> {
  const snapshot = rules.map((rule) => ({
    ...rule,
    path: copyPath(rule.path),
  }));
  return createPreset<T, T, AuditWork<T>>({
    name: 'auditValue',
    prepare: (input) =>
      snapshot.length === 0
        ? new Invalid('empty_rules', 'at least one audit rule is required')
        : { value: input, failures: [] },
    rules: snapshot.map(({ name, path, check }): StageRule<AuditWork<T>> => ({
      name,
      path,
      apply: (work, context) => {
        context.locate({ path });
        context.checkpoint(work);
        const result = check(work.value);
        assertSync(result);
        if (result === true) return work;
        if (!(result instanceof Invalid) && result !== false) {
          throw new TypeError(`${name} must return a boolean or Invalid`);
        }
        const failure =
          result instanceof Invalid
            ? result
            : new Invalid('validation_failed', `${name} failed`);
        const issue = issueFor(name, path, failure);
        context.issue(issue);
        return { ...work, failures: [...work.failures, issue] };
      },
    })),
    finish: (work) =>
      work.failures.length === 0
        ? work.value
        : new Invalid('audit_failed', `${work.failures.length} rule(s) failed`),
  });
}

export function countAccepted<T>(
  bounds: CountBounds,
): Preset<SelectionInput<T>, Batch<T>> {
  const min = bounds.min;
  const max = bounds.max;
  const rules: StageRule<Batch<T>>[] = [];
  if (min !== undefined)
    rules.push({
      name: 'minAccepted',
      apply: (batch, context) => {
        context.checkpoint(batch);
        return batch.accepted.length >= min
          ? batch
          : new Invalid(
              'too_few_accepted',
              `expected at least ${min} accepted value(s)`,
            );
      },
    });
  if (max !== undefined)
    rules.push({
      name: 'maxAccepted',
      apply: (batch, context) => {
        context.checkpoint(batch);
        return batch.accepted.length <= max
          ? batch
          : new Invalid(
              'too_many_accepted',
              `expected at most ${max} accepted value(s)`,
            );
      },
    });
  return createPreset<SelectionInput<T>, Batch<T>, Batch<T>>({
    name: 'countAccepted',
    prepare: (input) => {
      if (
        (min === undefined && max === undefined) ||
        (min !== undefined && (!Number.isSafeInteger(min) || min < 0)) ||
        (max !== undefined && (!Number.isSafeInteger(max) || max < 0)) ||
        (min !== undefined && max !== undefined && min > max)
      ) {
        return new Invalid(
          'invalid_bounds',
          'count bounds must be nonnegative safe integers with min <= max',
        );
      }
      return snapshotBatch(input);
    },
    rules,
    finish: (batch) => batch,
  });
}

export function acceptedValues<T>(): Preset<SelectionInput<T>, readonly T[]> {
  return createPreset<SelectionInput<T>, readonly T[], Batch<T>>({
    name: 'acceptedValues',
    prepare: snapshotBatch,
    rules: [{ name: 'extractAccepted', apply: (batch) => batch }],
    finish: (batch) => batch.accepted.map((row) => row.value),
  });
}

export function issueReport<T>(): Preset<SelectionInput<T>, IssueReport<T>> {
  return createPreset<SelectionInput<T>, IssueReport<T>, Batch<T>>({
    name: 'issueReport',
    prepare: snapshotBatch,
    rules: [{ name: 'collectIssues', apply: (batch) => batch }],
    finish: (batch) => ({
      accepted: batch.accepted,
      rejected: batch.rejected,
      issues: batch.rejected.flatMap((row) =>
        row.issues.map((issue) => ({
          index: row.index,
          input: row.input,
          rule: issue.rule,
          path: [...issue.path],
          code: issue.code,
          message: issue.message,
        })),
      ),
    }),
  });
}
