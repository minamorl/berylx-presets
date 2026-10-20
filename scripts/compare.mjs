import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const paths = ['fixtures/handwritten.ts', 'fixtures/presets.ts'];
const measurements = [];
for (const path of paths) {
  const file = new URL(path, root);
  const source = await readFile(file, 'utf8');
  const options = await prettier.resolveConfig(file);
  const formatted = await prettier.format(source, {
    ...options,
    filepath: fileURLToPath(file),
  });
  assert.equal(
    source,
    formatted,
    `${path} must use the shared Prettier configuration`,
  );
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    source,
  );
  const codeLines = new Set();
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
    const first = source.slice(0, scanner.getTokenStart()).split('\n').length;
    const last = source.slice(0, scanner.getTokenEnd() - 1).split('\n').length;
    for (let line = first; line <= last; line++) codeLines.add(line);
  }
  measurements.push({
    path,
    lines: codeLines.size,
    sha: createHash('sha256').update(source).digest('hex'),
  });
}
const [manual, presets] = measurements;
assert.ok(
  presets.lines < manual.lines,
  'Revisit preset granularity: full consumer code must be shorter',
);
const reduction = ((1 - presets.lines / manual.lines) * 100).toFixed(1);
const text = `# Consumer comparison

The complete consumer implementations are [handwritten](../fixtures/handwritten.ts)
and [presets](../fixtures/presets.ts). Both implement single-person conversion,
batch conversion and union selection. All imports, configuration, wrapper
functions and local result types in those files are counted. No function bodies
or configuration fragments are omitted from either source.

| Source | Non-comment, nonblank code lines |
| --- | ---: |
| ${manual.path} | ${manual.lines} |
| ${presets.path} | ${presets.lines} |

The preset consumer uses ${manual.lines - presets.lines} fewer code lines (${reduction}% reduction).
It contains no handwritten iteration, partial-work management or diagnostic
collection. These live in the library's native Berylx tasks.

## Reproduce

\`\`\`sh
npm ci
npm run format
npm run compare
npm run check
\`\`\`

\`npm run compare:write\` regenerates this report after an intentional source change;
the default comparison command checks the report and fails if it is stale.
Both complete files must already equal Prettier ${prettier.version} output under
the repository's same \`.prettierrc.json\`. The TypeScript ${ts.version} scanner
skips trivia; a physical line counts when a nontrivia token covers it. Comments
and blank lines alone do not count. This is a code-line measurement, not a token
measurement, and includes syntax-only lines after the same formatting.

## Same conditions and guarantees

Both sides import shared input/output models from \`fixtures/data.ts\`; that file
is excluded equally. Both may import the same Batch/Issue data contracts from
the package. The handwritten ReferenceResult declaration is included because
it is application-specific error/partial-state control code. The preset side's
inferred PresetResult provides typed success or native Berylx failure.

The [integration tests](../tests/integration.test.ts) compare full successful
values, original input/index, rejected issues (rule/path/code/message), first
failure, inherited rejections, empty input and all-rejected input. They also
compare source-exception cause/message and original failure position. Existing
typed fixtures check missing/wrong fields and invalid connections; the public
package examples require no type assertions.

Partial-state traversal order differs deliberately: the handwritten batch
finishes one row at a time; the preset applies each graph-visible rule across
active rows. On an exception they retain the actual progress each made, rather
than manufacturing identical partial snapshots. With deterministic, independent
readers and predicates, successful values and first per-row data failures agree.
Callbacks that share mutable side effects are outside this equivalence claim.

The [User/Member predicate example](../examples/predicates.ts) and
[conversion/selection/Graph/Root example](../examples/pipeline.ts) are separate
acceptance examples. Neither is counted on just one side of this paired
comparison; graph inspection is an additional capability, not artificial
handwritten baseline code. This measures these initial workloads, not every
possible transformation or runtime performance.

## Exact formatted sources (SHA-256)

| Source | SHA-256 |
| --- | --- |
| ${manual.path} | ${manual.sha} |
| ${presets.path} | ${presets.sha} |
`;
const report = new URL('docs/comparison.md', root);
const rendered = await prettier.format(text, {
  ...(await prettier.resolveConfig(report)),
  filepath: fileURLToPath(report),
});
if (process.argv.includes('--write')) await writeFile(report, rendered);
else
  assert.equal(
    await readFile(report, 'utf8'),
    rendered,
    'Comparison report is stale; run npm run compare:write',
  );
for (const item of measurements)
  console.log(`${item.path}: ${item.lines} code lines; sha256=${item.sha}`);
console.log(
  `reduction: ${manual.lines - presets.lines} code lines (${reduction}%)`,
);
