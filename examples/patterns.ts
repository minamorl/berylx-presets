import {
  countAccepted,
  fallback,
  invalid,
  lookupJoin,
  mapAccepted,
  orderBy,
} from '@minamorl/berylx-presets';

export interface Sale {
  readonly id: string;
  readonly cents: number;
}

export const salesPipeline = mapAccepted<Sale, Sale>({
  name: 'normalize-sale',
  transform: (sale) => ({ id: sale.id.trim(), cents: sale.cents }),
})
  .then(
    orderBy<Sale>({
      keys: [
        { name: 'largest-first', key: (sale) => sale.cents, direction: 'desc' },
      ],
    }),
  )
  .then(countAccepted<Sale>({ min: 1 }));

export const salesResult = salesPipeline.run([
  { id: ' a ', cents: 120 },
  { id: 'b', cents: 450 },
]);

export const labelJoin = lookupJoin<
  Sale,
  { readonly id: string; readonly label: string },
  string
>({
  leftKey: (sale) => sale.id,
  rightKey: (label) => label.id,
});

export const labelResult = labelJoin.run({
  left: [{ id: 'a', cents: 120 }],
  right: [{ id: 'a', label: 'first' }],
});

export const cachedLabel = fallback<string, string>([
  { name: 'cache', apply: () => invalid('cache_miss', 'No cached label') },
  { name: 'source', apply: (id) => `label:${id}` },
]);

export const fallbackResult = cachedLabel.run('a');
