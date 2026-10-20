import {
  countAccepted,
  groupBy,
  lookupJoin,
  mapAccepted,
  orderBy,
  refineValue,
  type NamedGuard,
  type PrimitiveKey,
  type RefinementGuard,
} from '@minamorl/berylx-presets';

interface PublicRow {
  readonly id: string;
  readonly amount: number;
}

const publicPipeline = mapAccepted<PublicRow, PublicRow>({
  name: 'copy',
  transform: (row) => ({ id: row.id, amount: row.amount }),
})
  .then(
    orderBy<PublicRow>({
      keys: [{ name: 'amount', key: (row) => row.amount }],
    }),
  )
  .then(countAccepted<PublicRow>({ min: 1 }));

publicPipeline.run([{ id: 'one', amount: 1 }]);

const guard: RefinementGuard<PublicRow | null, PublicRow> = {
  name: 'present',
  guard: (row): row is PublicRow => row !== null,
};
const legacyGuard: NamedGuard<PublicRow | null, PublicRow> = {
  name: 'present',
  test: (row): row is PublicRow => row !== null,
};
refineValue(guard);
void legacyGuard;

const primitiveKey: PrimitiveKey = Symbol('public-key');
void primitiveKey;
groupBy<PublicRow, PrimitiveKey>({ name: 'row-id', key: (row) => row.id }).run([
  { id: 'one', amount: 1 },
]);
lookupJoin<PublicRow, PublicRow, PrimitiveKey>({
  leftKey: (row) => row.id,
  rightKey: (row) => row.id,
}).run({
  left: [{ id: 'one', amount: 1 }],
  right: [{ id: 'one', amount: 1 }],
});

// @ts-expect-error object keys violate the public PrimitiveKey constraint
groupBy<PublicRow, { readonly id: string }>({
  name: 'object-key',
  key: (row) => row,
});

// @ts-expect-error object keys violate the relational PrimitiveKey constraint
lookupJoin<PublicRow, PublicRow, { readonly id: string }>({
  leftKey: (row) => row,
  rightKey: (row) => row,
});

publicPipeline.then(
  // @ts-expect-error an incompatible next input cannot consume a Batch<PublicRow>
  mapAccepted<string, string>({ name: 'text', transform: (value) => value }),
);

mapAccepted<PublicRow, number>({
  name: 'invalid-output',
  // @ts-expect-error an output declaration cannot return a string
  transform: (row) => row.id,
});
