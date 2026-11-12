# Row 011-320: `squeal code` applies the runtime, merge-hold and editor-scratch checks

Worker ea62d171, wave 77 W1, 2026-11-12. Brief: `../wave-77.md` W1. Design: `../../research/run-evidence.md`, differences 2 to 4. Built on row 011-319's module (`../011-319/notes.md`). Widened by the human the same day ("Folder case: Add to the running row"): a fifth check, a file added to or removed from a listed directory (proposed row `keep-listing-revision`).

## What changed

The keeper (`squeal code`'s `Keeper`) now supplies four more sources to the run evidence module. Each makes `squeal code` stricter: a file the daemon would not store at the key it ran under is not kept. The daemon's decisions, `store-decision.ts`, `record.ts`, `record-tier.ts`, `keep-write.ts`, `keep-sent.ts`, `keep-here.ts` and every key are unchanged.

| Check | Source | Where |
|---|---|---|
| Difference 2, runtime identity | `WorktreeKeys.runtimeIdentity(ref)` at the lookup (`Expectations.add`) and at the run's end (`runEnd`'s identity), as `TierFile.runtimePolicy` and `recordTier` | `keep-expected.ts`, `keepDecisions`, `stored.ts` supplies the source |
| Difference 3, merge hold | The worktree's unmerged index paths, `git ls-files -u` as `MergeHold` reads them, again only when the index file's stat moved (`UnmergedIndex`); the held files go to `recordOutcome` as `RecordFacts.held` | `sources.ts` (`readKeepEvidence`, `UnmergedIndex`), `mergeHoldOf`, `unheldNow`; `Keeper.#steady` at each write |
| Difference 4, editor scratch, and the fifth, any file | Every file the lookup's keys hold below the files' listings (`copyListed`, from the stat cache the listings were hashed from, less ignored extras and the files below a symlinked directory), against the files git sees there at the decision (`git ls-files --stage`, `--others --exclude-standard` and `--deleted`, over the listed directories; no submodule, no untracked repository). A file that came or went moves every listing above it, the rule of `scratchMovedListings` and of `applyBatch`'s listings in `Tier.changes` | `listings.ts` (was `scratch.ts` until the fifth check), `readKeepEvidence` |
| The note | Each `FileDecision` carries a `cause` (kind of evidence and its paths); the keeper groups the completed files it did not keep by kind and tells one line per kind at `flush`, once the report is out, naming at most three test files and three paths (the coordinator, decision 3) | `reason.ts` (`causeOf`), `keep-reasons.ts` (`NotKept`), `keep.ts` |

`heldFiles` (`scheduler/hold.ts`) takes `Pick<MergeHold, "holding" | "names">`, by the coordinator's decision B (request 925491b5): a type-only change, its emitted code byte for byte as before (esbuild of `hold.ts` before and after, compared). Both callers' `mergeHeld` call it; the rule has one owner.

## The write-time recheck (brief, item 2)

Yes, the keeper reads the merge hold again at each write, as the daemon's `TierRecords.#heldNow` does at each try (review 0.1.273 B1): `flush`'s opening check and the `steady` callback both go through `Keeper.#steady`, which runs `stillAsRead` and then `unheldNow`. It costs no store write: one `stat` of the index file per check, and one `git ls-files -u` (5 ms here) only when the index moved. `keep-write.ts` is unchanged, so a file a merge holds at its write is told as the other files dropped there are: silently at `flush`'s opening check (as a changed input is today), and after a busy pause counted among "changed during the wait" by `keep-write.ts`'s notes. The editor-scratch and runtime checks are not repeated at the write: the daemon's record does not repeat them at each try either.

## The table: one row per case the sources cover

`test/run-evidence/table.test.ts`. The keeper's column equals the daemon's for differences 2 to 4 and the fifth, except the two rows where no revision of the file exists, where the keeper is stricter.

