import { ResultOps, Sequence, Task, type Focus } from '@minamorl/berylx';
import { Invalid } from '../invalid.js';
import { Preset } from '../preset.js';
import type { Frame, Issue, Location, Path } from '../types.js';

export interface StepContext<W> {
  /** Set before user code: preserves the element/path even if user code throws. */
  locate(position: { readonly path?: Path; readonly index?: number }): void;
  /** Persist a new immutable working value before the next risky operation. */
  checkpoint(work: W): void;
  /** Append a recoverable data diagnostic without failing the workflow. */
  issue(issue: Issue): void;
}

export interface StageRule<W> {
  readonly name: string;
  readonly path?: Path;
  readonly apply: (work: W, context: StepContext<W>) => W | Invalid;
}

export interface Stage<I, O, W> {
  readonly name: string;
  readonly prepare: (input: I, context: StepContext<W>) => W | Invalid;
  readonly rules: readonly StageRule<W>[];
  readonly finish: (work: W, context: StepContext<W>) => O | Invalid;
}

export function assertSync(value: unknown): void {
  if (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'then' in value &&
    typeof value.then === 'function'
  ) {
    throw new TypeError('Preset callbacks must be synchronous');
  }
}

/** Native Berylx normal form: prepare -> one Task per rule -> result. */
export function createPreset<I, O, W>(stage: Stage<I, O, W>): Preset<I, O> {
  function step(
    name: string,
    path: Path,
    callback: (frame: Frame, context: StepContext<W>) => unknown,
    target: 'work' | 'current',
  ): Task<Frame> {
    const taskName = `${stage.name}:${name}`;
    return Task.of<Frame>(taskName, (initial) => {
      let focus: Focus<Frame, []> = initial.at('location').set({
        preset: stage.name,
        rule: name,
        path,
      });
      const context: StepContext<W> = {
        locate(position) {
          const location = focus.toObject().location as Location;
          focus = focus.at('location').set({ ...location, ...position });
        },
        checkpoint(work) {
          focus = focus.at('work').set(work);
        },
        issue(issue) {
          focus = focus.at('issues').update((issues) => [...issues, issue]);
        },
      };
      try {
        const value = callback(focus.toObject(), context);
        assertSync(value);
        if (value instanceof Invalid) {
          const location = focus.toObject().location as Location;
          context.issue({
            rule: location.rule,
            path: location.path,
            code: value.code,
            message: value.message,
          });
          return ResultOps.err<Frame>(focus, value.code, value.message, {
            failedNode: taskName,
            trace: [taskName],
            metadata: { location },
          });
        }
        return focus.at(target).set(value);
      } catch (cause) {
        // Catch here rather than outside the task so checkpoints and location survive.
        return ResultOps.err<Frame>(
          focus,
          cause instanceof Error ? cause.name : 'Error',
          cause instanceof Error ? cause.message : String(cause),
          {
            cause,
            failedNode: taskName,
            trace: [taskName],
            metadata: { location: focus.toObject().location },
          },
        );
      }
    });
  }

  const nodes = [
    step(
      'prepare',
      [],
      (frame, context) => stage.prepare(frame.current as I, context),
      'work',
    ),
    ...stage.rules.map((rule) =>
      step(
        rule.name,
        rule.path ?? [],
        (frame, context) => rule.apply(frame.work as W, context),
        'work',
      ),
    ),
    step(
      'result',
      [],
      (frame, context) => stage.finish(frame.work as W, context),
      'current',
    ),
  ];
  return new Preset<I, O>([new Sequence<Frame>(nodes)]);
}
