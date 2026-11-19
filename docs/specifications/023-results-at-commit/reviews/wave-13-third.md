# Wave 13 third review: completion record

FAIL 9cfdf990cce1fc2ba8c049310efe255421c35f3f

Two proven blockers remain within B2: the completion record conflates projects, and an interrupted update misreports a confirmed store write. The previous B2 concurrent-writer and coverage-off fixtures now pass. B1 and B3–B5 remain closed. No unrelated should-fix findings or nits. No product code was changed.

This review is bounded by `wave-13-rereview.md` (report commit `bbef92dc4`) and its original B2 contract. Exact candidate: `cand/0.1.564`, `9cfdf990cce1fc2ba8c049310efe255421c35f3f`. Repair delta: `7827ce934..9cfdf990c`, including the completion hooks, record writer, notes and bundles. The original corrected wave base remains `1e010804ed8ca4cb04b0e165e41a96cb54cbf2ca`.

## Verification

Code checks and independent probes ran at the exact candidate on a clean tracked tree, before adding this report. Squawk supplied dependencies; installation was not repeated. No local full suite ran.

| Command or evidence | Actual result |
| --- | --- |
| `git fetch origin`; `git checkout --detach 9cfdf990cce1fc2ba8c049310efe255421c35f3f`; `git rev-parse HEAD`; `git status --short` | Exact candidate; clean. |
| `timeout 600 pnpm run lint` | Exit 0: `Checked 3744 files in 1455ms. No fixes applied.` |
| `timeout 600 pnpm run typecheck` | Exit 0. |
| `timeout 600 pnpm run build`; `git status --short` | Exit 0; all four plugin builds completed; no drift. |
| Focused Squeal wait, command below | Exit 0 at revision 9 (`9cfdf990 + 0`), after 44.8 s: all nine named files current, no known failures. Worktree: 222 of 1993 not current (124 queued, 98 unknown), 632 tests queued. |
| Gate/daemon seam Squeal wait, command below | Exit 0 at revision 9 after 1.6 s: all eight named files current, no known failures. Worktree: 221 of 1993 not current (124 queued, 97 unknown), 632 tests queued. |
| Broader `squeal status --wait 60000` | Returned on timeout after 60.8 s at revision 9: 84 of 104 affected test files pending, no known failures. Whole worktree: 178 of 1993 not current (90 queued, 88 unknown), 428 tests queued. Broader affected coverage is incomplete. |
| Final `squeal status --wait 60000`, after adding only this report | Timeout after 60.7 s at revision 11: 84 affected test files still pending, no known failures. Whole-worktree pending counts unchanged. This is incomplete coverage, not a candidate pass. |
| Independent Git/Vitest probes | Ten bounded jobs exited 0: `grown`, `off`, `concurrent`, `siblings`, `checks`, `partial`, `stale`, `scope`, `proof`, `code`. The observations, including candidate failures, are below. A probe's exit 0 is not a candidate pass. |
| `timeout 600 pnpm run check:private`, before the report | Exit 0: `6241 added lines in 84 files over 1e010804ed8ca4cb04b0e165e41a96cb54cbf2ca, ok`. Warning: empty private denylist; that rule is skipped. |
| `timeout 600 pnpm run check:private`, with the report committed | Exit 0; candidate plus report checked, 85 files. The empty-denylist warning remains. |
| [Candidate CI](https://github.com/hearsay-tools/squeal/actions/runs/44427948039) | In progress at the last read before filing. Node 24 lint/typecheck/version-sensitive/build job passed; six Node 22/26 shards still running. Full-suite result unverified. |
| [Private material CI](https://github.com/hearsay-tools/squeal/actions/runs/44427948051) | Completed successfully at the exact candidate. |

The two focused commands used the session launcher, shown with `~`:

```sh
timeout 600 ~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  test/cli/status-at-review13-b2.test.ts test/cli/status-at-review13.test.ts \
  test/cli/status-at-run-budget.test.ts test/cli/status-at-paths.test.ts \
  test/cli/proof-control.test.ts test/cli/proof-conditions.test.ts \
  test/cli/proof-report.test.ts test/keys/key-format.test.ts \
  test/runners/boundaries.test.ts

timeout 600 ~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  test/cli/code-gate-files.test.ts test/cli/code-gate-stored.test.ts \
  test/code/gate/collect-lanes.test.ts test/code/gate/keep-early.test.ts \
  test/code/gate/keep-grown.test.ts test/code/gate/keep-daemon.test.ts \
  test/code/gate/keep-daemon-wire.test.ts test/code/gate/lanes-retry.test.ts
```

Each independent case ran as a Squawk job with `timeout 600 node --import ./node_modules/tsx/dist/loader.mjs --disable-warning=ExperimentalWarning "$TMPDIR/w13t-probe.mjs" <case>`. The script made real Git fixtures, private HOME directories, caches and markers under `$TMPDIR`. It imported the candidate source commands and used the committed Claude Code CLI bundle for gate children. The injected installer linked the candidate's Vitest; frozen installation was not independently tested. Multi-batch checks used `batchFiles: 1`; production sizing was not changed. One full proof ran independently. The optional by-hand e2e suite was not repeated.

The two interrupted-write cases used a preload outside the repository. It intercepted only writes to `at-run-record.json.next`, wrote a 13-byte JSON prefix, saved the old and proposed records to a private marker, then waited for the command's hard stop. This makes the requested mid-write kill deterministic. It did not alter product code or the store writer. Neither probe wrote invalid JSON to the published record. These are fault-injection observations, not claims that ordinary writes take 20 s.

All ten jobs exited. Finished fixtures checked their Git worktree counts; the concurrent case removed its linked peer. All fixture directories were removed. A final process scan found no fixture process. The temporary script was removed before committing. Unknown affected checks and pending CI are verification limits, not blockers.

## Blockers

### 1. B2, proven: the completion record turns different projects into one outcome

Locations: `src/cli/code-gate-files.ts:257` and `:263`; stopped recovery consumes that reduced list at `src/cli/status-at-run-outcome.ts:129` and `:92`.

Contract: P3 requires every completed file to be reported, with no completed result lost to a kill. The previous B2 repair input requires per-run, per-project completion records. The wave-7 bar forbids one project's outcome from being reported as another's.

Use a real Git fixture with a module package, `squeal.config.json` equal to `{"coverage":{"enabled":false}}`, and these files:

```js
// vitest.config.mjs
export default { test: {
  globalSetup: ['./hold.mjs'],
  projects: [
    { test: { name: 'pass', include: ['test/*.test.ts'], setupFiles: ['./pass.mjs'] } },
    { test: { name: 'fail', include: ['test/*.test.ts'], setupFiles: ['./fail.mjs'] } },
  ],
} };

// pass.mjs
globalThis.MODE = 'good';
// fail.mjs
globalThis.MODE = 'bad';

// hold.mjs
export default function setup() {
  return () => new Promise(done => setTimeout(done, 600000));
}
```

```ts
// test/a.test.ts
import { it, expect } from 'vitest';
it('mode', () => expect(globalThis.MODE).toBe('good'));
```

At fixture commit `ecf0d8ec968fc3e381f1b2dc480a13d04be74719`, run `status --at HEAD --run --all-missing --timeout 20 --json`.

Actual after 19.5 s: both `fail:test/a.test.ts` and `pass:test/a.test.ts` read **pass**, each with `stored: false` and the coverage-off reason. Counts: `selected: 2`, `ran: 2`, `stored: 0`, `notRun: 0`, `timedOut: true`. The failing project's assertion has been lost and replaced by a pass.

Control: change only `hold.mjs` to `export default function setup(){}` and commit (`f1bda7bfb2d06e466119bf18780b02ff84d83a9e`). The normal answer finishes in 1.1 s and correctly refuses to conflate the outcomes: both rows say `not determined`, reason `its 2 projects ended differently, and no result was stored to tell them apart`.

`ended` receives two evidence objects for this runner/path. `progressHooks` writes both to the same map entry, so only the last remains. The ordinary answer retains both. The stopped answer therefore bypasses the ordinary answer's disagreement check and creates a false pass. `kept` has project identity; `runs` does not preserve it. No wrong store key is claimed in this coverage-off fixture.

**One-worker repair:** preserve project identity through completion evidence and the record, including rerun replacement, then select the matching project's outcome during recovery. If the existing gate evidence cannot identify the project, retain every outcome for that path and apply the normal answer's conservative disagreement rule. Never overwrite distinct projects merely because runner and path match. Add this held-close fixture and the no-hold control. Require a correct per-project failure, or an explicit unresolved result, rather than a pass for the failing project.

### 2. B2, proven: an interrupted keep update claims that a stored result was not stored

Locations: `src/cli/status-at-run-child.ts:113`, `src/cli/status-at-run-outcome.ts:132`, and `:95`. The keeper tells its decision after the write at `src/core/code/gate/keep.ts:153`.

Contract: B2 requires the stopped report to agree with the actual kept key and storage result. The brief's bar is that no completed result is lost or misreported. A last whole record proves JSON integrity; it does not prove its keep decision is current.

At real fixture commit `f607c0d816b20bddf602356e3e19889df3d3928e`, use one passing file with coverage on. The fault preload waits until the published record already has that completed pass. When the next update contains a confirmed `kept` entry, it writes only the prefix of the `.next` file and blocks until the hard stop. The previous whole record has the pass and `kept: []`; the interrupted new record has the same pass and its kept key `2fe7a32f…`.

Actual after 19.4 s:

| Read | Actual result |
| --- | --- |
| Stopped report | Pass at `2fe7a32f…`, `origin.stored: false`, `run.stored: 0`. Reason: `the run was stopped at the budget before the gate decided whether to keep it`. |
| Immediate lookup | Exit 0: stored pass at the same key, with this run's checkout writer and commit. |

The store write landed before the proposed record was built. The gate did decide to keep it. Recovery reads a valid but older record and turns an unconfirmed decision into a definitive negative storage flag and an incorrect reason. The pass itself survives; no torn JSON or wrong-key write was observed.

**One-worker repair:** distinguish an unconfirmed storage decision from a confirmed refusal. Preserve enough run/project/key identity before the write to confirm the store result after a stop, or represent storage as unknown when it cannot be confirmed. Do not label the file unstored or say the gate had not decided when only the record update is missing. Retain atomic publication and per-batch record clearing. Add a kill during publication of a confirmed keep update, and check the storage flag, count and reason against the next lookup.

## What now passes

- **Original B2 concurrency:** two linked worktrees share one store. A's held run stores a pass at `029ddb81…`; B then stores a newer failure at `c9155641…`. A stops after 29.4 s and still reports its own pass, stored, at A's key. Its immediate lookup agrees. The store's newest file key remains B's. No global newest-key or provenance search remains in recovery.
- **Original B2, coverage off:** one completed pass and held teardown, 20 s budget. The report retains the pass after 19.6 s, `stored: false`, with `the gate keeps a result only with coverage on`; `ran: 1`, `notRun: 0`.
- **Grown key:** the test reads a tracked data file at runtime. The stopped first batch reports its pass at actual kept key `80691b35…`, distinct from pre-run key `ebefafc2…`; the next lookup agrees.
- **No torn or previous-batch record:** the partial-write probe reads the last whole record, never the invalid `.next` prefix. In a separate two-batch probe, the second child's first update is interrupted. Its old published record is absent, proving the first batch's record was cleared. A remains pass/stored; B reads `not run (budget)`. The artificially blocked child requires the process-stop grace; the command finishes in 24.9 s for its 20 s budget. Both groups end and the checkout is removed.
- **B1/B3 brief recheck:** three one-path batches. The first starts an interval child and changes a tracked source. The second verifies that child is no longer live before completing. The later two outcomes read `not comparable`, `ran: pass`, `changedBy: run`; only the first result stores. All finish in 3.7 s. Earlier last-batch checks remain settled.
- **B4/B5 brief recheck:** disjoint source closures select, run and store only A; B's marker is absent. Change A's import to B's source and seed its current failure. Selecting the old source retains that actual current failure and reports the correct pass-to-fail comparison. Current source-path and prior review regression tests also pass.
- **023-20:** one dependency proof returns conditioned red assertion failure, conditioned green pass and unconditioned red assertion failure. Exit 0, `proven`, with `red without them too` and `the conditions are not shown to matter`. The control stores; conditioned sides do not. Focused report and condition tests pass. The completion-record change did not alter this settled proof meaning.

## Hooks without callers

`progressHooks(undefined)` returns an empty object. The new `ended` and `decided` calls are optional; without a listener their arguments are not evaluated by the optional call. No scheduling, keep policy, key or store write was changed for those callers. `squeal code` supplies neither listener. The daemon does not call this gate collector or keeper; its existing keep protocol remains separate.

An independent `codeGateCommand --base HEAD --test test/a.test.ts --timeout 40 --json` on a real Git fixture exits 0 with `verdict: pass`, keeps its completed file, and a subsequent commit lookup reads that pass at the same key. The eight gate/daemon seam tests named above are current passes. This supports unchanged behavior without hooks; it is not a claim that every daemon scenario ran independently.

## Input for the next decision

The completion record fixes the two prior single-project reproductions, and its atomic publication and batch clearing work. B2 remains open because the record must preserve every project's outcome and must not turn an interrupted keep update into a false storage claim. Keep the fixes to concurrent-key isolation, changed-checkout handling, process cleanup and source selection. The coordinator decides whether to authorize another repair or reduce scope. No local full-suite request is needed for a bounded follow-up.
