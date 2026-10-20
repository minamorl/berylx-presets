import { invalid } from '../../src/invalid.js';
import type { Preset } from '../../src/preset.js';
import { select, type PredicateSelectDefinition, type SelectionPredicate } from '../../src/select.js';
import type { Batch, SelectionInput } from '../../src/types.js';

type Member = { kind: 'member'; active: boolean; emailVerified: boolean };
type Guest = { kind: 'guest' };
type User = Member | Guest;
declare const users: readonly User[];

// The API image supplied to the owner, without any consumer type assertions.
const members = select<User, Member>({
  name: 'members',
  guard: (user): user is Member => user.kind === 'member',
  rules: {
    active: (member) => member.active || invalid('inactive', '利用停止中'),
    verified: (member) => member.emailVerified || invalid('unverified', 'メール未確認'),
  },
});
const result = members.run(users);
if (result.ok) {
  const batch: Batch<Member> = result.value;
  for (const row of batch.accepted) {
    const active: boolean = row.value.active;
    const kind: 'member' = row.value.kind;
    void [active, kind];
    // @ts-expect-error Guard output cannot be a guest.
    const guest: Guest = row.value;
    void guest;
  }
}

export const predicateDefinition: PredicateSelectDefinition<User, Member> = {
  name: 'members', guard: (user): user is Member => user.kind === 'member',
  guardFailure: { code: 'not_member', message: '会員ではありません' },
  rules: { active: (member) => member.active },
};
export const narrowed: Preset<SelectionInput<User>, Batch<Member>> = select(predicateDefinition);
export const named: Preset<SelectionInput<User>, Batch<Member>> = select<User, Member>({
  name: 'members', guard: { name: 'member', test: (user): user is Member => user.kind === 'member' },
  rules: [{ name: 'active', test: (member) => member.active, code: 'inactive', message: 'inactive' }],
});
export const unchanged: Preset<SelectionInput<User>, Batch<User>> = select<User>({ name: 'all', rules: {} });
export const unchangedNamed: Preset<SelectionInput<User>, Batch<User>> = select<User>({ name: 'all', rules: [] });
export const predicate: SelectionPredicate<Member> = (member) => member.emailVerified;

// @ts-expect-error Narrowing requires a guard with a predicate record.
select<User, Member>({ name: 'unsound', rules: { active: (member: Member) => member.active } });
// @ts-expect-error Narrowing requires a guard with a named rule array.
select<User, Member>({ name: 'unsound', rules: [] });
// @ts-expect-error Definition types also forbid narrowing without a guard.
export const unsound: PredicateSelectDefinition<User, Member> = { name: 'bad', rules: {} };
// @ts-expect-error Output must extend input.
select<User, string>({ name: 'wrong', rules: {} });
// @ts-expect-error Record callbacks must accept the narrowed member, not a guest.
select<User, Member>({ name: 'wrong', guard: (user): user is Member => user.kind === 'member', rules: { wrong: (_guest: Guest) => true } });
// @ts-expect-error Narrower callbacks without a guard cannot accept every User.
select<User>({ name: 'wrong', rules: { active: (member: Member) => member.active } });
// @ts-expect-error Rule results must be boolean or Invalid, not string.
select<User>({ name: 'wrong', rules: { wrong: () => 'truthy' } });
// @ts-expect-error Rule results must be synchronous.
select<User>({ name: 'wrong', rules: { wrong: async () => true } });
// @ts-expect-error A boolean predicate cannot substitute for a narrowing guard.
select<User, Member>({ name: 'wrong', guard: (_user: User): boolean => true, rules: {} });
// @ts-expect-error Guard input must accept all input variants.
select<User, Member>({ name: 'wrong', guard: (_member: Member): _member is Member => true, rules: {} });
// @ts-expect-error Named callbacks must accept members after the guard.
select<User, Member>({ name: 'wrong', guard: { name: 'member', test: (user): user is Member => user.kind === 'member' }, rules: [{ name: 'wrong', test: (_guest: Guest) => true, code: 'bad', message: 'bad' }] });

export const composed: Preset<SelectionInput<User>, Batch<Member>> = members.then(select<Member>({
  name: 'active', rules: { active: (member) => member.active },
}));
// @ts-expect-error Batch<User> cannot feed a Member-only selection.
unchanged.then(select<Member>({ name: 'active', rules: { active: (member) => member.active } }));
// @ts-expect-error select takes an array or a Batch, not a single user.
members.run({ kind: 'guest' });
