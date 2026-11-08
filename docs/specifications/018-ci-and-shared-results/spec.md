# CI and shared results: first slice, moving results between stores

Stage: approved by the human 2026-11-08, including the cezar workflow file of D7.

## Problem

Each new worktree and each fresh clone checks out content that main's CI has already tested, and runs those tests again. In cezar, CI on main had already run the content of 20% to 37% of local background test seconds (26% to 41% after cezar's lookup-only start on 2026-11-06), mostly catch-up after rebases onto main. In squeal it was 7% to 15% (`research/main-results.md` 1). Results computed on one machine never reach another: worktrees of one clone share a store, other clones and CI do not.

Two things stop reuse today. Squeal has no way to move results out of one store and into another. And no CI key equals a developer key: the Node version, `CI=true` and Squeal's coverage provider each change the environment hash (`main-results.md` 3). The store keeps only that hash, so nobody can see which part differs.

## Goals

1. `squeal export` writes the current passing results of a worktree to one file, with the closure lists and observed sets a fresh store needs to compute the same keys.
2. `squeal import <file>` adds those results to the local store. A result counts only where the key the local daemon computes equals the exported key. Nothing else changes for the local daemon: it computes every key itself, as today.
3. `squeal status` says how many imported results are current, and names each difference that stops the rest from matching, for example `Node v26.13.0 in the export, v24.22.1 here`.
4. One trial in cezar counts how many results exported by CI are current in a fresh developer clone at the same commit (D7). It needs a change to cezar's CI that the human approves first.
5. Nothing in this slice is tuned to this host or this repository (human, 2026-11-07).

## Non-goals

- Transport: no git notes ref, no download, no automatic import at daemon start. The user passes a file. The transport is the next slice, after the trial (`research/remote-store.md`).
- Failures in exports. Passes and skips only. Imported failures as held failures (`result-import.md` Q2) come later.
- Any key change. No `KEY_FORMAT_VERSION` raise; no Node-by-major rule; no tolerance for the `CI` fields of the Vitest config. The trial removes the CI variables instead (D7). Whether Squeal should treat `CI=true` as equal for passes is an open question for the next slice.
- Squeal reading the project's own runner report in CI (`main-results.md` 4, option B). The trial runs `squeal run --all` in a separate, non-gating job (D7).
- Coverage records (`code.sqlite`). Imported results carry none; such files read "no coverage" until a local run.
- Any change to another repository. D7 is a proposal.

## Design

### D1. The environment record

Today the environment hash is computed in `src/core/scheduler/keying.ts` (about lines 265 to 276) from the core inputs and the runner environment, and only the hash is stored. The daemon now records the parts too, where they are known (styleguide: record a fact where it is known).

An `EnvironmentDescriptor` per environment hash:

| Part | Stored as |
|---|---|
| key format, runner name, runner version, adapter version, Node `process.version`, platform, arch | plain values |
| installed-dependency fingerprint | its hash |
| allow-listed environment variables | the sorted names and one hash of the values (never a value) |
| resolved runner config | one hash per top-level field (`allowOnly`, `snapshotOptions`, `coverage`, ...), never a value |
| config and setup files | the `[file, blob hash]` list the hash already uses (relative paths) |
| whether the process saw a CI environment | a boolean, as a hint for the difference text only; not part of any key |

The descriptor is derived from the same objects the hash is computed from, in the same call, so the two cannot disagree. A test proves that two descriptors with equal parts give equal hashes, and that a change in any one part changes the hash.

Storage: a table `environments(hash primary key, descriptor json, recorded_at)` plus `worktree_environment_hashes(worktree_id, project, hash, recorded_at)` (named so because release 0.1.415 already has a `worktree_environments` table with other columns; 2026-11-08, row 018-06) for the hash each worktree keys each project with now. Both are created by the first write, outside `schema.ts`, in the pattern of `IMPORT_GRAPH_TABLES` (`src/core/store/import-edges.ts`), so the key-format alarm does not fire.

`describeDifferences(a, b): Difference[]` is a pure function. Each `Difference` names one part and, for plain values, both values; for hashed parts, the names that differ (`config fields allowOnly, snapshotOptions`; `allow-listed variables differ (names: A, B)`; `installed dependencies differ`). When the exporting side saw a CI environment and only config fields differ, the text adds `(the export ran with CI set)`.

### D2. The export file

One gzipped JSON file, `format: "squeal-results/1"`:

