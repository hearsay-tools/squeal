# Row 011-320: `squeal code` applies the runtime, merge-hold and editor-scratch checks

Worker ea62d171, wave 77 W1, 2026-11-12. Brief: `../wave-77.md` W1. Design: `../../research/run-evidence.md`, differences 2 to 4. Built on row 011-319's module (`../011-319/notes.md`). Widened by the human the same day ("Folder case: Add to the running row"): a fifth check, a file added to or removed from a listed directory (proposed row `keep-listing-revision`). Repaired after review `../../reviews/0.1.458.md` (wave 77.5 W1-R1): see "Repair R1" below.

## What changed

The keeper (`squeal code`'s `Keeper`) now supplies four more sources to the run evidence module. Each makes `squeal code` stricter: a file the daemon would not store at the key it ran under is not kept. The daemon's decisions, `store-decision.ts`, `record.ts`, `record-tier.ts`, `keep-sent.ts`, `keep-here.ts` and every key are unchanged; `keep-write.ts` gains the merge-hold guard of R1 B4 alone.

| Check | Source | Where |
|---|---|---|
| Difference 2, runtime identity | `RuntimeSource`: `WorktreeKeys.runtimeIdentity(ref)` at the lookup (`Expectations.add`) and at the run's end (`runEnd`'s identity), as `TierFile.runtimePolicy` and `recordTier`; at the end, the policy's runtime rules on disk (`readPolicy`, as the daemon reloads it) against the lookup's, and a file whose runtime files they select differently gets an identity that differs (`runtimeAtEnd`, R1 B3) | `keep-expected.ts`, `keepDecisions`, `sources.ts`; `stored.ts` supplies the source |
| Difference 3, merge hold | The worktree's unmerged index paths, `git ls-files -u` as `MergeHold` reads them, again only when the index file's stat moved (`UnmergedIndex`); the held files go to `recordOutcome` as `RecordFacts.held`; read again before every write try (`keepFile`'s `unheld`, R1 B4) | `sources.ts` (`readKeepEvidence`, `UnmergedIndex`), `mergeHoldOf`, `unheldNow`; `keep-write.ts` |
| Difference 4, editor scratch, and the fifth, any file | Every file the lookup's keys hold below the files' listings (`copyListed`, from the stat cache the listings were hashed from, less ignored extras, the files below a followed symlinked directory among them), against the files git sees there at the decision (`git ls-files --stage`, `--others --exclude-standard` and `--deleted`, over the listed directories; no submodule, no untracked repository), with the files below the followed links (`linkedFiles`, the watcher's scope; R1 B2). A file that came or went moves every listing above it. Where a daemon serves, its revisions after the lookup add each changed path and, for an ordinary add or delete, every listing above it, as `applyBatch` fills `Tier.changes`; a scratch file by `scratchMovedListings` (`changedDuring`, R1 B1) | `listings.ts` (was `scratch.ts` until the fifth check), `readKeepEvidence`; `stored.ts` supplies the store |
| The note | Each `FileDecision` carries a `cause` (kind of evidence and its paths); the keeper groups the completed files it did not keep by kind and tells one line per kind at `flush`, once the report is out, naming at most three test files and three paths (the coordinator, decision 3) | `reason.ts` (`causeOf`), `keep-reasons.ts` (`NotKept`), `keep.ts` |

`heldFiles` (`scheduler/hold.ts`) takes `Pick<MergeHold, "holding" | "names">`, by the coordinator's decision B (request 925491b5): a type-only change, its emitted code byte for byte as before (esbuild of `hold.ts` before and after, compared). Both callers' `mergeHeld` call it; the rule has one owner.

## The write-time recheck (brief, item 2)

Yes, the keeper reads the merge hold again at each write, as the daemon's `TierRecords.#heldNow` does at each try (review 0.1.273 B1). Since R1 B4 it does so before every try, unconditionally: `flush`'s opening check (`Keeper.#steady`: `stillAsRead`, then `unheldNow`), and `keepFile`'s `unheld` guard before the first try of the coverage write, before the results write, and after every pause. The `steady` callback is the input check alone again, which `InputCheck` still reads only once a try was lost or refused. It costs no store write: one `stat` of the index file per check, and one `git ls-files -u` (5 ms here) only when the index moved. A file a merge holds at `flush`'s opening check is dropped silently, as a changed input is; one the guard drops is counted with the files whose inputs moved, so after a busy wait `keep-write.ts`'s notes count it as "changed during the wait", and with no wait the keeper tells the merge-hold line ("because a merge holds a path its key names") instead of the lost-write note. The editor-scratch and runtime checks are not repeated at the write: the daemon's record does not repeat them at each try either.

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

- **Runtime identity, a policy edit (closed by R1 B3).** The keeper's keys are a lookup's: they never reload the policy. Since R1, the end source reads the policy on disk and compares its runtime rules for each file: the runtime files they select, and the declared inputs while some are selected. A file whose selection moved is not kept, even where the daemon's identity under the new rules would come out the same (a protected path, say): stricter, never looser.
- **Runtime identity, a closure change.** Not covered: the keeper's keys apply no revision, so a closure that a revision would change during the run, moving which runtime files are protected, is not seen. The review judged this "unverified, not an additional blocker". A file whose inputs moved is caught by the stability check, so this case needs a change that moves no input's bytes.
- **Runtime identity, callers without the source.** The source is optional (`Keeper.expect(…, { runtime })`, `KeepSources.runtime`): a caller without it compares no identity. `stored.ts`, the one production caller, always supplies it. The coordinator chose this (reply to 3c6a475c): the `WorktreeKeys` stubs of `keep-busy.test.ts` (row 020-30), `keep.test.ts` and `keep-daemon-kit.ts` have no `runtimeIdentity`.
- **Merge hold, a failed read.** A `git ls-files -u` that fails leaves the paths as last read, none before the first, as the daemon's `MergeHold.check` does; nothing is told (`keep.test.ts` runs the keeper in roots that are no repositories). In a real worktree the read does not fail.
- **Merge hold, the lookup.** `stored.ts` `evidenceAt` still reads a stored result at a key that names an unmerged path; the daemon takes none there (011 C9, `holdsAt`). That is a lookup, not a keep, so not this row's; a later row can close it.
- **Listings, a file that came and went (closed by R1 B1 where a daemon serves).** Where a daemon serves, its revisions after the lookup show it, as `Tier.changes` does. Without a daemon no revision exists, and the comparison of both ends cannot see a file that came and went; nor can a daemon whose watcher applied both in one batch.
- **Listings, inside a symlinked directory (closed by R1 B2).** Both sides now hold the files below the links the watcher follows, by `linkedFiles`. A submodule's files stay out of both: the watcher does not follow into one either (review 0.1.458, "Judgment of the listed source gaps").
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

## Repair R1 (review 0.1.458)

Wave 77.5 W1-R1, worker ea62d171, on `cez/ea62d171` from `ab0190eb8`. One commit per blocker; each case fails before its fix and passes after.

| Blocker | Fix | Test that fails before the fix |
|---|---|---|
| B1, a file added and removed during the run | The lookup notes the worktree's latest revision in the repository's store (`revisionsSince`, read only); the decision reads the revisions after it as `applyBatch` adds them to `Tier.changes` (`changedDuring`): each path, every listing above an ordinary add or delete, a scratch file's by `scratchMovedListings`. No daemon, no revision: the comparison of both ends stays | Table "a file added to a listed directory and removed again, a revision of each" (checked by leaving the revisions unread once); keeper case over a real store, a revision before the lookup not counted. Table "an editor's scratch file added and removed again, a revision of each" stays "store at ran" in both columns |
| B2, a file added through a symlinked directory | Both ends hold the files below the links the watcher follows: the copy keeps what the keys' start seed hashed from `linkedFiles`, the read walks the tracked links and the untracked paths through `linkedFiles` with the ignored files watched anyway | Table rows for an ordinary and a scratch file added through a link without a revision (keeper "unstable"; the daemon's record before its batch "store at ran"). With a revision, both columns "unstable" through B1. The unchanged-link row stays "store at ran" |
| B3, a runtime policy edit | `RuntimeSource`: the identity, the lookup's runtime rules, and the rules on disk now (`readPolicy`); `runtimeAtEnd` gives a differing identity to a file whose runtime files the rules now select differently, or whose declared inputs moved while some are selected | Table "difference 2: the policy's runtime files moved during the run", a real `squeal.config.json` written during the run, the daemon column reloading it through `setPolicy`; keeper cases over a real policy file for the named file (not kept) and another (kept) |
| B4, the merge hold before each write | `keepFile`'s `unheld` guard before every try, beside `InputCheck` | A real `Keeper` whose `head()` leaves the input unmerged writes nothing and tells the merge-hold line; `keepFile` with a merge after the coverage write does not write the results |

The table has 43 rows after R1. The listing read on this worktree's real keys, all 493 listings at once, now walks the followed links too: 4,145 files, the copy 17 to 29 ms, the read 161 to 199 ms (was 58 ms), nothing moved, at the host's load of 0.9 to 1.0 per CPU then.

## Proposed wording for spec 020 D17.3 (the coordinator's edit)

Append to D17.3:

> Amended 2026-11-12 (rows 011-319, 011-320): a file is written only when its run evidence's store decision is "store at the key it ran under" (`src/core/run-evidence/`). What bars a keep: the file did not complete, or has no coverage record; an input changed, or was written and ended as it was, during the run; the run read a path its key lacks, or one first seen during the run; it loaded an environment file its key lacks; its runtime identity moved between the lookup and the run's end, or the policy's runtime rules on disk select other runtime files for it than at the lookup; a merge holds a path its key names (011 C9), read at the decision and again before every write try; a file, an editor's scratch file among them (row 011-117), was added to or removed from a directory its key lists, at any depth, through a followed symlinked directory too: by the files the lookup's keys held there against those git and the watcher's link scope show there at the run's end, and, where a daemon serves, by its revisions during the run, as its own record reads them. Once the report is out, stderr gets one line per kind of reason: the count, the reason, at most three of the paths behind it and three of the test files, each in path order, then how many more (formats in `011-core/tasks/011-320/notes.md`). Verdict, report and exit code do not change; `QUALITY_POLICY_VERSION` does not change.

## Type changes

Additive unless marked.

- `run-evidence.ts`: `RuntimeIdentity`, `RuntimeRules`, `RuntimeSource`; `KeepSources.runtime?` (a `RuntimeSource` since R1 B3); `KeepSources.hold` and `KeepSources.listed`, **required** (callers: `keep.ts` and the table's fixture); `KeepSources.revisions?`, `Revisions`, `RevisionsSince`, `revisionsSince` (R1 B1); `KeepFile.runtimeIdentity?`; `HeldPaths`; `MergeHoldSource`; `mergeHoldOf`; `unheldNow`; `copyListed`; `FileDecision.cause`, **required** (built only by `decisionOf`); `mergeHeld`'s hold widened to `HeldPaths`.
- `reason.ts` (the entry's alone): `Cause`, `CauseKind` (with `listing`), `causeOf`; `reasonOf(decision, cause)` replaces `reasonOf(decision, entry, end, outcome)`, texts unchanged.
- `sources.ts`: `UnmergedIndex`, `runtimeAtEnd`. New `listings.ts`: `listingsAmong`, `filesBelow`, `listingMoves` (with `extra`, R1 B2), `changedDuring` (R1 B1).
- `keep-expected.ts`: `Expected.runtimeIdentity?`, `Pending.runtime?`, `Pending.revisions?`, `Pending.listed` (required, built by `add`); `LookupSources`; `Expectations.add(…, sources?)`.
- `keep.ts`: `Keeper.expect(…, sources?: LookupSources)` (was `runtime?` until R1 B1). New `keep-reasons.ts`: `NotKept`, whose `add` takes a decision's `cause` and `reason` alone.
- `keep-write.ts`: `keepFile`'s `at.unheld`, **required** (one caller, `keep.ts`; R1 B4).
- `scheduler/hold.ts`: `heldFiles`' hold widened to `Pick<MergeHold, "holding" | "names">`.

## Size

`run-evidence.ts` is 428 lines, `keep.ts` 345, `keep-write.ts` 313, the table's `fixture.ts` 423, `keeper.test.ts` 397 (after R1): over the styleguide's ~300-line signal. The entry holds the keeper's half because row 011-319 settled one entry file and no re-export; splitting it means a second entry file, which is the coordinator's call. The fixture's two columns could move to a file of their own.

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
| These notes | `ab0190eb8` |
| R1 B1, revisions during the run | `1f7989019` |
| R1 B2, files below followed links | `8a40b8cbe` |
| R1 B3, the policy's runtime rules at the run's end | `fca94272a` |
| R1 B4, the merge hold before every write try | `82de27ab8` |
| R1 B1, the fixture's `then` renamed `next` (lint) | `fc2087b73` |
| R1 notes | the commit after `fc2087b73` |

## Checks

- R1, at `fc2087b73` (revision 79): `pnpm run lint` (3278 files, no fixes) and `pnpm run typecheck` pass.
- `squeal status --wait` at revision 79, beside the host's load of 2.3 to 4.3 per CPU from other tasks: `test/run-evidence/table.test.ts` (43 rows), `keeper.test.ts`, `test/code/gate/keep.test.ts`, `keep-busy.test.ts`, `keep-daemon-lost.test.ts`, `test/keys/key-format.test.ts` (no raise, still 21), the nine files of `test/keys/validity/`, the nine gate CLI files (`code-gate-keep`, `-keep-busy`, `-keep-stop`, `-keep-node-test`, `-children`, `-stored`, `code-gate`, `-exceptions`, `-closures`) and 23 scheduler tests of the record path pass. `keep-daemon.test.ts` failed once at 4.2 per CPU ("the holder is not known": `lockHolders` read `/proc/locks` without the holder) and passed on `squeal retry --reason load`.
- Fails: `keep-daemon-wire.test.ts`, "still refuses a keep line past 32 MiB", `write EPIPE`, at 4.1 and, on its load retry after the 10-minute cap, 3.2 per CPU. The case writes 33 MiB to the daemon's socket in 1 MiB pieces and expects the refusal; it calls no code this row changed (`src/core/daemon/**` is unchanged), and it ran only because its file's closure reads the keeper. Load, not this repair; to be read again below the CPU count. `test/presence/registration-order.test.ts` timed out in a hook at 3.5 per CPU; its load retry was still queued; it is outside this row's code. The four bundle tests fail, since `plugins/*/dist` is the coordinator's.
- `git diff ab0190eb8` is empty for `src/core/scheduler/**`, `src/core/daemon/**`, `src/core/keys/**`, `src/core/watcher/**`, `keep-sent.ts`, `keep-here.ts` and `test/code/gate/keep-busy.test.ts`.
- Before R1, at revision 46 (`2e241ad52`): the same set passed, with the bundles failing.
