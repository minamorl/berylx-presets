/** Shared comparison inputs; the handwritten side has no preset dependency. */
export interface RawPerson {
  readonly id: string;
  readonly profile?: { readonly displayName?: string };
  readonly age?: number;
  readonly active: boolean;
}

export interface Person {
  readonly id: number;
  readonly profile: { readonly label: string };
  readonly age: number;
  readonly active: boolean;
}

export type Animal =
  | { readonly kind: 'cat'; readonly name: string; readonly lives: number; readonly indoor: boolean }
  | { readonly kind: 'dog'; readonly name: string; readonly trained: boolean };
export type Cat = Extract<Animal, { kind: 'cat' }>;

export const mixedPeople: readonly RawPerson[] = [
  { id: '12', profile: { displayName: ' Mina ' }, age: 21, active: true },
  { id: 'not-a-number', age: 20, active: true },
  { id: '13', age: -2, active: true },
  { id: '14', active: false },
];

export const animals: readonly Animal[] = [
  { kind: 'cat', name: 'Mochi', lives: 9, indoor: true },
  { kind: 'dog', name: 'Pochi', trained: true },
  { kind: 'cat', name: 'Ghost', lives: 0, indoor: false },
  { kind: 'cat', name: 'Tama', lives: 7, indoor: false },
];

// Berylx keeps class instances by reference; this getter runs inside the rule,
// rather than while Focus defensively copies an ordinary input record.
class UnavailableAge implements RawPerson {
  readonly id = '2';
  readonly active = true;
  get age(): number { throw new Error('age source unavailable'); }
}

/** An unexpected source exception after one complete item. */
export const throwingPeople: readonly RawPerson[] = [
  { id: '1', active: true },
  new UnavailableAge(),
];
