# Wave 4.5 review

Reviewer task for spec 001, 2026-10-06. Range `5593641..b3650cf` (23 commits): task 001-42 scheduler (revision without the runner, `affectedDetailed`, duration order, plain notes), task 001-43 state, delivery and status (fingerprint normalization, not-listed header, inherited counts, dirty flag, checkpoint wording, untold failure from prior state), task 001-44 harness, CLI and policy (SessionEnd and the SessionStart sweep, `squeal status --wait`, per-test-file `inputs`, skill and README), and the two bundle rebuilds. Read against D2, D5, D6, D7, D9 and D11 as amended in `status.md`, with `lessons.md` Defects 1 to 7 as the contract.

## Verdict

All seven lessons defects are gone, and the two that held goal 3 back are gone on this repository, not just in fixtures. On a clone driven by the plugin from `git archive HEAD` with a real daemon and no `SQUEAL_CLI`:

- **Defect 1.** Three edits 3 s apart during a 45.6 s tier got their revision rows at +144, +126 and +121 ms. Status showed each new revision with 422 checks pending while the tier ran. Lessons measured 4.5 to 45 s.
- **Defect 3.** After an edit to `src/core/state/check-name.ts` the first tier started at +194 ms. `test/status/why.test.ts` finished at +2.2 s, and the 45 s `test/daemon/lifecycle.test.ts` ran last. Lessons measured 58 s.
- **Surprise 2.** A per-test-file `inputs` map for the bundle test re-keyed 1 file instead of 86. The policy reload re-ran it in 0.5 s instead of 117 s.

Lint, typecheck, build and tests are green. The committed bundles match a fresh build.

The wave leaves gaps at the edges of goal 3. The deferred runner part means a new test file is not counted until the tier in flight ends. For about 0.4 s after that tier, status reads "0 pending" at a revision whose new test file never ran (S1). `squeal status --wait` returns "Returned on quiet" when no daemon is validating (S2). A batch that arrives while a structural refinement holds the scheduler lock still waits up to 1.3 s (S3). A `compact` SessionStart unregisters the session's running subagents (S4). None of these blocks v1. S1 and S2 should land before 001 is marked shipped.

Counts: 0 blockers, 6 should-fix, 9 nits.

## Verification

```
$ npm ci
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)

$ npm run lint
Checked 305 files in 78ms. No fixes applied.

$ npm run typecheck
tsc --noEmit   (no output, exit 0)

$ npm run build
tsc -p tsconfig.build.json && npm run build:plugin   (exit 0)
$ git status --porcelain
(empty: committed plugins/claude-code/dist/ is byte-identical to the fresh build)

$ npx vitest run                                   (load average 6.7)
 Test Files  95 passed (95)
      Tests  740 passed | 6 skipped (746)
   Duration  47.13s

$ npx vitest run test/e2e test/watcher/reconcile-pass.test.ts test/harness/latency.test.ts --reporter=verbose
 15 passed | 1 skipped   (load average 36: other workers on the machine)
 ↓ reconcile-pass > re-stats 10,000 tracked paths within the budget [load average 30.7 > 8; measured 359 ms]
```

The 6 skips are the 5 @parcel/watcher tests, which run only on darwin, and the reconciliation timing test, which skips above its load limit. Every e2e test ran and passed, including the two `it.fails` that 001-43 flipped (`worktrees.test.ts`: inherited count in the registration, `PASS -> FAIL` for an untold inherited pass). Hook latency was not measured at a calm load: the machine stayed at load 7 to 36 throughout.

### Probe

A throwaway probe under `/tmp/sq45`, deleted afterwards. It had no `node_modules` above the plugin and no `SQUEAL_CLI`. Hooks got `PATH`, `HOME` and a private `XDG_RUNTIME_DIR` only. Claude Code was not used.

- `repo/`: `git clone` of this worktree at `b3650cf`, `node_modules` copied from the `npm ci` above, `bin/squeal init` from the plugin copy, committed.
- `plugin/`: `git archive HEAD plugins/claude-code`.
- Drivers: hook bundles fed hook JSON on stdin, the plugin's `dist/cli/squeal.mjs` for `status`, `node:sqlite` read-only queries on `revisions`, `runs`, `test_file_keys` and `consumers`. Every edit wrote fresh content (a counter comment), so no lookup could short-cut a run.

