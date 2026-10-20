export { invalid, Invalid } from './invalid.js';
export { field } from './definitions.js';
export { reshape, reshapeMany } from './reshape.js';
export { select } from './select.js';
export type {
  PredicateSelectDefinition,
  SelectionPredicate,
  GuardFailure,
} from './select.js';
export type {
  Field,
  FieldOptions,
  Validation,
  Shape,
  ReshapeDefinition,
  NamedGuard,
  SelectionRule,
  SelectDefinition,
} from './definitions.js';
export type {
  Path,
  Issue,
  Accepted,
  Rejected,
  Batch,
  SelectionInput,
  Location,
  Frame,
} from './types.js';
export type { Preset, CompiledPreset, PresetResult } from './preset.js';

export type {
  Origin,
  Sourced,
  SourcedRejection,
  FoldStep,
  FoldOutput,
  ScanOutput,
  JoinRow,
  JoinOutput,
  JoinManyRow,
  JoinManyOutput,
  ZipOutput,
  ReconcileOutput,
  Choice,
  Fallback,
  FallbackFailure,
  FanoutBranch,
} from './relation-patterns.js';

// Additional synchronous preset families.
export {
  mapValue,
  mapAccepted,
  expandAccepted,
  validateValue,
  refineValue,
  auditValue,
  countAccepted,
  acceptedValues,
  issueReport,
} from './transform-patterns.js';
export type {
  NamedTransform,
  NamedCheck,
  NamedGuard as RefinementGuard,
  CountBounds,
  ReportIssue,
  IssueReport,
} from './transform-patterns.js';

export {
  groupBy,
  indexBy,
  deduplicate,
  orderBy,
  paginate,
  partition,
  route,
  chunk,
  window,
} from './collection-patterns.js';
export type {
  Entries,
  Group,
  GroupResult,
  IndexEntry,
  Collision,
  IndexResult,
  PageResult,
  PartitionResult,
  Route,
  RouteResult,
  ChunkResult,
  WindowResult,
  KeyRule,
  PredicateRule,
  NamedKey,
  NamedRoute,
} from './collection-patterns.js';

export {
  fold,
  scan,
  lookupJoin,
  joinMany,
  zipStrict,
  reconcile,
  choose,
  fallback,
  fanout,
} from './relation-patterns.js';
export type { PrimitiveKey } from './collection-patterns.js';
