/** Paths address output fields; an array element's original index is separate. */
export type Path = readonly (string | number)[];

export interface Issue {
  readonly rule: string;
  readonly path: Path;
  readonly code: string;
  readonly message: string;
}

export interface Accepted<T> {
  readonly index: number;
  /** Original input before any transformation, retained through selection. */
  readonly input: unknown;
  readonly value: T;
}

export interface Rejected {
  readonly index: number;
  readonly input: unknown;
  readonly issues: readonly Issue[];
}

export interface Batch<T> {
  readonly accepted: readonly Accepted<T>[];
  readonly rejected: readonly Rejected[];
}

export type SelectionInput<I> = readonly I[] | Batch<I>;

export interface Location {
  readonly preset: string;
  readonly rule: string;
  readonly path: Path;
  readonly index?: number;
}

/** One fixed Berylx state type across every stage, including composed presets. */
export interface Frame {
  readonly input: unknown;
  readonly current: unknown;
  readonly work: unknown;
  readonly issues: readonly Issue[];
  readonly location: Location | null;
}
