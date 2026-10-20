# Consumer comparison

The complete consumer implementations are [handwritten](../fixtures/handwritten.ts)
and [presets](../fixtures/presets.ts). Both implement single-person conversion,
batch conversion and union selection. All imports, configuration, wrapper
functions and local result types in those files are counted. No function bodies
or configuration fragments are omitted from either source.

| Source                  | Non-comment, nonblank code lines |
| ----------------------- | -------------------------------: |
| fixtures/handwritten.ts |                              178 |
| fixtures/presets.ts     |                               69 |

The preset consumer uses 109 fewer code lines (61.2% reduction).
It contains no handwritten iteration, partial-work management or diagnostic
collection. These live in the library's native Berylx tasks.

## Reproduce

```sh
npm ci
npm run format
npm run compare
npm run check
```

`npm run compare:write` regenerates this report after an intentional source change;
the default comparison command checks the report and fails if it is stale.
Both complete files must already equal Prettier 3.9.10 output under
the repository's same `.prettierrc.json`. The TypeScript 5.9.3 scanner
skips trivia; a physical line counts when a nontrivia token covers it. Comments
and blank lines alone do not count. This is a code-line measurement, not a token
measurement, and includes syntax-only lines after the same formatting.

## Same conditions and guarantees

Both sides import shared input/output models from `fixtures/data.ts`; that file
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

| Source                  | SHA-256                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| fixtures/handwritten.ts | 262dc0ed7decc972f112796759954b8531963179d4012b30f284b8fe463d5bab |
| fixtures/presets.ts     | e79cb380eddd344962fc1dd2925cb05b456a4c651d5c88d7b5af57c4484939c9 |
