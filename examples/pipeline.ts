import { EffectTree, Graph, Root } from '@minamorl/berylx';
import {
  field,
  invalid,
  reshapeMany,
  select,
  type ReshapeDefinition,
} from '@minamorl/berylx-presets';

export type RawUser = { id: string; display?: string; active: boolean };
export type User = { id: number; profile: { label: string }; active: boolean };

const definition: ReshapeDefinition<RawUser, User> = {
  name: 'users',
  fields: {
    id: field('parse_id', (user) =>
      /^\d+$/.test(user.id)
        ? Number(user.id)
        : invalid('invalid_id', 'id must contain digits'),
    ),
    profile: {
      label: field('display_name', (user) => user.display?.trim(), {
        default: 'anonymous',
      }),
    },
    active: field('active', (user) => user.active),
  },
};

export const pipeline = reshapeMany(definition).then(
  select<User>({
    name: 'enabled',
    rules: {
      active: (user) => user.active || invalid('inactive', '利用停止中'),
    },
  }),
);

export const input: readonly RawUser[] = [
  { id: '1', display: ' Mina ', active: true },
  { id: 'bad', active: true },
  { id: '2', active: false },
];

const compiled = pipeline.compile(input);
export const graph = Graph.from(compiled.node).toMermaid();
export const planned = EffectTree.dryRun(
  compiled.node,
  compiled.initialState,
).steps;
export const result = pipeline.run(input);

// Root commits the fixed Frame on success; Err retains partial Frame separately.
export const root = Root.of(compiled.initialState);
export const nativeResult = root.pipe(compiled.node);