**Baseline.** One SessionStart (43 ms, empty: no store yet) spawned the daemon from the plugin's CLI. Its baseline took 183 s, 24 runs, longest 45.4 s. Status: `836 passed, 0 running, 0 queued, 5 skipped`, `Full-suite checkpoint: completed at revision 0`.

**A. Defect 3: an edit to `check-name.ts` behind the barrel, daemon idle**

```
edit at t0
revision 1 row at +121 ms; status: revision 1, 419 current, 422 pending
run started +194  [test/state/transitions, scheduler/records, cli/daemon-commands, harness/init]  193 ms
run started +409  [delivery/format, state/fingerprint, status/builder, status/header]              228 ms
run started +657  [cli/round-trip, cli/main, status/head, harness/plugin]                          506 ms
run started +1182 [status/why, delivery/liveness, harness/session-lifecycle, status/status]  ended +2247
... 8 more tiers, each longer than the last ...
run started +37172 [scheduler/revision-lag, e2e/policy, scheduler/ordering, daemon/lifecycle] ended +82893 (45.7 s)
status --wait 600000 started before the edit: "Returned on quiet" after 83.3 s
```

48 test files were affected. No test file imports `check-name.ts` in one hop, because every test reaches it through `src/core/state/index.ts` or `src/core/status/index.ts`, so the runner's `direct` class was empty. The order came from the shortest-duration rule alone, and it was enough.

**B. Defect 1: three edits 3 s apart while the 45 s tier runs**

```
run started +37964 [scheduler/revision-lag, e2e/policy, scheduler/ordering, daemon/lifecycle]
extra edit 1.0: revision 3 row at +144 ms; status: revision 3, 419 current, 422 pending; tier still running
extra edit 1.1: revision 4 row at +126 ms; status: revision 4, 419 current, 422 pending; tier still running
extra edit 1.2: revision 5 row at +121 ms; status: revision 5, 419 current, 422 pending; tier still running
tier ended +83581 (45.6 s); first tier at revision 5 started +83713
```

The runner part of revisions 3, 4 and 5 was applied in the 132 ms between the two tiers. The in-flight tier's results were discarded, and its files ran again at revision 5.

**C. Per-test-file `inputs`** (surprise 2)

```
squeal.config.json: inputs = {"test/harness/plugin.test.ts": ["plugins/claude-code/dist/**"]}
  revision 6 at +124 ms; one run: [test/harness/plugin.test.ts] ended +605; note "squeal.config.json changed; policy reloaded"
append a comment to plugins/claude-code/dist/stop.mjs
  revision 7 at +124 ms; one run: [test/harness/plugin.test.ts] -> 1 known failure ("bundles > are committed exactly ...")
git checkout plugins/claude-code/dist/stop.mjs
  revision 8 at +124 ms; no run (lookup); 0 failures
```

**D. Fresh worktree** (defect 4, inherited counts). `git worktree add`, `node_modules` copied, SessionStart with a new session:

```
SessionStart 158 ms:
SQUEAL · registered at revision 0
Revision 0: 0 current, 0 pending, 0 stale, 0 unknown. The daemon has not listed this worktree's test files yet;
these counts are not complete. Full-suite checkpoint: none completed at any revision.
Known failures: 0
squeal status at +218 ms: "Affected checks: none counted; the daemon has not listed this worktree's test files yet"
settled at +930 ms, 0 runs: "836 passed ... Inherited: 841 current results / 841 from /tmp/sq45/repo at 4febbfe"
```

**E. Defects 6 and 7**

```
vitest.config.ts broken: revision 32, 841 unknown; note "runner environment failed: Build failed ... [PARSE_ERROR] ..."
  squeal status output: 0 ESC bytes
squeal stop; edit src/core/fs/compare.ts; squeal status:
  Worktree: /tmp/sq45/repo (HEAD 4febbfe, dirty state not known: no daemon is validating)
```

**F. Sessions** (defect 5 fix, sweep). Sessions A and B in the main worktree, subagents A/sub1 and B/sub2:

```
SessionStart A (resume): A/sub1 unregistered; A/main, B/main, B/sub2 and the wt2 session untouched
SubagentStart A/sub3, then SessionStart A (compact): A/sub3 unregistered            (S4)
SessionEnd A, cwd /tmp, no CLAUDE_PROJECT_DIR: exit 0, nothing unregistered (no store reachable)
SessionEnd A, cwd /tmp, CLAUDE_PROJECT_DIR=repo: A/main unregistered; B untouched
SessionEnd B, cwd = the second worktree: B/main and B/sub2 (registered in the main worktree) unregistered
```

