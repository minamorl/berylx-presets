import { invalid, select, type Batch } from '@minamorl/berylx-presets';

export type Member = {
  kind: 'member';
  active: boolean;
  emailVerified: boolean;
};
export type User = Member | { kind: 'guest' };

export const users: readonly User[] = [
  { kind: 'member', active: true, emailVerified: true },
  { kind: 'member', active: false, emailVerified: false },
  { kind: 'member', active: true, emailVerified: false },
  { kind: 'guest' },
];

export const result = select<User, Member>({
  name: 'members',
  guard: (user): user is Member => user.kind === 'member',
  rules: {
    active: (member) => member.active || invalid('inactive', '利用停止中'),
    verified: (member) =>
      member.emailVerified || invalid('unverified', 'メール未確認'),
  },
}).run(users);

export const members: Batch<Member> | undefined = result.ok
  ? result.value
  : undefined;
