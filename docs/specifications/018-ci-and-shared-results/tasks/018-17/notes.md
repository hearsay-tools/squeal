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

## Repair R1 (review of 0.1.421, B1 to B4, S1)

Worker 52197e72, 2026-11-09. Part format `squeal-ci-part/2`; a format 1 part is refused by `readPart`.

### Where things are now

| Part | File |
|---|---|
| Hashing what a file read; the checkout's state; the certification rule | `src/core/ci/inputs.ts` (`withInputs`, `readCheckout`, `uncertified`) |
| The rule over a keyed file's closure in the job | `src/core/ci/export-inputs.ts` (`certifier`) |
| Shard set, snapshot options by field | `src/core/ci/export-check.ts` (`shardRefusal`, `runDifferences(RunView, RunView)`) |
| Snapshot options hashed by field | `src/core/ci/parts.ts` (`snapshotFields`) |
| Shard, shared names in the part body | `src/runners/vitest/ci-runs.ts`; the hook writes `shard` (`vitest-ci.cjs`) |
| Inputs hashed at the end of the recording | `src/runners/vitest/ci-record.ts` (`finish` is async now) |
| Checkout read before and after the command | `src/cli/ci.ts` `record`, `writeParts` (three lines) |

### The rule (B1)

For each input of a keyed file's closure in the job (static and observed):

1. Recorded by the part (`PartFile.inputs`): certified only when equal to the job's hash. Files are hashed as the stat cache hashes them (`createFsHasher`); listings as the names on disk on both sides (`listingHash`), not the key's tracked-names hash, since the run saw the names on disk; `.git` by kind.
2. Not recorded, shard `clean` (no tracked change before and after the command): a path the commit tracks must hash here to the commit's blob; a path the commit lacks must be absent here and below no untracked or ignored entry of the shard (`git status --ignored=matching`, before and after the command).
3. Anything else (a dirty shard, an unrecorded listing or `.git`, a path git reported as untracked or ignored and the part did not hash) is not certified: the file is left out, counted, and the first three files are named with their inputs.

Rule 2 exists because Vitest's static closure holds paths no worker reads (the config, `package.json`, a snapshot path whether or not it exists). Without it every file would be left out. The real two-shard comparison still exports all four files.

### Decisions the brief did not settle

- Inputs are hashed after the command exits, not at each read. A file the run changed then reads as its end content and is left out.
- `clean` ignores untracked files; `dirty` stays as provenance in the header.
- B4 leaves the file out (`ambiguous` count), not the whole export. The recorder names the shared full names (`sharedNames`); daemon naming is unchanged.
- B3: exactly one completed part per shard index of one count. A shard whose command starts two Vitest processes is refused (kind `shards`); conservative, as the brief allows.
- B2: a snapshot option difference is refused as kind `environment`, named `snapshotOptions.<field>`.
- `readCheckout` never throws, since it runs before the project's command (D16): a failed git reads as not clean with no entries, which certifies only hashed inputs.

### Limits

- A path inside a submodule is neither a commit blob nor in git status (`--ignore-submodules=all`): unrecorded, it counts as absent. It is certified only when absent here too.
- Reads in Vitest's main process (its transform of imported modules) are not attributed to a test file. An ignored generated module a test imports is therefore not recorded, and the file is left out (rule 3).
- Cost per shard: each read file hashed once, each recursive listing walked (`.git` and `node_modules` skipped), two `git status` calls.

### For the coordinator and 018-20

- `vitest-ci.cjs` changed: `dist/ci/` needs the coordinator's rebuild (no `pnpm run build` here).
- `ciExport`'s success value has `uncertified` (files and inputs); `CiExportCounts` has `uncertified` and `ambiguous`. Publish only after exit 0, as before.
- `tasks/018-16/notes.md` still describes format 1; this section supersedes its part fields.

## Repair R2 (second review of 0.1.421, B1; the human, 2026-11-09: "A: one owner, repair")

Worker a4580a6b, 2026-11-09. Part format `squeal-ci-part/3`; formats 1 and 2 are refused by `readPart`. This section supersedes R1's rule (B1) and its "Inputs are hashed after the command" decision; R1's B2, B3, B4 and S1 are unchanged.

### Where things are now

| Part | File |
|---|---|
| Evidence at each access: content, listing names, absence, writes | `src/runners/vitest/ci-runtime/evidence.cjs` (`createEvidence`) |
| Which calls take it: `fs`, `fs.promises`, module resolve, entry point, flush | `src/runners/vitest/ci-runtime/evidence-hooks.cjs` (`installEvidence`) |
| Loaded first in every process and thread of the command | `vitest-ci.cjs` (`readEvidence`, before it requires `vitest/node`) |
| Settings (`SQUEAL_CI_RECORD.evidence`: `out`, `root`, `skip`, `format`) | `src/runners/vitest/ci-record.ts` (`startRecording`) |
| The command's evidence, writes applied | `src/core/ci/inputs.ts` (`readEvidence`) |
| The rule | `src/core/ci/inputs.ts` (`uncertified`), `export-inputs.ts` (`certifier`) |
| One evidence map per command, in each of its parts | `src/cli/ci.ts` `writeParts`; `Part.evidence` |