| Row | Daemon | Keeper | Covers |
|---|---|---|---|
| difference 2: the runtime's identity moved | environment | environment | identity recorded at the lookup, compared at the end |
| difference 3: a merge holds an input | requeue | requeue | a real unmerged index entry made during the run; the daemon's column reads it through a real `MergeHold.check()`, the keeper's through `mergeHoldOf` |
| difference 4: an editor's scratch file moved a listed directory | unstable | unstable | a scratch file added, a revision of it (a daemon serves) |
| difference 4, no revision of it: no daemon serves, or the record came before its batch | store at ran | unstable | no daemon, or a daemon whose watcher had not applied the batch: the keeper reads the disk |
| difference 4: an editor's scratch file left a listed directory | unstable | unstable | a scratch file there before the lookup, removed during the run |
| difference 4: an editor's scratch file moved a directory below a listed one | unstable | unstable | the ancestor rule (`ancestorListings`) |
| an editor's scratch file that was there before and stayed | store at ran | store at ran | a scratch file's bytes moving moves no listing |
| a file added to a listed directory, a revision of it | unstable | unstable | the fifth check; this row was "a revision during the run moved a listed directory, no input's bytes", keeper "store at ran", until the human widened the row |
| a file added to a listed directory, no revision of it | store at ran | unstable | no daemon, or a daemon whose watcher had not applied the batch |
| a file removed from a listed directory | unstable | unstable | a tracked file deleted, a revision of it |
| a file added below a listed directory | unstable | unstable | the ancestor rule for ordinary files |
| a symlinked directory below a listed one, nothing moved | store at ran | store at ran | the keys hold the files below the link (task 001-166), git the link alone: both sides leave them out. Without that, this row reads "unstable" in the keeper's column (checked by disabling it once) |
| an ignored file added to a listed directory, which the watcher drops | store at ran | store at ran | `--exclude-standard`, as the watcher drops ignored paths |

The difference 1 rows are unchanged, as the brief requires.