**G. Gaps found** (details under should-fix)

```
status --wait with no daemon and compare.ts modified:
  "Returned on quiet: nothing pending at revision 33 after 1.0 s"                     (S2)
new failing test file test/zz/new.test.ts written 1 s into the 45 s tier:
  revision 40 at +151 ms; status: 820 current, 21 pending, test files without checks 0/0
  +46,707 to +47,105 ms: 5 of 465 status reads showed revision 40 with 0 pending and the new file unlisted
  listed at +47,188 ms, then ran and failed                                             (S1)
structural add, then a README edit 30 ms after the add's revision row, 6 samples:
  README revision at +153, +137, +1205, +1259, +200, +142 ms                            (S3)
daemon restarted by SessionStart after compare.ts changed with no daemon:
  header "registered at revision 33 ... 841 current" returned 61 ms after the daemon started;
  revision 34 (compare.ts) recorded 270 ms after that header                            (N9)
```

## Blockers

None.

## Should-fix

### S1. A test file added during a tier is invisible until the tier ends, and status can read "0 pending" at its revision

- **Where:** `src/core/scheduler/revision.ts` `rekeyContent` (no structural handling), `src/core/scheduler/scheduler.ts` `handleBatch` and `#pump` (refinement deferred until after the tier), `src/core/state/header.ts`.
- **What is wrong:** D5 as amended in wave 2.5: "for structural changes the possibly affected files, or every file of the project when the set is unknown without the runner, are marked `queued` in that same first transaction." The store part re-keys closures, which covers added import targets through their absent resolution candidates. It does nothing for a new test file, which only the runner's listing can name. Before this wave the refinement ran right away. Now it waits for the tier in flight.
- **Failure scenario:** probe G. An agent writes `test/zz/new.test.ts` with a failing test 1 s into a 45 s tier. For 46.7 s, headers and status at revision 40 count nothing for that file. After the tier ends, `recordTier` commits and then the refinement takes the lock. In between, status reads revision 40 with 0 pending and no unlisted file. 5 of 465 reads hit that window. A `squeal status --wait` or a Stop wait that polls then returns "nothing pending at revision 40". A never-run failing test exists at that revision.
- **Suggested fix:** persist the last revision whose runner part was applied: a `refined_revision` on the worktree row or in `meta`, written by the refinement's `ledger.commit`. `readHeader` counts "runner part pending" whenever it is below the current revision. `pending()` in `status-wait.ts` and Stop's wait treat that as pending. The header says so. This also covers S3's window and any later deferred step. Cheaper alternative: in `rekeyContent`, an added path matching a project's test include globs gets a placeholder `test_file_keys` row with `pending: "queued"`. Test it with the barrel fixture's 5 s tier.

### S2. `squeal status --wait` returns "on quiet" when no daemon is validating

- **Where:** `src/cli/status-wait.ts` `waitForStatus`, `waitLine`; skill section "Waiting for pending checks" ("It reads the store only and needs no daemon").
- **What is wrong:** quiet is `pending(header) === 0` and ignores liveness. With no daemon, nothing ever becomes pending, so the wait returns quiet after 750 ms whatever the files hold. The snapshot below the line says "Daemon: no daemon running", but the line an agent is told to read first says "nothing pending". Vision: "It says 'no known failures', not 'everything passes', unless it has actually run everything".
- **Failure scenario:** probe G. After `squeal stop` and an edit to `src/core/fs/compare.ts`, which is in 80 closures: `Returned on quiet: nothing pending at revision 33 after 1.0 s`. The skill tells agents to use this command instead of `sleep`, and that it "needs no daemon".
- **Suggested fix:** when `daemon.state !== "alive"`, end with an outcome of its own: `Returned without a daemon: no daemon has validated since <time>; results are as of revision N`, with a non-zero exit code or at least a distinct JSON field. Optionally call `ensureDaemon` with the shipped CLI first, as `squeal start` does. Fix the skill sentence. Add a test with a stale heartbeat.

### S3. The runner part still holds the scheduler lock across runner calls, so a batch can wait for it

