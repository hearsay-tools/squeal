# 018-17 notes: `squeal ci export --parts`

Worker b64bf01f, 2026-11-09. Spec 018 D9, D2, D11. For whoever continues (018-20, the reviewer).

## Where things are

| Part | File |
|---|---|
| Keys and results of the parts, the flow | `src/core/ci/export.ts` (`ciExport`, `keyFiles`) |
| The refusals, each named (`RefusalKind`) | `src/core/ci/export-check.ts` (`partsRefusal`, `runDifferences`, `jobRefusal`) |
| Parts as the `RunReport` a daemon's run would give | `src/core/ci/export-report.ts` (`partsReport`) |
| `keyParts` per file | `src/core/ci/export-parts.ts` (`keyPartsOf`) |
| The D2 bundle without stored rows | `src/core/ci/export-bundle.ts` (`bundleOf`) |
| The command | `src/cli/ci-export.ts` (`ciExportCommand`), dispatched from `src/cli/ci.ts` |

## How the job keys as a daemon does

The same steps as `test/kit/worktrees.ts` (`OpenWorktree.open` and `record`), with no daemon:

1. `WorktreeKeys` over a scratch store in a temp directory, `bootstrap` (hashes every file git lists).
2. `setEnvironments(runner.environment())`; the job's descriptor per project is then in the scratch store (`worktreeEnvironment`).
3. Each passed file the runner lists: `setClosure(runner.closure(ref))`, `trackUntracked`.
4. The parts as one `RunReport` (`partsReport`), through `observedGrowth` and `addObserved` (the record path), `trackUntracked`, `writeSeen`.
5. Per file: `keys.index.key`, `keys.index.closure`, and `recordsForFile` (the daemon's rows: each test check plus the file check `pass`).
6. `bundleOf`: environments and observed entries read from the scratch store as `exportResults` reads a daemon's.

The adapter is the daemon's (`daemonVitest` in the command): observing per policy, `vitest.excludeProjects`, `vitest.exclude`, and Squeal's coverage provider when coverage is on, because the provider's marker is in the `coverage` config field and so in the environment hash.

## Decisions the spec did not settle

- **The job's own environment is compared with the shards'.** The export's keys hold the job's environment hash, so a shard on another Node, platform, adapter version or config would make wrong keys. Refused with kind `environment` unless the difference is in D10's fields (`allowOnly`, `watch`, `coverage`, `browser` when off in both) or in what Squeal's instance sets itself (`includeTaskLocation`, `snapshotOptions`). The same comparison is used between two parts of one project; it tolerates `coverage`, which Vitest 5.0.3 changes per shard.
- **Parts of another commit than the checkout are refused** (kind `checkout`), and a part without a commit (`no-commit`), and another key format (`key-format`).
- **No result rows are stored**, even in the scratch store: `test/keys/validity/reach.test.ts` allows `putMany` only in `store-results.ts` and `accept.ts`. So the bundle is built from `recordsForFile`'s rows (`bundleOf`), not by `exportResults`.
- **`keyParts` are computed beside the keying code**, not read from `KeyIndex`: an accessor on `KeyIndex` or `WorktreeKeys` changes the key-format alarm's bundle and needs a validity case. `keyPartsOf` uses the same objects `setClosure` uses (`Lockfiles.set` then `DependencyKeys.of(closure.packages)`; `RefusedObserved.keyed(ref, observedOf, runtimeIdentity)`). A wrong part cannot re-key a file: the import's proof recomputes the exported key. The end-to-end test checks the proof for every file.
- **`dirty`** in the export header is the job's checkout or any part's (provenance only; git status counts untracked files, so refusing dirty parts would refuse most CI checkouts).
- Files the job's runner does not list (policy `vitest.exclude`, a browser file) or whose closure fails are counted as "could not key" and left out.

## What the next rows must know

- **No test location in an exported result.** The project's own Vitest run collects none (`includeTaskLocation` is Squeal's own option), so a part's checks have `location: null`, and imported test checks show none until a local run. Keys, closures, observed entries and outcomes equal the daemon's (`test/ci/export.test.ts`). A test name used twice in one file: `checkNames` (`src/runners/vitest/results.ts`) suffixes the second with its line, so a part without locations names it `x (line ?)` where the daemon names it `x (line 12)`, and the import then holds a check no local run gives. Not tested; the fix belongs to 018-16's recorder (ask Vitest for locations in the hook, or leave such a file out of the part).
- **Gitignored files a shard read are keyed by their content in the export job's checkout**, as a daemon there keys them. The job must prepare its checkout as the shards did (install, generated files). The import's proof at the commit fails for such files (the commit holds no blob for them), so they import at the exported key only (D3).
- The scratch store holds the environments, observed entries and stat cache only; it is removed after the command.
- `ciExport` takes the runner as a factory, opened only after `partsRefusal` passes and closed at the end, so a refusal never starts Vitest.

## Checks

`test/ci/export.test.ts` (two real shards with `CI=true`, a daemon in its own clone, the export in a third; then the command end to end), `test/ci/export-check.test.ts` (each refusal), `test/ci/export-keys.test.ts` (counts, the job's environment refused, a project the job lacks), `test/cli/ci-export.test.ts` (usage, exit 1 cases, a refusal before Vitest starts, the help line).