Removed: `withInputs`, `readCheckout`, `joinCheckouts`, `CheckoutState`, `PartHeader.clean`, `PartHeader.untracked`, `PartFile.inputs`, the export's `committedBlobs`.

### The rule (B1)

1. At each access the daemon's recorder counts as a read (`fs` read, stat, lstat, exists, access, realpath, a read-only open, a copy's source, a module Node resolves, the entry point), the hook records the path's git blob at that moment (`hashFile`'s rules: a symlink as its target text, no file `null`), and its kept symlink target's. A failed resolve records the exact path it names. At each listing: the names on disk (`namesHash`), and each directory's below a recursive one.
2. Before each write, create, rename, delete, copy target, link or `mkdir` (and after `mkdtemp`, once it names the directory), the hook records the path as written, with everything below for a delete, rename, copy or `mkdir`, and its directory's listing when the path appears or goes. Written paths are appended at once, before the call; evidence once per event-loop turn, before `process.send` and at exit.
3. `readEvidence` keeps a path only with one value in every process of the command and no write to it or above it. A path read with two contents has none.
4. The export certifies an input only when the evidence holds it and it equals the checkout's content (`here`: stat cache, `.git` kind, names on disk). No commit blob, clean checkout or unreported path stands for evidence.

### Decisions the brief did not settle

- **A probe that finds a file records its content** (stat, exists, access, realpath), not only a read. Vite 8 bundles `vitest.config.ts` with rolldown in native code; the only Node access is Vitest's `existsSync`. With reads only, the config had no evidence in a probe, and every file's closure holds it, so the export held nothing. Asked the parent (request 2abc53fc); default kept.
- **An open that can write marks the path written at the open**, so no descriptor is tracked; `r+` without a write still cancels.
- **A content write to an existing file does not mark its directory's listing**; a create, delete or rename does. Existence is asked with `readlink`, which the daemon's recorder does not observe.
- **The hook's own calls never add to the daemon's observations**: it opens, lists or stats only a path the run is accessing in that call, and uses `readlink` for written paths. `test/runners/vitest/ci-evidence.test.ts` compares the recorder's output with and without the hook.
- **Per process cache**: a file is re-read only when its stat (`dev`, `ino`, `size`, `mtimeMs`, `ctimeMs`) changed since its last hash in that process.

### Limits

- A process without the hook takes no evidence and its writes are not seen: a non-Node program (`sh`, `git`), native code (rolldown, esbuild), a child started with an env that drops `NODE_OPTIONS` or `SQUEAL_CI_RECORD`. Its reads only leave files out. Its writes are caught when the run reads the path afterwards (two contents) or the export's content differs; a write between a recorded read and an unrecorded one, restored before the export, is not.
- A path probed by Node and then read by native code is certified by the probe's hash; a non-Node change between the two is a race the evidence does not see.
- Worker threads take evidence when Node gives them the `NODE_OPTIONS` preloads; a thread ended by `terminate()` may lose its last turn's evidence (only leaves files out).
- Cost per process: one open, fstat and close, plus a realpath, per access under the root outside `node_modules`; a read and hash per new file version; one extra listing per listing (a recursive one again whole).

### Fixture files the stricter rule leaves out

- `test/ci/export.test.ts` (two real shards, four files): 0 left out; keys, closures and results equal the daemon's.
- `test/ci/export-evidence.test.ts`: both reading files exported at `GOOD`, left out at `BAD` or absent (content differs); the two shared-name files left out by B4, not by evidence.
- `test/ci/export-wrapper.test.ts` (the review's A, B, C, each with a Node and an `sh` writer): the changed file left out in all six; `test/plain.test.ts` exported in all six. With the Node writer the write cancels the evidence; with `sh` the read-time content differs from the export's. In C, Squeal's resolution candidates for `../src/generated.js` that Vite never probed have no evidence either.

### For the coordinator

- `dist/ci/` gains `evidence.cjs` and `evidence-hooks.cjs` (copied by `copyCiRuntime`, all `.cjs`); `plugins/codex-runtime/runtime.json` and the bundles need the rebuild (no `pnpm run build` here). `test/harness/codex/packaging/runtime.test.ts` lists the two files.
- `test/keys/key-format.test.ts` passes unchanged; no file under `src/runners/observe/` changed.
- `spec.md` D8/D9 and `tasks/018-16/notes.md` still describe the post-run hashes and checkout state.
