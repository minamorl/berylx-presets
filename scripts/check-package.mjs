import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, '.evidence', 'package-smoke');
const consumer = join(output, 'consumer');
const cache = join(root, '.npm-cache');
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run through npm run test:package');

function run(args, cwd = root, command = process.execPath) {
  console.log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `Command exited ${result.status}`);
  return result.stdout;
}

await mkdir(output, { recursive: true });
const packed = JSON.parse(
  run([
    npm,
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    output,
    '--cache',
    cache,
  ]),
)[0];
await writeFile(
  join(output, 'pack.json'),
  `${JSON.stringify(packed, null, 2)}\n`,
);
const paths = packed.files.map((file) => file.path);
for (const required of [
  'dist/index.js',
  'dist/index.d.ts',
  'dist/reshape.js',
  'dist/select.js',
  'src/index.ts',
  'README.md',
  'LICENSE',
  'docs/contract.md',
  'docs/comparison.md',
  'examples/predicates.ts',
]) {
  assert.ok(paths.includes(required), `Missing package content: ${required}`);
}
assert.ok(
  paths.every((path) => !/^(?:node_modules|\.evidence|tests)\//.test(path)),
  'Development artifacts must not be packed',
);

await rm(consumer, { recursive: true, force: true });
await mkdir(consumer, { recursive: true });
await writeFile(
  join(consumer, 'package.json'),
  JSON.stringify(
    {
      name: 'berylx-presets-consumer-check',
      private: true,
      type: 'module',
      dependencies: {
        '@minamorl/berylx': '0.3.1',
        '@minamorl/berylx-presets': `file:../${packed.filename}`,
      },
    },
    null,
    2,
  ),
);
for (const file of ['runtime.mjs', 'types.ts']) {
  await copyFile(join(root, 'tests', 'consumer', file), join(consumer, file));
}
run(
  [
    npm,
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--cache',
    cache,
  ],
  consumer,
);
run(['--test', 'runtime.mjs'], consumer);
run([
  join(root, 'node_modules/typescript/bin/tsc'),
  '--noEmit',
  '--strict',
  '--exactOptionalPropertyTypes',
  '--module',
  'NodeNext',
  '--target',
  'ES2022',
  join(consumer, 'types.ts'),
]);
const peer = JSON.parse(
  run([npm, 'ls', '@minamorl/berylx', '--json'], consumer),
);
assert.equal(peer.dependencies['@minamorl/berylx'].version, '0.3.1');
// npm ls text gives the inspectable deduped tree; filesystem presence proves
// there is no private second Berylx under this installed preset package.
run([npm, 'ls', '@minamorl/berylx'], consumer);
const manifest = JSON.parse(
  await readFile(
    join(consumer, 'node_modules/@minamorl/berylx-presets/package.json'),
    'utf8',
  ),
);
assert.equal(manifest.dependencies, undefined);
assert.equal(manifest.peerDependencies['@minamorl/berylx'], '^0.3.1');
let nested = false;
try {
  await readFile(
    join(
      consumer,
      'node_modules/@minamorl/berylx-presets/node_modules/@minamorl/berylx/package.json',
    ),
  );
  nested = true;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
assert.equal(nested, false, 'Berylx must be supplied by one shared peer');
