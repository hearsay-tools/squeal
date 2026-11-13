# Row 020-48: the gate keeps run-time readers while a daemon serves (#206)

Worker 2e2bd6e8, 2026-11-13. Brief `../wave-17.md`, section 020-48. Research `../../research/issue-206.md` and `../../research/no-daemon-reuse.md` (option 2, "the serving daemon"). Base `f15692098` (main at 0.1.464).

## Change

- **Wire** (`src/core/types/daemon-writes.ts`, by agreement with the coordinator, request `b5cd5cbb`): `KeepWrite` gains a third kind, `{ kind: "seen", seen: SeenReads[] }`. `SeenReads` is one completed test file's reads for the shared rows: `ref`, `add` (`observed.`), `direct` (`observedDirect.`), `modules` (`observedModules.`). It is the shape the keeper already merged where no daemon serves (`keep-seen.ts`, `Seen`, now an alias of it).
- **Parse** (`src/core/daemon/keep-protocol.ts`, `parseSeen`): the write is checked whole: 1 to 100,000 entries, each with exactly those four fields, `ref` a project and a relative test path, the three lists relative paths. The refusal of an unknown kind now reads `"write.kind" must be "coverage", "results" or "seen"`.
- **Daemon** (`src/core/daemon/keep-request.ts`): a `seen` write runs `mergeSeen` (the 020-39 merge: the daemon's own `ObservedSets` and `ModuleSets`, `SharedPaths.write`) on the daemon's store, once, in its retried path (`DaemonWrites`, one busy slice). A busy store answers `kept: false`, as for the other kinds.
- **Keeper's daemon writer** (`src/core/code/gate/keep-sent.ts`): `writeThroughDaemon` gains `seen`. It sends the reads in parts whose write is at most `SEEN_BYTES` (4 MiB) as JSON, in order (`partsOf`; repair R2 below); a keep line may be 32 MiB. A refusal of a `seen` write by a daemon before this row throws `OlderDaemon` (`keep-seen.ts`): the released refusals `"write.kind" must be "coverage" or "results"` (0.1.450 to 0.1.464), `unknown request type "keep"` (before 0.1.450) and `this daemon takes no kept files`.
- **Keeper** (`src/core/code/gate/keep.ts`, `#write`; `keep-here.ts`, `writerFor`; `keep-seen.ts`, `keepSeen`): the merge goes first, through whichever writer serves, as before for the keeper's own. `keepSeen` returns `"kept"`, `"spent"` or `"older"`. Grown files (kept at the key with their reads) are dropped and told as not kept only when no writer merged the reads: no daemon has a fresh heartbeat while one holds the lock, or the daemon is older (`"older"`). The other files are written in both cases. `writerFor` now returns the daemon's writer when there are only reads to send (`at.seen`), so a first-seen read is merged through a serving daemon too.

## Seam map (for the next worker)

- A `keep` request goes: `keep-sent.ts` `tryOnce` → socket → `protocol.ts` `parseRequest` → `write-protocol.ts` → `keep-protocol.ts` `parseKeep` (a parse failure is answered as `errorResponse(why)`, which is what lets the keeper read an older daemon's refusal) → `handlers.ts` `RequestDesk` → `desk.ts`/`front-desk.ts` relay to the main thread → `daemon.ts:1026` `requestKeep` → `keep-request.ts` `keepInDaemon`. Only `parseKeep` and `keepInDaemon` needed a change; the desk passes the request through whole.
- The gate's keys sit on a scratch store seeded from the repository's observed rows at the lookup (`gate/stored.ts`). So the next gate run keys the file with the read as soon as the rows hold it, whoever merged them.
- The daemon's own `WorktreeKeys` read the shared rows into views once and then only on `refreshObserved(projects)` (`scheduler.ts:901`; called after an import, `daemon.ts:1095`). The keep path does not call it (that is `daemon.ts`, outside this row). Read in source code, not measured: after a gate run, the serving daemon's own key for the file lacks the read until such a refresh or a restart, so `squeal status` does not show the gate's result as current at once, and the daemon may run the file itself, which stores at the same grown key. The gate's reuse does not depend on it.

## Decisions the spec did not settle

1. **A write kind of its own, not a field of the results write.** The reads of files not kept (a read first seen during the run) and the direct and module marks of files with no growth must be merged too, as 020-39 merges them (its decision 2), and one merge per flush is the cost the research measured. A new kind also makes an older daemon refuse before any file is written, so the keeper can still write the others.
2. **An older daemon is known by its refusal text**, as `refusal` already knows a daemon before the `keep` request. A version in the heartbeat was not used: a dev build's version says nothing reliable about the protocol.
3. **The parent's condition (reply to `b5cd5cbb`)**: an older daemon's refusal of the reads costs only the grown files. The non-grown files are written in the same flush, through the same daemon.
4. **Parts of 4 MiB.** A gate run's reads are some KB (research: median 5 paths a file), so most runs send one part. Repair R2 makes the bound hold for each write as sent (see below). A later part refused as busy or lost sends every part again on the next try; a merge that adds nothing writes nothing (`mergeSeen` checks first), so a repeat costs a read of the rows only.
5. **"With the checks its own record applies."** What bars a keep stays the keeper's run evidence decision (row 011-319 shares it with the daemon's record): first seen, moved, runtime, merge hold, listing. It is decided before any write. The daemon's results write keeps its heal check over the file's `paths`, which hold the reads for a grown file (`atStoreKey`), as the daemon's own record judges `inputs` with the growth. The daemon adds no check of its own on the reads; it does not compute the key again either, as for any results write at the gate's key.
6. **Other refusals of the reads** (a stopping daemon, another worktree, another store schema) end the flush as a refusal of the first file write does today, with the grown files counted among those not kept.

## Proposed spec text (coordinator's)

D17.3, after the row 020-39 amendment, replace "where no daemon serves the worktree, the keeper also stores at the key with what the run read, ..." with:

> Amended 2026-11-13 (row 020-39; research `research/no-daemon-reuse.md`), and row 020-48 (#206): the keeper also stores a file at the key with what its run read. The runs' reads are merged first into the shared observed rows (`observed.`, `observedDirect.`, `observedModules.`), as the daemon's record merges them: by the keeper, in one transaction of its own, where no daemon serves the worktree; by the serving daemon, in its retried path, where one does (`keep` requests of kind `seen` before the files' writes, each write at most 4 MiB as JSON; a test file's reads that do not fit go on in the next one). A daemon before row 020-48 refuses the reads: each file kept at the key with its reads is then not kept, with the line "read paths its key lacks", and the others are written. The bar "the run read a path its key lacks" becomes "the run read a path first seen during the run, or one that moved before the write". A git-ignored read is kept one run later.

Spec 021 D15 lists what a `keep` request writes (a file's coverage record or its results): it gains "or the gate runs' reads for the shared observed rows (row 020-48)".

## Type changes

- `src/core/types/daemon-writes.ts`: new `SeenReads`; `KeepWrite` gains the `seen` member (additive; agreement `b5cd5cbb`).
- `src/core/code/gate/keep-seen.ts`: `Seen` is now `type Seen = SeenReads` (same shape as before); `keepSeen` returns `"kept" | "spent" | "older"`; new `OlderDaemon`.
- `src/core/code/gate/keep-sent.ts`: new exports `SEEN_BYTES`, `partsOf`; the daemon writer has `seen`.
- `src/core/code/gate/keep-here.ts`: `writerFor`'s `at` gains `seen: number`.
- `KeepWriter.seen` stays optional (a test writer outside this row has none); its comment changed.
- Test kit `test/code/gate/keep-daemon-kit.ts`: `ServedOptions.takesSeen` (false: an older daemon), `keepsOf`.

## Done-when mapped to tests

| Done-when | Test |
|---|---|
| #206's shape reads 2/2 from the stores on the second gate run with a serving daemon | `test/cli/code-gate-keep-grown-daemon.test.ts`, "is kept on the first run, and both files are read from the stores on the second": a lookup-only daemon serves and holds the lock (asserted), run 1 runs both with no "not kept" line and the row holds `data/table.json`, run 2 runs nothing, `from` both `store`. |
| ... and still with none | Same file, second test: with the daemon stopped, the run after the change reads both from the stores. Also `test/cli/code-gate-keep-grown.test.ts` (row 020-39), unchanged. |
| a changed `data/table.json` reruns it | Same file, second test: `ran` is `[test/reads.test.ts]`, `plain` from the store. The daemon is stopped first: a daemon whose keys learned the read could run the file after the edit and store it, which the gate would then read; correct, but not a fixed outcome for a test. Unit: `keep-grown.test.ts`, "keeps nothing at that key once its read moved before the write". |
| first-seen, runtime and merge-hold checks still refuse | `test/code/gate/keep-grown-daemon.test.ts`, "what bars a keep while a daemon serves": a read first seen during the run and a merge hold keep `a` from the daemon's writes and write `b`, each with its line; a moved runtime identity keeps both; a first-seen read is still merged through the daemon. |
| an old-protocol daemon answer keeps today's "not kept" line | `keep-grown-daemon.test.ts`, "is told as not kept, as before, by a daemon before this row, which writes the others" (the line, `b` written, nothing merged) and "is not kept, with the notes before this row, where the daemon takes no kept files". |
| (protocol) | `test/daemon/keep-seen.test.ts`: the parse and six refusals, the parts, the daemon's merge and its busy answer. |

The old case "does not keep it, and merges nothing, while a daemon serves the worktree" is replaced by the first case of `keep-grown-daemon.test.ts`. The grown tests' helpers moved to `test/code/gate/keep-grown-kit.ts`.

## Checks

Run:

- `pnpm run lint`: `Checked 3327 files in 966ms. No fixes applied.`
- `pnpm run typecheck`: exit 0, no output.
- `squeal status --wait 600000 <the src and test paths this row changed>` at revision 20 (`bc7809b92`): 496 affected test files, each with a current result, after 313.2 s; 492 pass, 4 fail, the four bundle checks named under "Not run". Each new or changed keep test file read current and passing at its revision: `keep-grown.test.ts`, `keep-grown-daemon.test.ts`, `keep-daemon-lost.test.ts`, `keep-daemon.test.ts` (revisions 11 to 14), `test/daemon/keep-seen.test.ts` (15), `test/cli/code-gate-keep-grown-daemon.test.ts` (18).
- `pnpm exec vitest run test/code/gate/keep-grown-daemon.test.ts test/code/gate/keep-grown.test.ts`, once, to see the count Squeal does not print for passes: 10 passed.

Not run:

- `pnpm run build`: the wave forbids it in a worker tree. Four bundle checks fail as expected until the coordinator rebuilds: `test/harness/plugin.test.ts`, `test/harness/codex/packaging/runtime.test.ts`, `test/harness/opencode/package.test.ts`, `test/harness/pi/package.test.ts` ("cli/front-desk.mjs" or "cli/squeal.mjs differs from the build").
- No full suite (policy). No run of the issue's probe on a built CLI.

## For the next worker

- Bundles: rebuild at integration (`plugins/claude-code/dist` and the others).
- A follow-up, outside this row: let the keep path call the scheduler's `refreshObserved([project])` after a `seen` merge (`daemon.ts`), so the serving daemon's own keys learn the reads at once.
- `test/daemon/request-desk.test.ts` says "Every field of a keep write: `keep-protocol.test.ts`"; no such file exists. The `seen` fields are tested in `test/daemon/keep-seen.test.ts`; the coverage and results fields have no whole parse test.
- `src/core/code/gate/keep.ts` is 392 lines (376 before this row), over the 300-line guide before it.

## Repair R2 (review `../../reviews/0.1.465.md` S1; brief `../wave-17.5.md`, R2)

The finding: `partsOf` never split one file's reads and counted only the entries, so one file of 50,000 long paths made one write of 5,688,994 bytes against the 4 MiB bound. Below the 32 MiB line limit, so no request was refused; the bound in the docs did not hold.

**Fix** (`src/core/code/gate/keep-sent.ts`, `partsOf`, `SeenParts`): a part is counted as the write that sends it, `{"kind":"seen","seen":[...]}`, from the frame's 25 bytes, each entry's empty shape, each path's JSON and every comma. Paths go in one at a time, in the order `add`, `direct`, `modules`. A path that does not fit closes the part; the file goes on in a new entry of the same `ref` in the next part (an entry left with no path is taken back out of the closed part). The merge adds paths to sets (`mergeSeen`), so the entries of one file across parts merge to the whole lists. One exception: a path that alone with its file's ref passes the bound goes in a part of its own, over the bound; at 4 MiB that takes a path of about 4 MiB, which no file system gives. The bound counts the write, not the request around it: the type, id, worktree and schema add a few hundred bytes, under the 32 MiB line limit. Sequence and waits do not change: the `seen` parts first, then each file's coverage and results; one 30 s busy bound; the owed input check after a pause; an older daemon's refusal of the first part costs only the grown files.

**D17.3 wording.** The spec on `origin/main` (`2ab1588ff`) does not yet hold this row's amendment, so the change is to the proposed text above: "in parts of at most 4 MiB" becomes "each write at most 4 MiB as JSON; a test file's reads that do not fit go on in the next one". With the fix, the bound is true as written; no other spec text changes.

**Tests** (`test/daemon/keep-seen.test.ts`), each red on the old `partsOf` first (4 of 4 failed in a direct run), then green:

| Done-when | Test |
|---|---|
| every serialized part at most the bound, at the boundary | "keeps whole files together while the write fits the bound, at the boundary too": a bound equal to two files' write keeps them in one part; one byte less splits, every part within it, the lists whole. |
| ... and for one file larger than it | "splits a file larger than the bound across entries of its ref, each part within it" (a bound a third of the file's write: more than three parts, the largest within the bound), and "sends the review's 5.7 MB file in parts within the default 4 MiB" (the review's own shape: two parts, each within `SEEN_BYTES`). |
| all three lists and their order survive the merge | Each test above joins the parts' entries per file and compares the three lists, in order, with the input. "merges a file's reads split across parts whole into each of the three rows": a file of 300 paths a list, split in more than three parts, each part merged by `keepInDaemon`; the `observed.`, `observedDirect.` and `observedModules.` rows hold every path. |
| (the exception) | "sends one path a part when a path with its file alone passes the bound". |

The old case "never splits one file's reads, past the bound alone" asserted the defect and is replaced.

**Checks (R2):** see the worker's report for the commands and their output.

