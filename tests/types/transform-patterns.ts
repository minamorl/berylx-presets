import { invalid } from '../../src/invalid.js';
import {
  mapValue,
  mapAccepted,
  expandAccepted,
  validateValue,
  refineValue,
  auditValue,
  countAccepted,
  acceptedValues,
  issueReport,
} from '../../src/transform-patterns.js';
import type { Batch } from '../../src/types.js';

type Animal = { kind: 'cat'; lives: number } | { kind: 'dog'; bark: string };
type Cat = Extract<Animal, { kind: 'cat' }>;

const positive = validateValue<number>([
  { name: 'positive', check: (n) => n > 0 },
]);
const audited = auditValue<number>([
  { name: 'finite', check: (n) => Number.isFinite(n) },
]);
const doubled = mapValue<number, number>({
  name: 'double',
  transform: (n) => n * 2,
});
const numericPipeline = positive.then(audited).then(doubled);
const numericValue: number = numericPipeline.run(2).ok ? 4 : 0;
void numericValue;

const cats = refineValue<Animal, Cat>({
  name: 'cat',
  guard: (animal): animal is Cat => animal.kind === 'cat',
});
const lives = cats.then(
  mapValue<Cat, number>({ name: 'lives', transform: (cat) => cat.lives }),
);
const livesResult = lives.run({ kind: 'cat', lives: 9 });
if (livesResult.ok) {
  const n: number = livesResult.value;
  void n;
}

const parsed = mapAccepted<string, number>({
  name: 'parse',
  transform: (s) => {
    const n = Number(s);
    return Number.isFinite(n) ? n : invalid('nan', 'not numeric');
  },
});
const expanded = expandAccepted<number, number>({
  name: 'duplicate',
  transform: (n) => [n, n],
});
const bounded = countAccepted<number>({ min: 1, max: 4 });
const reported = issueReport<number>();
const extracted = acceptedValues<number>();
const batchPipeline = parsed.then(expanded).then(bounded);
const batchResult = batchPipeline.run(['2', 'bad']);
if (batchResult.ok) {
  const batch: Batch<number> = batchResult.value;
  const report = reported.run(batch);
  const values = extracted.run(batch);
  if (report.ok && values.ok) {
    const index: number = report.value.issues[0]?.index ?? 0;
    const first: number | undefined = values.value[0];
    void index;
    void first;
  }
}

// @ts-expect-error a string preset cannot consume a number output
positive.then(mapValue<string, string>({ name: 'wrong', transform: (s) => s }));

// @ts-expect-error a mapper must produce its declared output type
mapValue<number, string>({ name: 'wrongOutput', transform: (n) => n });

// @ts-expect-error a check must return boolean or Invalid
validateValue<number>([{ name: 'wrongCheck', check: (n) => String(n) }]);

// @ts-expect-error a guard target must be assignable to its input type
refineValue<number, string>({
  name: 'wrongGuard',
  // @ts-expect-error predicate output must also be assignable to the input
  guard: (n): n is string => Number.isFinite(n),
});

// @ts-expect-error acceptedValues removes provenance and cannot be a Batch
const wrongBatch: Batch<number> = extracted.run([1]).ok
  ? [1]
  : { accepted: [], rejected: [] };
void wrongBatch;

// Compile the documentation's complete configuration and composition examples.
const docPositive = validateValue<number>([
  { name: 'positive', path: ['amount'], check: (n) => n > 0 },
]);
const docDoubled = mapValue<number, number>({
  name: 'double',
  transform: (n) => n * 2,
});
const docOutput = docPositive.then(docDoubled).run(4);
const docAudit = auditValue<number>([
  { name: 'finite', check: (n) => Number.isFinite(n) },
  {
    name: 'small',
    check: (n) => n < 100 || invalid('large', 'must be below 100'),
  },
]);
const docParsed = mapAccepted<string, number>({
  name: 'parse',
  path: ['number'],
  transform: (s) => {
    const n = Number(s);
    return Number.isFinite(n) ? n : invalid('nan', 'not numeric');
  },
});
const docDuplicated = expandAccepted<number, number>({
  name: 'duplicate',
  transform: (n) => [n, n],
});
const docBounded = countAccepted<number>({ min: 1, max: 4 });
const docBatchOutput = docParsed
  .then(docDuplicated)
  .then(docBounded)
  .run(['2', 'bad']);
if (docBatchOutput.ok) {
  const docReport = issueReport<number>().run(docBatchOutput.value);
  const docValues = acceptedValues<number>().run(docBatchOutput.value);
  void docReport;
  void docValues;
}
void docOutput;
void docAudit;
