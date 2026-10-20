import { Err, Focus, ResultOps, Sequence, type Ok } from '@minamorl/berylx';
import type { Frame, Issue } from './types.js';

/** On snapshot failure, retain the source without trying to copy it again. */
class InputFailureFrame implements Frame {
  readonly work = undefined;
  readonly issues: readonly Issue[] = Object.freeze([]);
  readonly location = null;

  constructor(readonly input: unknown, readonly current: unknown) {
    Object.freeze(this);
  }
}

export interface CompiledPreset {
  readonly node: Sequence<Frame>;
  readonly initialState: Frame;
}

export type PresetResult<O> =
  | { readonly ok: true; readonly value: O; readonly result: Ok<Frame> }
  | { readonly ok: false; readonly result: Err<Frame> };

/** Construct via the internal builder. The package exports this class as a type. */
export class Preset<I, O> {
  // Carries the public I/O variance, independent of the fixed internal state type.
  declare private readonly io: (input: I) => O;

  constructor(private readonly stages: readonly Sequence<Frame>[]) {}

  compile(input: I): CompiledPreset {
    return {
      node: new Sequence<Frame>([...this.stages]),
      initialState: {
        input,
        current: input,
        work: undefined,
        issues: [],
        location: null,
      },
    };
  }

  run(input: I): PresetResult<O> {
    const { node, initialState } = this.compile(input);
    let focus: Focus<Frame, []>;
    try {
      focus = Focus.of(initialState);
    } catch (cause) {
      // No rule has run, so there is no failedNode or partial working value yet.
      return { ok: false, result: ResultOps.err<Frame>(new InputFailureFrame(input, input),
        cause instanceof Error ? cause.name : 'Error',
        cause instanceof Error ? cause.message : String(cause),
        { cause, metadata: { phase: 'input' } },
      ) };
    }
    const result = node.call(focus);
    if (result instanceof Err) return { ok: false, result };
    // The builder's typed finish callback is the single output boundary.
    return { ok: true, value: result.focus.toObject().current as O, result };
  }

  then<N>(next: Preset<O, N>): Preset<I, N> {
    return new Preset<I, N>([...this.stages, ...next.stages]);
  }
}
