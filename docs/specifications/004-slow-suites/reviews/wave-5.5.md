# 004 wave 5.5 review

## Verification

Tested HEAD: `be9765eca9d56a212b2d8a4c1b555bafd6cd14b0`, version 0.1.74. Executable candidate: `2554be0`. The brief's range `b70fcc2..2554be0` contains `17470a9` (004-48), `b941111` (004-47) and the bundle commit. The subsequent HEAD changes only the board, status and wave brief. There is no executable candidate mismatch. First round for 004-47 and 004-48; earlier reviews are not reopened.

The lockfile installation and checks below ran before adding this report, on the clean tracked candidate. Build regenerated both plugins without drift. The reviewer and repository gates require build and an independent Vitest run; the implementation briefs' no-build instruction does not remove the review gate. Squeal's checkpoint was not substituted for that independent check.

Node `v24.21.0`:

```text
$ npm ci
added 56 packages, and audited 57 packages in 2s
18 packages are looking for funding
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.74 lint
> biome check .
Checked 691 files in 255ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.74 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.74 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.74 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0

$ git status --short
(no output)

$ npx vitest run
Test Files  1 failed | 302 passed | 1 skipped (304)
     Tests  1 failed | 2264 passed | 11 skipped (2276)
  Duration  271.33s
exit 1

$ npx vitest run test/integration/node-test.test.ts --maxWorkers=1 --no-file-parallelism
Test Files  1 passed (1)
     Tests  1 passed (1)
  Duration  12.38s
exit 0
```

The full-run failure is `test/integration/node-test.test.ts:231`: after the third worktree's first results became current, the test observed three runs where it expected each new failure's second run too (six total). The isolated file passes. The retry scheduler and this assertion are outside this range; attribution to this wave is **unverified**, not a blocker. It does not erase the full-gate failure.

Node `v22.23.3`, with its bin directory first on PATH:

```text
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npx vitest run --maxWorkers=4
Test Files  1 failed | 302 passed | 1 skipped (304)
     Tests  1 failed | 2264 passed | 11 skipped (2276)
  Duration  362.46s
exit 1
```

The Node 22 failure is `test/daemon/busy-store.test.ts:90`: both writer children printed EnvHttpProxyAgent experimental warnings, while the assertion requires empty stderr. The preceding daemon-start assertions passed. The same warning-only gate failure is recorded in earlier reviews; the writer and daemon startup code are unchanged in this slice. It is **unverified** as a wave defect and not a blocker. No additional full suite or warning-only rerun was needed to establish that failure's content.

Installation warned about the optional watcher and esbuild install scripts; installation and build succeeded. Node 22 emitted EnvHttpProxyAgent and SQLite experimental warnings.

Background Squeal separately reported `Known failures: 3` at revision 1, with its full-suite checkpoint completed: `test/cli/codex.test.ts:103` timed out, `test/daemon/lifecycle.test.ts:250` saw CLI exit 1, and `test/integration/node-test.test.ts:271` saw an incomplete run list. This review makes no all-green background-status claim. Those reports are not the independent reviewer gate and do not by themselves establish defects in this diff.

Independent probes imported the freshly built product `dist`. All probe repositories, stores and permit directories lived under one private `/tmp` directory; none opened this repository's store or another project's tree. No CPU burners or externally owned processes were used. The upgrade probe compiled only pre-fix `b70fcc2`'s `keying.ts` into a private copy of candidate `dist`, solely to seed the persisted cache as the predecessor's ignored-input listing did. It is a boundary control, not a claimed verification of the whole earlier release. Adapters and stores were closed, and all probe scratch was removed before committing this report.

Both Nodes produced these outcomes, exit 0:

```text
cold closure includes scratch: false
cold extra scratch: (none)
cold: fast runs 1, revision 0 after two interval passes, fast result current
warm closure includes scratch: true
warm extra scratch: fixtures/.tmp/out.txt
warm: fast runs >=3, revisions advance, no stored fast result

PASS real delivery register/endTurn/unregister: copied turn key agrees, including two agents
PASS predecessor since suppressed; successor run retained
PASS source edit/revert, config only, add/delete, delete/restore by content

actual original node-test and Vitest broad fixture globs:
revisionAfterTwoIntervals: 0
each of four real fast files ran once; slow control ran once
currentChecks: 24
scratchExtraFiles: []
```

The last probe used an archived copy of this repository, restored `b70fcc2^`'s `test/fixtures/node-test/**` and `test/fixtures/vitest/**` declarations, and selected the actual `adapter-recorders`, `adapter-preload`, `adapter-preload-require` and Vitest `run` test files. A small real Vitest slow control exercised the slow-artifact declaration alongside them. The real adapter, scheduler, completion barrier, store and state sink were used. The four files' real fixture setup and teardown wrote their ignored `.tmp` directories. All reports completed with no failing checks, and two explicit interval passes produced no revision or rerun. This proves the fresh-store repository-shaped case, not an upgrade or a whole-repository dogfood.

## Verdict

**FAIL at `be9765e`**, executable candidate `2554be0`. One **proven** blocker in 004-47, zero should-fixes, one nonblocking nit. 004-48's three dogfood cases hold in independent probes on Node 22 and 24. 004-47 prevents fresh-store scratch discovery but does not prevent the same inputs retained from a predecessor's cache from feeding their own runs.

## Blockers

### B1. Previously cached ignored fast scratch remains a declared input after upgrading