- **Where:** `src/core/scheduler/scheduler.ts:520-526`: the queued task runs `applyRevision` inside `this.#lock.run`. `applyRevision` awaits `invalidate`, `environment`, `testFiles`, `affectedDetailed` and every `closure`.
- **What is wrong:** D2 as amended: "Creating a revision never waits on the runner". The fix moved the wait from "behind the tier" to "behind the refinement". A refinement after an add or delete invalidates every cached transform and re-resolves closures. That takes about a second here, and `handleBatch` waits for the lock that whole time.
- **Failure scenario:** probe G, 6 samples of an add followed by a README edit: 137 to 200 ms in 4, 1,205 and 1,259 ms in 2. During a rename storm or `git checkout` of a branch, refinements run back to back between tiers, and the lag adds up across queued batches.
- **Suggested fix:** split `applyRevision` into a runner phase without the lock (invalidate, affected, closures: they read the runner's module graph and touch no scheduler state) and an apply phase under the lock (`keys.setClosure`, `ledger.settle`, `commit`). The apply phase must re-check that its closures are still fresh, which is what `tierChanges` does for tiers. If that is too much for v1, amend D2 to "within the debounce window plus at most one refinement step" and record the measurement. S1's `refined_revision` keeps either choice honest.

### S4. A `compact` SessionStart unregisters the session's running subagents

- **Where:** `src/harness/claude-code/hooks/session-start.ts:32-37`, `hooks/hooks.json` (SessionStart has no matcher, so it fires for `startup`, `resume`, `clear` and `compact`).
- **What is wrong:** the sweep assumes "a new SessionStart for a session id means the old one is gone". After compaction the same session continues, with the same id and possibly with subagents still running in the background.
- **Failure scenario:** probe F: SubagentStart A/sub3, then SessionStart A with `source: "compact"`, and A/sub3's consumer is gone. Its next PostToolBatch re-registers it with a registration header in the middle of its task. A recovery or a changed failure that fell between the sweep and the re-registration is seeded into the new view silently, never delivered to it. The main consumer is re-seeded by `register` as before this wave.
- **Suggested fix:** sweep only on `source` `startup` and `resume`; on `compact` keep every consumer and keep the main agent's view. Add the case to `test/harness/session-lifecycle.test.ts`.

### S5. A map entry whose test-file glob matches no test file is accepted silently

- **Where:** `src/core/daemon/policy.ts` `inputs` leaf (it checks that globs compile), `src/core/keys/closure.ts` `createDeclaredInputs`.
- **What is wrong:** the glob compiler rejects negation and absolute globs "so a typo cannot silently match nothing or everything". A test-file key like `"plugin.test.ts"` or `"*.test.ts"` (no `**/`) matches no worktree-relative path. The runtime read stays outside every closure, and the stale "FAIL, current" or "PASS, current" of surprise 2 persists while the user believes it was declared.
- **Suggested fix:** after keying, note each map key that matched no listed test file and each input glob that matched no file, as a persisted daemon note in the same shape as the reload note. Show the map's matching rule (worktree-relative, anchored) in the skill's policy row.

### S6. Tests do not cover the new scheduler paths and edges the probes found

The three board rows' "done when" tests exist and pass: `revision-lag.test.ts`, `ordering.test.ts`, `notes.test.ts`, `fingerprint.test.ts` (with the lessons text), `status.test.ts`, the flipped e2e tests, `session-lifecycle.test.ts`, `status-wait.test.ts`, `closure.test.ts`, `declared-inputs.test.ts` and the policy tests. Missing:

- a test file added while a tier runs (S1);
- `run --all` while a revision's runner part is queued, the `#afterTier` path without a runner failure;
- a refinement that throws (`#backgroundError`), and `close()` with runner work queued;
- `status --wait` with a stale heartbeat (S2);
- SessionStart `compact` with a live subagent (S4);
- an ordering case shaped like this repository: the edited module reached only through a barrel by every test file, so `direct` is empty and the duration rule must do the work. `ordering.test.ts` covers the direct case and the no-`affectedDetailed` runner, but in the barrel fixture `math.test.ts` imports `src/math.ts` directly.

## Nits

- **N1.** `durationMs` of a file is the sum of its test-case durations (`results.ts:73`, `files.ts` `durationOf`). It leaves out collection, `beforeAll` and `afterAll`, so a file whose time goes into a `beforeAll` build ranks as short. The order was right on this repository. Prefer the module's own duration from `onTestModuleEnd` when Vitest reports it.
- **N2.** `src/core/scheduler/scheduler.ts` grew from 283 to 379 lines. The runner-work queue (`RunnerTask`, `#drainRunnerWork`, `#afterTier`) is its own concern and a natural split. `test/status/status.test.ts` is 588 lines, `test/delivery/delivery.test.ts` 566.
- **N3.** A refinement error is recorded twice: the scheduler's note `could not apply revision N: ...` and, through `onError`, the daemon's `daemon error: ...`.
- **N4.** Multi-line runner notes print unindented in `squeal status`. The Vitest parse error's box drawing spills to column 0 under `Notes:` (probe E).
- **N5.** After `squeal stop`, status says `Daemon: no daemon running` without the "since when" D12 asks for, because stop clears the record. Keep the last heartbeat.
- **N6.** At revision 0, status prints `no revision recorded for this worktree yet` as a note and again in the worktree line.
- **N7.** The `<hex>` rule also normalizes assertion values that are hashes (`expected 'e69de29b…' to be '…'`), so a different wrong hash reads as the same failure. This conforms to D6 as amended but contradicts the `fingerprint.ts` comment "Values of an assertion are kept". Reword the comment, or exempt quoted values.
- **N8.** `unregisterSession` throws only the first of several errors and drops the rest. The hook swallows it anyway unless `SQUEAL_HOOK_DEBUG=1`. Use an `AggregateError`.
- **N9.** A SessionStart that restarts a daemon waits for its heartbeat, not for its start reconciliation. Its header named revision 33 with 841 current 270 ms before the daemon recorded revision 34 for a file changed while no daemon ran (probe G). This predates the wave and the window is short. `settle` could wait for the first reconciliation instead.

## What fits

So that later work does not re-check these:

- **Revision path (D2, D5).** `handleBatch` stores the revision row, stat cache, content re-key, `queued` phases and known states in one transaction and returns. The runner part is queued in batch order, and no tier is selected while any is pending (`"runner-work"` guard), so a tier never runs at keys the runner has not invalidated. `invalidate` precedes `affected` within each refinement, and refinements apply in arrival order. `ledger.revision` is the newest revision when an older refinement settles, so known states and phases are written at the current revision. Stability checking is unchanged: paths changed by revisions during the tier (`tierChanges`) or on disk (`changedSince`) discard the tier's results, and probe B shows the discard and re-run. `run --all` while broken or behind a queued refinement goes through `#afterTier`, after the tier and in order.
- **Ordering (D5 step 4).** Classes are failing, direct, transitive, never-run. Inside a class the order is shortest known duration, unknown last, then queue order and path. Durations come from the results applied, including lookup hits at bootstrap (`byKey(previous, 0)` does not advance last-used). `affectedDetailed` is optional on the runner interface, and the recovering runner forwards it with a fallback to "all transitive".
- **Notes (defect 6).** Plain text at `appendNote` and in the scheduler's in-memory notes, via `stripVTControlCharacters`.
- **Fingerprint (defect 2).** UUIDs, hex identifiers of 16 or more characters with at least one letter, `node_modules/.cache` paths and the first segment under `os.tmpdir()`, its realpath and `/tmp` are normalized. A `tmp` directory inside the project is kept. The lessons' lifecycle text is a test case.
- **Header and status (defects 4, 7, surprise 7, e2e gaps).** One `readHeader` sets `testFilesListed` and `inheritedCount`. Delivered headers and status print the same `fullSuiteText`. Status prints "none counted" before listing. The dirty flag is shown only when a daemon is alive and is labelled with its revision. An untold failing check reads its prior state from this worktree's transitions, walking past changed failures, so an inherited pass broken before any tool boundary reads `PASS -> FAIL`. Both e2e tests that were `it.fails` pass.
- **SessionEnd and the sweep (defect 5).** SessionEnd ignores `reason`, never touches the daemon, finds the session in every worktree of the store and falls back to `CLAUDE_PROJECT_DIR`. The sweep filters by session id only, so two live sessions in one worktree never unregister each other (probe F, `session-lifecycle.test.ts`). The cause of the one `/exit` in lessons is still unknown. The fix is defensive: a missed SessionEnd now lasts until the session's next start, or 12 h at most.
- **`squeal status --wait` (D7).** It reads the store only, polls every 250 ms, does not return on quiet before 750 ms, treats news as a notable difference from the known states at its start (the delivery rule), exits 0 on quiet, news and timeout, and prints the reason first (stderr with `--json`). Probe A: it returned about 0.1 s after the last tier ended.
- **Per-test-file `inputs` (D3, D11).** A list or a map in the type, the loader (both shapes, globs compiled at load), `createDeclaredInputs` (one pass over the files, `for(testFile)` per rule), `keying.ts` (`setClosure` assembles per file, `sameInputs` compares maps in any key order, `isDeclaredInput` uses the union of input globs). Keys contain the selected paths and their hashes, so a known pass cannot be inherited across a change to a file's declared inputs: another selection or other bytes give another key. Probe C: 1 file re-keyed, 0.5 s.
- **Docs.** The README covers git credentials for the private marketplace and the silent `--plugin-dir`. The skill replaces `sleep` with `status --wait` and explains not-listed and inherited counts and checkpoints as requests.
- **Bundles.** Rebuilt last, byte-identical to `npm run build`. The e2e `shipped-plugin.test.ts` runs them from a `git archive` copy.

## Spec 001 readiness

| Goal | Holds? | Evidence |
| --- | --- | --- |
| 1 `PASS -> FAIL` within one tool call, same turn | Yes | e2e `transitions.test.ts` and `shipped-plugin.test.ts` deliver at the first PostToolBatch from the shipped plugin. Lessons: 37 of 37 at the first eligible hook. This wave removed the limit lessons named: on this repository the edited module's tests finish within 2.2 s of the edit (probe A), not after a 47 s tier. Not re-measured with Claude Code. |
| 2 `FAIL -> PASS` the same way; silence otherwise | Yes | e2e break-and-recover silence. Fingerprint normalization unit tests with the lessons' random-path text, which was the source of the spurious "failure changed" deliveries. Probe C: a recovery by restore was a lookup with no run. |
| 3 Everything told is true when told | Yes, with edges | Defect 1 is gone: revisions in 121 to 144 ms during a 45.6 s tier, and status at the new revision with its files pending (probe B). Fresh worktrees say the counts are incomplete (probe D). Status without a daemon does not claim a dirty state (probe E). Open edges: S1 (a new test file is uncounted for a tier, then about 0.4 s of "0 pending"), S2 (`status --wait` says quiet without a daemon), S3 (up to 1.3 s of lag behind a refinement), N9 (about 270 ms after a daemon restart). Runtime reads outside declared `inputs` remain a non-goal by construction. |
| 4 Inheritance by lookup | Yes | Probe D: 841 of 841 inherited, 0 runs, settled in 930 ms, and the header and status say "inherited" with the source worktree and commit. e2e `worktrees.test.ts`, all four tests. |
| 5 `squeal status` answers | Yes | Every D7 field present. Defects 4, 6 and 7 fixed (probes D, E). `--wait` added. S2 is about `--wait` only. |
| 6 No hook blocks past its timeout; dead daemon degrades | Yes, from earlier waves | No hook changed its waiting behaviour in this wave. SessionEnd no longer touches the daemon. Lessons: max hook 1,616 ms. Latency test green but load-gated; p95 not re-measured at calm load. |
| 7 One store, several worktrees and agents | Yes, as far as exercised | Two worktrees, four sessions and subagents on one store in the probe; store concurrency tests in CI (4 writers, 4 readers, kills). Not stress-tested beyond that. |

Before calling v1 shipped:

1. Fix S1 and S2. They are the last places where the agent can be told "nothing pending" while something is. Fix S4 too: it is small. S3 can be fixed or amended into D2 with its number.
2. A short dogfooding re-run with Claude Code, `-p` and attended, on this repository after these fixes. Measure edit-to-delivery p50 and p95 now that order is by duration. Check whether agents use `status --wait` instead of `sleep`. Count `/exit`s that leave a consumer (defect 5's cause is still unknown).
3. Hook p95 on this repository's store at a calm load. Lessons had PostToolBatch over 80 ms in 2 of 3 rounds, and this review could not measure below load 7.
4. Decide or explicitly defer open questions 2, 4, 5 and 8 in `spec.md`. Then set the stage in `status.md` and mark the 001 row shipped-candidate in `docs/specifications/README.md`, as `tasks/wave-4.5.md` plans.
5. macOS (open question 7) stays outside v1 verification but before any public release, as the board's "Later" says.
