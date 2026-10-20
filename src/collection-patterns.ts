import {
  createPreset,
  assertSync,
  type StageRule,
  type StepContext,
} from './internal/builder.js';
import { Invalid } from './invalid.js';
import type {
  Accepted,
  Batch,
  Issue,
  Path,
  Rejected,
  SelectionInput,
} from './types.js';
import type { Preset } from './preset.js';

/** These factories preserve source records even when one result contains many rows. */
export type Entries<T> = readonly Accepted<T>[];
export interface Group<K, T> {
  readonly key: K;
  readonly entries: Entries<T>;
}
export interface GroupResult<K, T> {
  readonly groups: readonly Group<K, T>[];
  readonly rejected: readonly Rejected[];
}
export interface IndexEntry<K, T> {
  readonly key: K;
  readonly entry: Accepted<T>;
}
export interface Collision<K, T> {
  readonly key: K;
  readonly previous: Accepted<T>;
  readonly incoming: Accepted<T>;
}
export interface IndexResult<K, T> {
  readonly entries: readonly IndexEntry<K, T>[];
  readonly collisions: readonly Collision<K, T>[];
  readonly rejected: readonly Rejected[];
}
export interface PageResult<T> {
  readonly page: number;
  readonly size: number;
  readonly accepted: Entries<T>;
  readonly skipped: Entries<T>;
  readonly rejected: readonly Rejected[];
}
export interface PartitionResult<T> {
  readonly yes: Entries<T>;
  readonly no: Entries<T>;
  readonly rejected: readonly Rejected[];
}
export interface Route<T> {
  readonly name: string;
  readonly entries: Entries<T>;
}
export interface RouteResult<T> {
  readonly routes: readonly Route<T>[];
  readonly unmatched: Entries<T>;
  readonly rejected: readonly Rejected[];
}
export interface ChunkResult<T> {
  readonly chunks: readonly Entries<T>[];
  readonly rejected: readonly Rejected[];
}
export interface WindowResult<T> {
  readonly windows: readonly Entries<T>[];
  readonly uncovered: Entries<T>;
  readonly rejected: readonly Rejected[];
}

export type KeyRule<T, K> = (value: T, source: Accepted<T>) => K | Invalid;
export type PredicateRule<T> = (
  value: T,
  source: Accepted<T>,
) => boolean | Invalid;
export interface NamedKey<T> {
  readonly name: string;
  readonly key: KeyRule<T, string | number>;
  readonly direction?: 'asc' | 'desc';
}
export interface NamedRoute<T> {
  readonly name: string;
  readonly matches: PredicateRule<T>;
}

interface BaseWork<T> {
  readonly accepted: Entries<T>;
  readonly rejected: readonly Rejected[];
}
type Keyed<T, K> = { readonly entry: Accepted<T>; readonly key: K };

function prepare<T>(input: SelectionInput<T>): BaseWork<T> {
  if (Array.isArray(input)) {
    return {
      accepted: input.map((value, index) => ({ index, input: value, value })),
      rejected: [],
    };
  }
  const batch = input as Batch<T>;
  return { accepted: [...batch.accepted], rejected: [...batch.rejected] };
}

function reject<T>(
  entry: Accepted<T>,
  rule: string,
  path: Path,
  defect: Invalid,
): Rejected {
  const issue: Issue = {
    rule,
    path,
    code: defect.code,
    message: defect.message,
  };
  return { index: entry.index, input: entry.input, issues: [issue] };
}

function evaluate<T, V, W extends BaseWork<T>>(
  entry: Accepted<T>,
  _name: string,
  path: Path,
  callback: (value: T, source: Accepted<T>) => V | Invalid,
  context: StepContext<W>,
  work: W,
): V | Invalid {
  context.locate({ index: entry.index, path });
  context.checkpoint(work);
  const result = callback(entry.value, entry);
  assertSync(result);
  return result;
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(`${name} must be a positive safe integer`);
}

function nonnegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a nonnegative safe integer`);
}

function uniqueNames(names: readonly string[], kind: string): void {
  if (
    names.some((name) => name.length === 0) ||
    new Set(names).size !== names.length
  ) {
    throw new RangeError(`${kind} names must be nonempty and distinct`);
  }
}

/** Stable first-seen grouping. Map key equality follows JavaScript SameValueZero. */
export function groupBy<T, K>(definition: {
  readonly name: string;
  readonly key: KeyRule<T, K>;
}): Preset<SelectionInput<T>, GroupResult<K, T>> {
  type Work = BaseWork<T> & { readonly keyed: readonly Keyed<T, K>[] };
  const rule: StageRule<Work> = {
    name: definition.name,
    path: ['key'],
    apply(work, context) {
      const keyed: Keyed<T, K>[] = [];
      const rejected = [...work.rejected];
      for (const entry of work.accepted) {
        const key = evaluate(
          entry,
          definition.name,
          ['key'],
          definition.key,
          context,
          { ...work, keyed: [...keyed], rejected: [...rejected] },
        );
        if (key instanceof Invalid)
          rejected.push(reject(entry, definition.name, ['key'], key));
        else keyed.push({ entry, key });
      }
      return { accepted: work.accepted, rejected, keyed };
    },
  };
  return createPreset({
    name: 'groupBy',
    prepare: (input) => ({ ...prepare(input), keyed: [] }),
    rules: [rule],
    finish(work) {
      const groups = new Map<K, Accepted<T>[]>();
      for (const { key, entry } of work.keyed) {
        const bucket = groups.get(key);
        if (bucket) bucket.push(entry);
        else groups.set(key, [entry]);
      }
      return {
        groups: [...groups].map(([key, entries]) => ({ key, entries })),
        rejected: work.rejected,
      };
    },
  });
}

/** Unique index; duplicate policy is explicit and collisions remain visible. */
export function indexBy<T, K>(definition: {
  readonly name: string;
  readonly key: KeyRule<T, K>;
  readonly onCollision: 'first' | 'last' | 'reject';
}): Preset<SelectionInput<T>, IndexResult<K, T>> {
  type Work = BaseWork<T> & { readonly keyed: readonly Keyed<T, K>[] };
  const policy = definition.onCollision;
  const rule: StageRule<Work> = {
    name: definition.name,
    path: ['key'],
    apply(work, context) {
      const keyed: Keyed<T, K>[] = [];
      const rejected = [...work.rejected];
      for (const entry of work.accepted) {
        const key = evaluate(
          entry,
          definition.name,
          ['key'],
          definition.key,
          context,
          { ...work, keyed: [...keyed], rejected: [...rejected] },
        );
        if (key instanceof Invalid)
          rejected.push(reject(entry, definition.name, ['key'], key));
        else keyed.push({ entry, key });
      }
      return { accepted: work.accepted, rejected, keyed };
    },
  };
  return createPreset({
    name: 'indexBy',
    prepare: (input) => ({ ...prepare(input), keyed: [] }),
    rules: [rule],
    finish(work) {
      const index = new Map<K, Accepted<T>>();
      const collisions: Collision<K, T>[] = [];
      const rejected = [...work.rejected];
      for (const { key, entry } of work.keyed) {
        const prior = index.get(key);
        if (prior === undefined) index.set(key, entry);
        else {
          collisions.push({ key, previous: prior, incoming: entry });
          if (policy === 'last') index.set(key, entry);
          if (policy === 'reject')
            rejected.push(
              reject(
                entry,
                definition.name,
                ['key'],
                new Invalid('duplicate_key', 'Key already exists'),
              ),
            );
        }
      }
      return {
        entries: [...index].map(([key, entry]) => ({ key, entry })),
        collisions,
        rejected,
      };
    },
  });
}

/** Retain the first or last row per key and report every discarded row. */
export function deduplicate<T, K>(definition: {
  readonly name: string;
  readonly key: KeyRule<T, K>;
  readonly keep?: 'first' | 'last';
}): Preset<SelectionInput<T>, Batch<T>> {
  type Work = BaseWork<T> & { readonly keyed: readonly Keyed<T, K>[] };
  const keep = definition.keep ?? 'first';
  const rule: StageRule<Work> = {
    name: definition.name,
    path: ['key'],
    apply(work, context) {
      const keyed: Keyed<T, K>[] = [];
      const rejected = [...work.rejected];
      for (const entry of work.accepted) {
        const key = evaluate(
          entry,
          definition.name,
          ['key'],
          definition.key,
          context,
          { ...work, keyed: [...keyed], rejected: [...rejected] },
        );
        if (key instanceof Invalid)
          rejected.push(reject(entry, definition.name, ['key'], key));
        else keyed.push({ entry, key });
      }
      return { accepted: work.accepted, rejected, keyed };
    },
  };
  return createPreset({
    name: 'deduplicate',
    prepare: (input) => ({ ...prepare(input), keyed: [] }),
    rules: [rule],
    finish(work) {
      const chosen = new Map<K, Keyed<T, K>>();
      const rejected = [...work.rejected];
      for (const item of work.keyed) {
        const { key, entry } = item;
        const prior = chosen.get(key);
        if (prior === undefined) chosen.set(key, item);
        else if (keep === 'last') {
          rejected.push(
            reject(
              prior.entry,
              definition.name,
              ['key'],
              new Invalid('duplicate_key', 'Superseded by a later row'),
            ),
          );
          chosen.set(key, item);
        } else
          rejected.push(
            reject(
              entry,
              definition.name,
              ['key'],
              new Invalid('duplicate_key', 'Duplicate of an earlier row'),
            ),
          );
      }
      const accepted = work.keyed
        .filter((item) => chosen.get(item.key) === item)
        .map((item) => item.entry);
      return { accepted, rejected };
    },
  });
}

/** Stable lexicographic order over named keys. Invalid keys reject only that row. */
export function orderBy<T>(definition: {
  readonly keys: readonly NamedKey<T>[];
}): Preset<SelectionInput<T>, Batch<T>> {
  const keys = definition.keys.map((key) => ({ ...key }));
  if (keys.length === 0)
    throw new RangeError('orderBy requires at least one key');
  uniqueNames(
    keys.map((key) => key.name),
    'orderBy key',
  );
  type Work = BaseWork<T> & {
    readonly values: ReadonlyMap<Accepted<T>, readonly (string | number)[]>;
  };
  const rules: StageRule<Work>[] = keys.map((key) => ({
    name: key.name,
    path: ['keys', key.name],
    apply(work, context) {
      const values = new Map(work.values);
      const accepted: Accepted<T>[] = [];
      const rejected = [...work.rejected];
      for (const entry of work.accepted) {
        const value = evaluate(
          entry,
          key.name,
          ['keys', key.name],
          key.key,
          context,
          {
            ...work,
            accepted: [...accepted],
            rejected: [...rejected],
            values: new Map(values),
          },
        );
        if (value instanceof Invalid)
          rejected.push(reject(entry, key.name, ['keys', key.name], value));
        else {
          values.set(entry, [...(values.get(entry) ?? []), value]);
          accepted.push(entry);
        }
      }
      return { accepted, rejected, values };
    },
  }));
  return createPreset({
    name: 'orderBy',
    prepare: (input) => ({ ...prepare(input), values: new Map() }),
    rules,
    finish(work) {
      const positions = new Map(
        work.accepted.map((entry, index) => [entry, index]),
      );
      const accepted = [...work.accepted].sort((a, b) => {
        const left = work.values.get(a)!;
        const right = work.values.get(b)!;
        for (let i = 0; i < keys.length; i++) {
          const cmp = left[i]! < right[i]! ? -1 : left[i]! > right[i]! ? 1 : 0;
          if (cmp) return keys[i]!.direction === 'desc' ? -cmp : cmp;
        }
        return positions.get(a)! - positions.get(b)!;
      });
      return { accepted, rejected: work.rejected };
    },
  });
}

/** Zero-based page; every nonselected accepted row remains in skipped. */
export function paginate<T>(definition: {
  readonly page: number;
  readonly size: number;
}): Preset<SelectionInput<T>, PageResult<T>> {
  nonnegativeInteger(definition.page, 'page');
  positiveInteger(definition.size, 'size');
  const { page, size } = definition;
  return createPreset<SelectionInput<T>, PageResult<T>, BaseWork<T>>({
    name: 'paginate',
    prepare,
    rules: [{ name: 'select-page', apply: (work) => work }],
    finish(work) {
      const start = page * size;
      const accepted = work.accepted.slice(start, start + size);
      const skipped = [
        ...work.accepted.slice(0, start),
        ...work.accepted.slice(start + size),
      ];
      return { page, size, accepted, skipped, rejected: work.rejected };
    },
  });
}

/** Two-way classification without losing source indices or inherited rejections. */
export function partition<T>(definition: {
  readonly name: string;
  readonly test: PredicateRule<T>;
}): Preset<SelectionInput<T>, PartitionResult<T>> {
  type Work = BaseWork<T> & {
    readonly yes: Entries<T>;
    readonly no: Entries<T>;
  };
  return createPreset<SelectionInput<T>, PartitionResult<T>, Work>({
    name: 'partition',
    prepare: (input) => ({ ...prepare(input), yes: [], no: [] }),
    rules: [
      {
        name: definition.name,
        path: ['test'],
        apply(work, context) {
          const yes: Accepted<T>[] = [];
          const no: Accepted<T>[] = [];
          const rejected = [...work.rejected];
          for (const entry of work.accepted) {
            const result = evaluate(
              entry,
              definition.name,
              ['test'],
              definition.test,
              context,
              { ...work, yes: [...yes], no: [...no], rejected: [...rejected] },
            );
            if (result instanceof Invalid)
              rejected.push(reject(entry, definition.name, ['test'], result));
            else if (typeof result !== 'boolean')
              throw new TypeError(
                'partition predicate must return boolean or Invalid',
              );
            else if (result) yes.push(entry);
            else no.push(entry);
          }
          return { accepted: work.accepted, rejected, yes, no };
        },
      },
    ],
    finish: (work) => ({ yes: work.yes, no: work.no, rejected: work.rejected }),
  });
}

/** Ordered first-match routes; later callbacks never see an already matched row. */
export function route<T>(definition: {
  readonly routes: readonly NamedRoute<T>[];
}): Preset<SelectionInput<T>, RouteResult<T>> {
  const routes = definition.routes.map((route) => ({ ...route }));
  if (routes.length === 0)
    throw new RangeError('route requires at least one route');
  uniqueNames(
    routes.map((route) => route.name),
    'route',
  );
  type Work = BaseWork<T> & {
    readonly remaining: Entries<T>;
    readonly routed: readonly Route<T>[];
  };
  const rules: StageRule<Work>[] = routes.map((route) => ({
    name: route.name,
    path: ['routes', route.name],
    apply(work, context) {
      const matched: Accepted<T>[] = [];
      const remaining: Accepted<T>[] = [];
      const rejected = [...work.rejected];
      for (const [index, entry] of work.remaining.entries()) {
        const checkpoint = {
          ...work,
          remaining: [...remaining, ...work.remaining.slice(index)],
          routed: [...work.routed, { name: route.name, entries: [...matched] }],
          rejected: [...rejected],
        };
        const result = evaluate(
          entry,
          route.name,
          ['routes', route.name],
          route.matches,
          context,
          checkpoint,
        );
        if (result instanceof Invalid)
          rejected.push(
            reject(entry, route.name, ['routes', route.name], result),
          );
        else if (typeof result !== 'boolean')
          throw new TypeError('route predicate must return boolean or Invalid');
        else if (result) matched.push(entry);
        else remaining.push(entry);
      }
      return {
        accepted: work.accepted,
        rejected,
        remaining,
        routed: [...work.routed, { name: route.name, entries: matched }],
      };
    },
  }));
  return createPreset({
    name: 'route',
    prepare: (input) => {
      const base = prepare(input);
      return { ...base, remaining: base.accepted, routed: [] };
    },
    rules,
    finish: (work) => ({
      routes: work.routed,
      unmatched: work.remaining,
      rejected: work.rejected,
    }),
  });
}

/** Fixed, nonoverlapping chunks; the last chunk may be short. */
export function chunk<T>(definition: {
  readonly size: number;
}): Preset<SelectionInput<T>, ChunkResult<T>> {
  positiveInteger(definition.size, 'size');
  const size = definition.size;
  return createPreset<SelectionInput<T>, ChunkResult<T>, BaseWork<T>>({
    name: 'chunk',
    prepare,
    rules: [{ name: 'make-chunks', apply: (work) => work }],
    finish(work) {
      const chunks: Accepted<T>[][] = [];
      for (let start = 0; start < work.accepted.length; start += size)
        chunks.push(work.accepted.slice(start, start + size));
      return { chunks, rejected: work.rejected };
    },
  });
}

/** Full sliding windows; uncovered records include any gaps and trailing rows. */
export function window<T>(definition: {
  readonly size: number;
  readonly step?: number;
}): Preset<SelectionInput<T>, WindowResult<T>> {
  positiveInteger(definition.size, 'size');
  positiveInteger(definition.step ?? 1, 'step');
  const size = definition.size;
  const step = definition.step ?? 1;
  return createPreset<SelectionInput<T>, WindowResult<T>, BaseWork<T>>({
    name: 'window',
    prepare,
    rules: [{ name: 'make-windows', apply: (work) => work }],
    finish(work) {
      const windows: Accepted<T>[][] = [];
      const covered = new Set<number>();
      for (let start = 0; start + size <= work.accepted.length; start += step) {
        const entries = work.accepted.slice(start, start + size);
        windows.push(entries);
        for (let offset = 0; offset < size; offset++)
          covered.add(start + offset);
      }
      return {
        windows,
        uncovered: work.accepted.filter((_, index) => !covered.has(index)),
        rejected: work.rejected,
      };
    },
  });
}