- `header`: Squeal version, key format, commit SHA of `HEAD`, whether the tree was dirty, creation time, and the source where it is known from the environment (`GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, `GITHUB_REF`, `GITHUB_EVENT_NAME`, `GITHUB_SHA`); otherwise `local`. The commit and the source are recorded, never inferred later.
- `environments`: hash and descriptor for each project exported.
- `testFiles`: per test file, project, path, its current key, its closure list, `complete` and `method`, and its entries in the observed maps (`observed`, `observedDirect`, `observedModules`; `observedStartup` per project).
- `results`: per check, project, test path, kind, full name, location, key, outcome (`pass` or `skip`), duration.

What is exported: for each test file whose key in this worktree is computed and not pending, the results at exactly that key, when every check of the file at that key passed or was skipped. A file with any failure at its key is left out whole. A file without a current key is left out and counted.

Never in the file: failure text, run logs, environment values, absolute paths, the worktree id, the user, HOME. Export checks every path it writes is relative and refuses otherwise. The export reads the store only and needs no daemon, but it needs keys the daemon has computed; with none it says so and writes nothing.

`squeal export [--out <file>]` (default `squeal-results-<commit8>.json.gz` in the working directory) prints the counts: test files exported, results, files left out by reason (no current key, a failure at the key).

### D3. Import

`squeal import <file> [--dry-run]` opens the store for writes (`src/cli/store-writes.ts`, as `retry` does today). It refuses a file whose format is unknown or whose key format differs from this Squeal's, and names both. Then, in one transaction:

1. An `imports` row: id, header, file hash, imported time. Created outside `schema.ts` like D1's tables.
2. Checks through `ensureCheckId` (ids are local), and results through `putMany` at the exported key, with provenance naming the import (D4), `commit_sha` from the header, `dirty` from the header, and `recorded_at` set to the import time so running daemons see the new keys through `StoredKeys` without a restart.
3. Closure lists: added only for a test file the store has no row for. An existing row is never changed.
4. Observed maps: an entry is added only for a test file that has none in the local map; an existing entry is never changed or merged. `observedStartup` is added only when the project has none. Reason: a merged set changes the local key and would re-key results the store already holds (`main-results.md` 3).
5. The environment descriptors from the file go into `environments`.

A result at a key no local worktree computes is stored and unused, and pruned under today's rules. The import never queues a run and never changes a local key, so under `baseline.onStart: lookup-only` it only adds results to look up (`result-import.md` Q6).

After the transaction it tells the running daemons of this repository, as `retry` does, and prints what it can know at once for this worktree: results added, and, per project, whether the export's environment equals this worktree's current one (D1), with the differences named. `--dry-run` writes nothing and prints the same.

Rejected: import through the daemon over IPC. The CLI already writes the shared store safely (WAL, short `BEGIN IMMEDIATE`), and an import must work before any daemon has started.

### D4. The imported origin

A result's origin is derived today, not stored: another worktree's id means `inherited` (`src/core/state/derive.ts`, `originOf`). An imported result gets a third kind, `imported`, with the import id, its source label (`CI run <id> on <repository> at <commit8>`, or `local export at <commit8>`) and its commit. It is current by today's rule, an equal key (vision principle 2: the key proves the same content and environment).

The import is marked in the provenance's worktree field with an id that cannot collide with a worktree id (worktree ids are 16 hex characters); `originOf` looks the id up in `imports`. Every `origin.kind` switch handles the new kind, and an older daemon that shares the store and meets a row it does not know must treat it as "no known origin", never fail. The worker confirms how `known_states` is read across worktrees before choosing.

Where it shows, beside `inherited` today: `status --full` (`Imported: N of M current from <source>`), the hook header's count, `why` (`Imported PASS from <source>`), and failure provenance.

### D5. What status says about imports

`squeal status --full` and `--json` gain, per import that has any result for this worktree's test files:

- how many of the exported test files are current here from the import: a file counts only when its current known states come from this import (validity `current`, origin `imported` with this import's id). An equal key alone is not enough (review wave-1-2 B1, 2026-11-08);
- for the rest, the count by reason, in this order: another result kept at the same key (the key matches, but this worktree's current result at it is its own, inherited or from another import, for example a local failure the add-only import did not replace); not adopted yet (the key matches, but the daemon has not taken the imported result yet); environment differs (with D1's named differences); closure list differs; observed set differs; content differs (equal environment and lists, so a file's bytes differ: the expected case after the commit moved); no local key yet.

The default `status` text adds one line only when an import exists, none of its files is current from it, and the environment differs for every file that is not current; it names the first two differences. Silence otherwise (principle 1), including a mix of environment and other reasons (review wave-1-2 N1).

### D6. Trust and principle 5

The user chooses the file in this slice, so trust is the user's. The design keeps the rule `result-import.md` Q3 sets for any later transport: only results from pushes to the default branch of the same repository. A forged file cannot make a pass stand for other content, because the local daemon computes every key; it can only lie about the outcome at a true key, as a teammate sharing a store could today.

Principle 5 ("Squeal does not replace ... CI. They stay the source of truth for results"): CI's runner produces every result; Squeal only carries results to developer machines and qualifies them, current only at an equal key and named as imported. Nothing in CI gates on Squeal, no CI run is skipped, and CI keeps its full suite.

### D7. The trial in cezar (CI change approved by the human, 2026-11-08)

Question: in a fresh clone of cezar at the commit CI exported, how many test files are current from the import alone?

Proposed CI change, one new file in cezar and nothing else: `.github/workflows/squeal-results-trial.yml`, `workflow_dispatch` only, non-gating, never in the merge queue's required checks. Its one job, on `ubuntu-24.04`:

1. Checkout of the dispatched SHA (a main commit), pnpm `12.11.2`, `pnpm install --frozen-lockfile`.
2. Node pinned to the developers' version (`v24.22.1` today; the dispatch takes it as an input). Only this job pins it; cezar's test jobs keep theirs.
3. Squeal installed from the release the developers run (the dispatch input names it; it must be a release with `export`).
4. `env -u CI -u GITHUB_ACTIONS squeal run --all --wait <ms>`, then `squeal export`. Removing the CI variables keeps Vitest's CI-derived config fields equal to a developer's; the export's header still records the GitHub run. Squeal's coverage provider is on by default, as on developers' machines.
5. Upload the export as an artifact, kept 7 days.

Cost: one full run of cezar's Vitest suite in one job (the browser group is `at: manual` and stays out), once, plus one or two re-runs if the first shows a cause to fix. No change to cezar's required checks, Node versions or merge queue.

Developer side, by a worker of this spec: a fresh clone of cezar at that SHA under `$TMPDIR` with its own store, `squeal import`, `squeal start` with lookup-only, then `squeal status --full --json`. Result: files current from the import, of all test files, and the D5 reasons for the rest. A second count in a fresh worktree of the existing clone shows what the shared store already gave. Findings go to `research/import-trial.md`.

Not chosen: the steps inside cezar's merge-group test job (it touches the gating path, and Squeal cannot yet read Vitest's own report: `main-results.md` 4 B); a scratch repository (it would not answer the question for a real project).

## Testing

- D1: equal parts give equal hashes and any one changed part changes the hash and appears in `describeDifferences`; descriptors carry no value of an allow-listed variable or a config field.
- D2 and D3: a round trip between two fixture stores. Export from store A, import into an empty store B with the same files: every exported file is current in B with origin `imported`. Then the same with B already holding a different observed entry for one file: that entry is unchanged and that file reads "observed set differs". A file with one failure is not exported. A key-format mismatch is refused. The export holds no absolute path and no failure text (a test greps the file).
- D3: a running daemon sees imported results without a restart.
- D4: `why`, `status --full`, the hook header and failure provenance name the import; an unknown origin kind read by the older reader path does not throw.
- D5: each reason, in order, from fixtures.
- Verification as `docs/process.md` says: affected checks through `squeal status --wait`, CI for the full suite.

## Open questions

1. `CI=true`: should Squeal treat the CI-derived Vitest fields as equal for imported passes, so CI need not remove the variables? Owner: the coordinator, after the trial, as a proposal to the human.
2. Observed sets: is a subset rule (accept when the local set is a subset of the export's) safe? Owner: the trial's findings.
3. Transport and automatic import (git notes ref written by CI on main, read at daemon start and on a `HEAD` move). Owner: the next slice's spec section, after the trial.
4. Failures in exports, held on import. Owner: the next slice.
5. Squeal's cost in a CI test step (`main-results.md` open question 1). The trial job measures a separate run, not the step; owner: the next slice.

## References

- `research/main-results.md`, `result-import.md`, `remote-store.md`, `ci-run.md`, `ci-reuse.md`.
- `docs/decisions/0002-content-keyed-shared-store.md`.
- Spec 011 C4 and row 011-159 (held failures, lookup-only), spec 015 (coverage provider in the key).