**Proven on Node 22 and 24.** Changed boundary: `src/core/scheduler/keying.ts:439` and `:451`. Its consumers at `:157`, `:165` and `:550` still admit the previously persisted paths.

004-47's outcome is that a test writing scratch under a declared ignored directory "settles: its run is stored, no revision loop follows". Its seam limits ignored files to a slow file's declared artifact. This matters for the reported dogfood and installed 0.1.62 worktrees, which already have scratch hashes from the old listing; a fresh store is not the only supported starting state.

Reproduction:

1. Commit a fast test, a slow test, a tracked fixture and `.gitignore` ignoring `fixtures/.tmp/` and `dist/`. Declare `fixtures/**` only for the fast test, and `dist/**` only for the slow test. Create the ignored build and `fixtures/.tmp/out.txt`.
2. Run pre-fix `WorktreeKeys.bootstrap()` against the private store. Its declared-input discovery hashes `fixtures/.tmp/out.txt` and persists that hash through the real `fileHashes` repository.
3. Start the candidate with the same root and store, without changing the policy. The candidate's new listing excludes scratch, but bootstrap still adds every cached ignored path to `#extra`, and `#knownFiles()` still gives it to `createDeclaredInputs`. The fast closure and its stability paths contain `fixtures/.tmp/out.txt`.
4. Let the fast runner rewrite that file with different scratch bytes on every run. The real scheduler and completion barrier discard and requeue every result. The probe stops after at least three fast runs; revisions have advanced and no fast check's result was stored. No agent edit or external watcher event was needed.

Without step 2, the identical candidate fixture stores the fast result once at revision 0, retains no scratch extra, and stays at revision 0 through two interval passes. Thus the new discovery rule works, but its cache-selection seam does not. The predecessor cache was seeded using the actual old listing, not an arbitrary injected row. The unmodified bootstrap is evidence for an incomplete changed fix, not a request to audit unrelated old code.

Fix sized for one keying worker: apply the slow-artifact eligibility rule when assembling declared inputs from existing cached paths, not only when discovering new ignored files. Remove obsolete declaration-only scratch from the extra-watch set where appropriate, while retaining ignored paths actually required by static or observed closures, environments and installed dependencies. Do not disable the completion barrier or discard every ignored cache entry. Add the warm-store upgrade case beside the fresh-store tests, including a repeatedly rewritten existing file and the cold control. Preserve the symlinked-artifact, tracked-link, wildcard and interval-addition regressions.

## Should-fix

None.

## Nits

### N1. Share the turn-row key below the delivery/header dependency cycle

**Proven duplication; future divergence is plausible, not a current break.** `src/core/state/slow.ts:236` constructs `turn:<worktree>` independently of `src/core/delivery/turn.ts:28`'s `turnMetaKey`. The brief explicitly asks to check this copy. Both spellings and the slot encoding agree today: the independent probe uses real `HarnessDelivery.register({ inTurn: true })`, `endTurn` and `unregister` for two agents and verifies that a remaining in-turn consumer still blocks the idle claim.

Move the pure key helper to a dependency-neutral leaf used by both readers, retaining the delivery export if callers need it. Importing the existing `turn.ts` directly from the header path would introduce the dependency cycle the comment explains. One small maintenance row suffices; no persisted shape needs to change.

## What fits

- **004-47 fresh discovery, proven:** `artifactGlobs` restricts ignored listing to declarations matching slow paths, and `#ignoredArtifacts` uses the same D6 predicate as inheritance to exclude test and slow-directory paths. The real repository-shaped probe with the original broad fixture globs settles on both Nodes. Tracked fixture inputs continue to be selected. B1 is specifically the retained-cache path.
- **Defect 11, proven closed for the requested case:** the published idle wait is normalized at read time. A real registered in-turn consumer preserves the idle reason; when both consumers end their turns or unregister, pending fast keys produce a fast wait, and no pending fast key produces no wait. Store reads occur in the caller's existing header transaction. No header writes or new status fields were introduced.
- **Defect 12, proven closed:** `slow.ts:216` suppresses predecessor activity whose `since` precedes the successor's recorded start, even if a stale key remains `running`. The candidate retains activity begun by the current daemon. Existing tests also retain "last reported" wording when no successor has started. This timestamp solution satisfies the brief without adding a daemon-identity field.
- **Defect 15, proven closed:** revisions are read in ascending order; the new maps compare each path's first old hash with its last new hash. Real source edits set the clause; edit/revert, add/delete and delete/restore clear it; config-only changes do not set it. The literal `squeal.config.json` exclusion is independent of artifact declarations. Artifact and test-path filtering remains in place.
- Both committed plugin builds reproduce. No runtime dependency, public status type or persisted schema changed. macOS remains unverified and is outside this Linux review.

## Inputs for the next wave

1. Dispatch a repair for B1 within the keying/declared-input boundary, followed by the second review round. The done-when must cover an existing predecessor-populated store as well as a fresh one. Keep the tracked fixtures and actual generated-code closures keyed; excluded scratch must neither withhold the run nor make later interval revisions.
2. Do not use the successful fresh-store broad-glob probe to close the upgrade case. It establishes that the config workaround is unnecessary for new stores under the candidate; it does not establish that all installed stores are repaired. The coordinator owns the timing of restoring this repository's fixture globs and the release decision.
3. Carry N1 as a small shared-helper cleanup. 004-48's demonstrated status cases need no new repair from this review.
4. Preserve the independent full-gate and background-failure caveats above. This commit changes only the findings file; the coordinator owns board and status updates.