`test/run-evidence/keeper.test.ts` runs a real `Keeper` over a real store: the merge hold reader (read again once the index moved; no hold where git reads no index), a file a merge holds by its write is not written, a file whose runtime identity moved is not written and is named in the note, and a keeper given no runtime source compares no identity (the coordinator's request, reply to 3c6a475c). Also the note's grouping (`NotKept`). `test/cli/code-gate-keep.test.ts` gains one case: a file whose input a merge leaves unmerged runs, nothing is kept at its key, verdict and exit code are as before, and the note names it.

## Cases a source does not cover

- **Runtime identity, edits during the run.** The keeper's keys are a lookup's: they never reload the policy or apply a revision during the run. So the identity moves only through what those keys learn at the decision (`observedGrowth` marks the run's module loads and direct imports, which can protect a runtime file) and through a runtime path's kind on disk (`RuntimeFiles.classify` stats it). An edit of `runtimeFiles` in `squeal.config.json`, or a closure change, during the run is not seen; the daemon re-keys on it. A file whose inputs moved is caught by the stability check, so this case needs an edit that moves no input's bytes.
- **Runtime identity, callers without the source.** The source is optional (`Keeper.expect(…, runtime?)`, `KeepSources.runtime`): a caller without it compares no identity. `stored.ts`, the one production caller, always supplies it. The coordinator chose this (reply to 3c6a475c): the `WorktreeKeys` stubs of `keep-busy.test.ts` (row 020-30), `keep.test.ts` and `keep-daemon-kit.ts` have no `runtimeIdentity`.
- **Merge hold, a failed read.** A `git ls-files -u` that fails leaves the paths as last read, none before the first, as the daemon's `MergeHold.check` does; nothing is told (`keep.test.ts` runs the keeper in roots that are no repositories). In a real worktree the read does not fail.
- **Merge hold, the lookup.** `stored.ts` `evidenceAt` still reads a stored result at a key that names an unmerged path; the daemon takes none there (011 C9, `holdsAt`). That is a lookup, not a keep, so not this row's; a later row can close it.
- **Listings, a file that came and went during the run.** The keeper compares the files before the run with those at its end. A file added and removed again during the run (or removed and put back) leaves both the same, so the keeper keeps the run; a daemon whose watcher applied the add and the delete in two revisions puts the listing in `Tier.changes` and discards it. Only a serving daemon's revisions show it; reading them (`store.revisions.range` from the revision at the lookup, read-only) would close it where a daemon serves, with no store write. Not built: the human's wording asked for "with and without a serving daemon", which the comparison covers, and an editor's scratch file that comes and goes is exactly what row 011-117 does not count.
- **Listings, inside a symlinked directory or a submodule.** Both sides leave the files below a symlinked directory out, so a file added inside one, below a listed directory, is not seen; the daemon's change feed walks such directories (task 001-166) and would see it. Same for a submodule's files.
- **Listings the run first read.** The daemon also checks listings in the run's growth (review 0.1.268 B1). The keeper has no copy of those before the run. Such a file has growth, so its decision is "store at grown" or another, never "store at the key it ran under": it is not kept either way, and only the reason differs from the daemon's.
- **Listings, timing.** The keeper reads git at its decision; the daemon counts the batches applied before its record. A file that appears after the run ended and before the decision makes the keeper stricter, never looser.
- **Listings, a failed read.** A `git ls-files` that fails throws, and the keeper keeps none of that run's files, with its existing note ("the test files this run completed were not kept in the stores: …").
- **The note when the gate ends early.** The lines are told at `flush`; a gate that ends without `flush` tells none, and keeps nothing.

## Decisions the design did not settle

1. **Runtime source optional** (coordinator, reply to 3c6a475c, "default"): see above.
2. **`heldFiles` widened** (coordinator, reply to 925491b5, "B"): one hunk in `hold.ts`, type only.
3. **The note covers every kind of reason** (coordinator, reply to d997b2e2, "A, with a bound"): one line per kind, each naming at most the first three test files and the first three paths in path order, then "and N more", in the style of D14.4's incomplete-closure line. The one expected-stderr hunk of `test/cli/code-gate-children.test.ts` was mine by that agreement: it gains the line for its two files that read beyond their keys (difference 1, no daemon history).
4. **When the note is told.** At `flush`, with the keeper's other notes, so it follows the report and comes once per kind across all runs of the gate, not once per runner run.
5. **A listing's own cause.** A decision whose moved paths are all listings has the cause `listing`, so the note can say "a file was added to or removed from" (the human's words); a decision that moved inputs too keeps `unstable`. The reason text is the same for both ("src/ changed during the run"), as before.
6. **The listing copy's moment.** `copyListed` reads the lookup's stat cache, which the keys' listings were hashed from, not the disk at `Expectations.add`: a file created between the keying and the copy is then seen as moved, never as present before.

## The note's line formats (for the D17.3 amendment)

One line per kind, after the report, each prefixed `squeal code: ` by the CLI:

```
<N> completed test file was not kept in the stores, because <reason>[ (<paths>)]: <files>; the next run will run it again
<N> completed test files were not kept in the stores, because <reason>[ (<paths>)]: <files>; the next run will run them again
```

`<files>` and `<paths>` are each sorted by path, at most three named, then " and <M> more" (`listPaths(…, 3)`). `<paths>` is the union of the paths behind the kind, left out when the kind names none. `<reason>`, one file / several:

| Kind | Reason | Paths |
|---|---|---|
| merge hold | a merge holds a path its key names / their keys name | none |
| touched input | an input was written during the run and ended as it was | the touched paths |
| runtime identity | the runtime's identity moved during the run | none |
| listing | a file was added to or removed from a directory its key lists / their keys list | the listings, as `src/` |
| changed input | what its key names / their keys name changed during the run | the changed paths, listings among them |
| environment | it / they loaded environment files its key lacks / their keys lack | none |
| first seen | it / they read paths first seen during the run | the paths first seen |
| read beyond the key | it / they read paths its key lacks / their keys lack | the paths read |
| any other | the decision's reason, for example "the runner withheld the run" | none |

For example: `squeal code: 1 completed test file was not kept in the stores, because a merge holds a path its key names: test/held.test.ts; the next run will run it again`.

## What the listing check costs here

Measured 2026-11-12 on this worktree, beside the host's own load (0.9 to 1.3 per CPU over the session, from other tasks' daemons and runs; none made for this), with the keys `squeal code` builds (`openDaemonKeys` on a scratch store, as `stored.ts`), every listing in this clone's shared observed set (`observed.` meta row, read-only), a throwaway probe under `$TMPDIR`:

- 1,125 test files have an observed set; 206 of them (18%) list at least one directory; 493 distinct listings (most: the four `evals/ledgerline/test/` listings, 94 files each). A file that lists none costs nothing: both steps return at once.
- All 493 at once, the worst case: 4,128 files below them. The copy before the run (`copyListed`, a pass over the stat cache) took 21 ms; the read at the decision (three `git ls-files` over the 493 directories, run together) 58 ms; nothing moved, so no file lost its keep. The same three git reads from the shell took 80 to 100 ms; one directory, 10 ms.
- So a `squeal code` run pays at most about 80 ms per runner's decision here, and nothing when its selection lists no directory.

## Proposed wording for spec 020 D17.3 (the coordinator's edit)

Append to D17.3:

> Amended 2026-11-12 (rows 011-319, 011-320): a file is written only when its run evidence's store decision is "store at the key it ran under" (`src/core/run-evidence/`). What bars a keep: the file did not complete, or has no coverage record; an input changed, or was written and ended as it was, during the run; the run read a path its key lacks, or one first seen during the run; it loaded an environment file its key lacks; its runtime identity moved between the lookup and the run's end; a merge holds a path its key names (011 C9), read at the decision and again before each write; a file, an editor's scratch file among them (row 011-117), was added to or removed from a directory its key lists, at any depth, by the files the lookup's keys held there against those git sees there at the run's end. Once the report is out, stderr gets one line per kind of reason: the count, the reason, at most three of the paths behind it and three of the test files, each in path order, then how many more (formats in `011-core/tasks/011-320/notes.md`). Verdict, report and exit code do not change; `QUALITY_POLICY_VERSION` does not change.

## Type changes

Additive unless marked.

- `run-evidence.ts`: `RuntimeIdentity`; `KeepSources.runtime?`; `KeepSources.hold` and `KeepSources.listed`, **required** (callers: `keep.ts` and the table's fixture); `KeepFile.runtimeIdentity?`; `HeldPaths`; `MergeHoldSource`; `mergeHoldOf`; `unheldNow`; `copyListed`; `FileDecision.cause`, **required** (built only by `decisionOf`); `mergeHeld`'s hold widened to `HeldPaths`.
- `reason.ts` (the entry's alone): `Cause`, `CauseKind` (with `listing`), `causeOf`; `reasonOf(decision, cause)` replaces `reasonOf(decision, entry, end, outcome)`, texts unchanged.
- `sources.ts`: `UnmergedIndex`. New `listings.ts`: `listingsAmong`, `filesBelow`, `listingMoves`.
- `keep-expected.ts`: `Expected.runtimeIdentity?`, `Pending.runtime?`, `Pending.listed` (required, built by `add`); `Expectations.add(…, runtime?)`.
- `keep.ts`: `Keeper.expect(…, runtime?)`. New `keep-reasons.ts`: `NotKept`.
- `scheduler/hold.ts`: `heldFiles`' hold widened to `Pick<MergeHold, "holding" | "names">`.

## Size

`run-evidence.ts` is 372 lines, `keep.ts` 326, the table's `fixture.ts` 389: over the styleguide's ~300-line signal. The entry holds the keeper's half because row 011-319 settled one entry file and no re-export; splitting it means a second entry file, which is the coordinator's call. The fixture's two columns could move to a file of their own.

## Commits

| Item | Commit |
|---|---|
| Check 1, runtime identity | `6c374b8c1` |
| Check 2, merge hold at the decision and the write | `7189b8161` |
| `heldFiles` widened (coordinator, B) | `689e58353` |
| Keeper-level runtime test (coordinator's request) | `6b1a12338` |
| Check 3, editor scratch | `5bfbad316` |
| Check 4, the note, and the CLI case | `aaea1e020` |
| The note bounded to three files and three paths; the children hunk (coordinator, A) | `807acce6f` |
| The fifth check, listings (the human's widening) | `2e241ad52` |
| These notes | the commit after `2e241ad52` |

## Checks

- `pnpm run lint`: 3272 files, no fixes. `pnpm run typecheck`: clean.
- `squeal status --wait` at revision 46 (`2e241ad52`, the code of the last commit): `test/run-evidence/table.test.ts` (36 rows), `keeper.test.ts`, `test/cli/code-gate-keep.test.ts` (with the new case), `code-gate-children` (with the agreed hunk), `code-gate-keep-busy`, `code-gate-keep-stop`, `code-gate-keep-node-test`, `code-gate`, `code-gate-stored`, `code-gate-exceptions`, `code-gate-closures`, `test/code/gate/keep.test.ts`, `keep-busy.test.ts`, `keep-daemon.test.ts`, `keep-daemon-lost.test.ts`, `keep-daemon-wire.test.ts`, `test/keys/key-format.test.ts` and the nine files of `test/keys/validity/` pass, with no `KEY_FORMAT_VERSION` raise (still 21).
- The record path's scheduler tests and the rest of the affected set ran at revision 31 with no failure but the bundles; at revision 46 the rest was still queued behind other tasks' runs (see the final message for the last read).
- Fails: the bundle tests (`test/harness/plugin.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts`, `codex/packaging/runtime.test.ts`: `cli/squeal.mjs differs from the build`), since `plugins/*/dist` is the coordinator's.
- `git diff e88998f34` is empty for `store-decision.ts`, `record.ts`, `record-tier.ts`, `keep-write.ts`, `keep-sent.ts`, `keep-here.ts`, `src/core/daemon/` and `test/code/gate/keep-busy.test.ts`.
