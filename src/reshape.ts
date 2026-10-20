import { FIELD, type Field, type ReshapeDefinition } from './definitions.js';
import { Invalid, invalid } from './invalid.js';
import { assertSync, createPreset, type StageRule, type StepContext } from './internal/builder.js';
import type { Preset } from './preset.js';
import type { Batch, Issue } from './types.js';

type Output = Readonly<Record<string, unknown>>;
interface Row<I> {
  readonly index: number;
  readonly input: I;
  readonly value: Output;
  readonly issues: readonly Issue[];
}
type Work<I> = readonly Row<I>[];

function isObject(value: unknown): value is Output {
  return typeof value === 'object' && value !== null;
}

// Local erasure boundary: Shape<I, O> has already checked every leaf's I/O.
// FIELD distinguishes a typed whole-value field from a nested output shape.
function isField<I>(value: unknown): value is Field<I, unknown> {
  return isObject(value) && FIELD in value && value[FIELD] === true;
}

function setPath(output: Output, path: readonly string[], value: unknown): Output {
  const [key, ...rest] = path;
  if (key === undefined) throw new TypeError('A field must have an output path');
  if (rest.length === 0) return { ...output, [key]: value };
  const child = output[key];
  if (!isObject(child)) throw new TypeError('A nested output must be an object');
  return { ...output, [key]: setPath(child, rest, value) };
}

function getPath(output: Output, path: readonly string[]): unknown {
  let value: unknown = output;
  for (const key of path) {
    if (!isObject(value)) throw new TypeError('A nested output must be an object');
    value = value[key];
  }
  return value;
}

// The sole output-assembly assertion: finish is reached only after every typed
// field and validation has succeeded, including explicit undefined defaults.
function complete<O extends object>(output: Output): O {
  return output as O;
}

function plan<I, O extends object>(definition: ReshapeDefinition<I, O>, single: boolean) {
  const rules: StageRule<Work<I>>[] = [];

  function rule(
    name: string,
    path: readonly string[],
    evaluate: (row: Row<I>) => Output | Invalid,
  ): StageRule<Work<I>> {
    return {
      name, path,
      apply(initial, context: StepContext<Work<I>>) {
        let work = initial;
        for (const [offset, row] of initial.entries()) {
          if (row.issues.length > 0) continue;
          context.locate(single ? { path } : { path, index: row.index });
          const value = evaluate(row);
          let next: Row<I>;
          if (value instanceof Invalid) {
            const issue: Issue = { rule: name, path, code: value.code, message: value.message };
            next = { ...row, issues: [issue] };
            if (!single) context.issue(issue);
          } else {
            next = { ...row, value };
          }
          work = work.map((item, index) => index === offset ? next : item);
          context.checkpoint(work);
          if (value instanceof Invalid && single) return value;
        }
        return work;
      },
    };
  }

  function visit(shape: object, parent: readonly string[]): Output {
    const nested: [string, unknown][] = [];
    const entries: readonly (readonly [string, unknown])[] = Object.entries(shape);
    for (const [key, entry] of entries) {
      const path = [...parent, key];
      if (isField<I>(entry)) {
        rules.push(rule(entry.name, path, (row) => {
          let value = entry.read(row.input);
          assertSync(value);
          if (value instanceof Invalid) return value;
          if (value === undefined) {
            if (!Object.hasOwn(entry.options, 'default')) {
              return invalid('missing', 'Value is required');
            }
            value = entry.options.default;
            assertSync(value);
          }
          return setPath(row.value, path, value);
        }));
        for (const validation of entry.options.validate ?? []) {
          rules.push(rule(`${entry.name}/${validation.name}`, path, (row) => {
            const result = validation.check(getPath(row.value, path));
            assertSync(result);
            return result instanceof Invalid ? result : row.value;
          }));
        }
      } else {
        if (!isObject(entry)) throw new TypeError('A shape entry must be a field or nested shape');
        nested.push([key, visit(entry, path)]);
      }
    }
    return Object.fromEntries(nested);
  }

  const empty = visit(definition.fields, []);
  const prepare = (input: readonly I[]): Work<I> => input.map((value, index) => ({
    index, input: value, value: empty, issues: [],
  }));
  return { rules, prepare };
}

export function reshape<I, O extends object>(definition: ReshapeDefinition<I, O>): Preset<I, O> {
  const { rules, prepare } = plan(definition, true);
  return createPreset<I, O, Work<I>>({
    name: definition.name,
    prepare: (input) => prepare([input]),
    rules,
    finish: (work) => {
      const row = work[0];
      if (!row) throw new TypeError('Single-record work must contain a row');
      return complete<O>(row.value);
    },
  });
}

export function reshapeMany<I, O extends object>(
  definition: ReshapeDefinition<I, O>,
): Preset<readonly I[], Batch<O>> {
  const { rules, prepare } = plan(definition, false);
  return createPreset<readonly I[], Batch<O>, Work<I>>({
    name: definition.name, prepare, rules,
    finish: (work) => ({
      accepted: work.filter((row) => row.issues.length === 0)
        .map((row) => ({ index: row.index, input: row.input, value: complete<O>(row.value) })),
      rejected: work.filter((row) => row.issues.length > 0)
        .map((row) => ({ index: row.index, input: row.input, issues: row.issues })),
    }),
  });
}
