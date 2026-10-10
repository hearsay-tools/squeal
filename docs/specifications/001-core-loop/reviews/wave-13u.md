# Wave 13u review (001-233)

## Verification output

Candidate and clean HEAD: `0fb9052f32bcdf18b569a3546d51128930ea5ce9`, package 0.1.102. Reviewed range: `17d37121..0fb9052f32bcdf18b569a3546d51128930ea5ce9`, bounded to the rows in the brief, including 001-235. Unrelated spec 005/006 planning in that range is outside this review. Linux, Node 24.21.0. Checks ran before writing this report, with no tracked edits. The reviewer ran the full suite directly, independently of Squeal and the supplied coordinator gate. No product, test, bundle or board file was changed.

```text
$ git rev-parse HEAD
0fb9052f32bcdf18b569a3546d51128930ea5ce9
$ git status --short
(no output)

$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
(exit 0; npm warned about optional @parcel/watcher and esbuild install scripts)

$ npm run lint
> squeal@0.1.102 lint
> biome check .
Checked 763 files in 576ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.102 typecheck
> tsc --noEmit
(exit 0)

$ GIT_CONFIG_GLOBAL=/dev/null npx vitest run
Test Files  6 failed | 342 passed | 1 skipped (349)
     Tests  6 failed | 2509 passed | 10 skipped (2525)
Duration 280.35s
(exit 1)

$ GIT_CONFIG_GLOBAL=/dev/null npx vitest run test/cli/status-wait.test.ts -t 'squeal status --wait names a checkpoint'
Test Files  1 failed (1)
     Tests  1 failed | 21 skipped (22)
Duration 1.67s
(exit 1; same command-name mismatch as the full run)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run test/cli/status-wait.test.ts test/e2e/lifecycle.test.ts test/e2e/worktrees.test.ts test/integration/status-wait-edit.test.ts test/scheduler/refinement-lock.test.ts test/runners/node-test/adapter-observed.test.ts -t 'names a checkpoint|is named in the delivered header|names inherited results|returns within seconds|re-resolves a closure|reads nothing from a missing' --maxWorkers=1
Test Files  6 passed (6)
     Tests  8 passed | 35 skipped (43)
Duration 70.00s
(exit 0)
```

Full-run failures:

| Test | Observed failure | Classification |
| --- | --- | --- |
| `test/cli/status-wait.test.ts:391` | Expected `squeal run --all --wait`; received the absolute Codex command. | Proven new test defect, S2. |
| `test/e2e/lifecycle.test.ts:80` | Hook took 2916 ms against 2000 ms. | Passed isolated; a wave-caused regression is unverified. |
| `test/e2e/worktrees.test.ts:27` | Hook took 3709 ms against 2000 ms. | Passed isolated; a wave-caused regression is unverified. |
| `test/integration/status-wait-edit.test.ts` | `read ECONNRESET`. | Passed isolated; cause unverified. |
| `test/scheduler/refinement-lock.test.ts:104` | Batch took 1190 ms against 500 ms; its unreleased rendezvous then timed out in teardown. | Passed isolated; a wave-caused regression is unverified. |
| `test/runners/node-test/adapter-observed.test.ts:18` | 5000 ms test timeout. | Passed isolated; a wave-caused regression is unverified. |

The full suite is **not green**. The isolated retry does not replace that result. Host load was 44.37 when sampled after the failures. The last five failing tests are outside the changed tests; this review does not file them as wave defects without a discriminator tying them to the diff.

`npm run build` was explicitly forbidden and was not run. Build reproducibility and bundle drift are **unverified**, not blockers. The full run passed the key-format test at version 3; keeping the unreleased version 3 and re-pinning it is consistent with the supplied release history: version 2 shipped in 0.1.99.

Additional throwaway probes ran through the candidate's real store, delivery and Parcel backend modules, outside the checkout. They seeded public store records, called the public delivery boundary, and were removed before committing. They did not substitute for the full suite. Their relevant sequences and output are preserved below.

## Verdict

**FAIL** `0fb9052f32bcdf18b569a3546d51128930ea5ce9`: **2 proven blockers, 2 proven should-fix findings, 0 nits**. B1 breaks the edit attribution required by 001-223/224, including a settled line while an edit's file is pending. B2 breaks 001-224's once-per-consumer-session rule on resume. Route these blockers to the human through the coordinator before release.

## Blockers

### B1. A key snapshot is not the set of files the consumer's edits re-keyed

**Proven.** `src/core/delivery/edits.ts:140`, especially the filter at line 146. Row 001-223 requires: "When every file the consumer's edits re-keyed is current, the next delivered header says so once; no line while any is pending." The brief explicitly names the set 001-186 computes. Row 001-224 requires the first delivery after the first edit to name the queued count.

Comparing the current key with the registration snapshot loses two histories that the scheduler's `keyedAt`/`lastKeyedAt` preserve:

1. **Cold registration.** Register a consumer before the first test-file listing, so its snapshot is empty. List `a.test.ts` at its original key, then record a watched edit of `src/a.ts` and re-key `a.test.ts` to a queued new key. Refine that revision and call `onToolBoundary`. The probe returned `null`, with no `sawEdit`. The fallback accepts a missing snapshot entry only if the changed path is the test file itself. An edit of an imported source fails that condition. This can occur when SessionStart registers while the daemon's initial lookup is still running; the subsequent feed reconciliation records a source edit against the start scan.
2. **Revert before the first result.** Register with `a.test.ts` at `a0`, and a not-yet-run `b.test.ts` queued at `b0`. A watched edit re-keys both to `a1` and `b1`. The first boundary correctly says it queued 2 files. Before B has a result, another edit returns B to `b0`; B remains queued because there is no result under that key. A completes at `a1` and produces other delivery news. The next boundary excludes B because its key equals the snapshot, delivers the settled line for A, and advances the snapshot past the still-owed edit.

Observed output for the second sequence:

```text
SAW BOTH: {"queued":2}
Revision 3 (changed src/b.ts): 1 current, 0 pending, 0 stale, 0 unknown.
Test files without checks: 1 pending, 0 unknown.
The test file your edits since revision 1 re-keyed is current.
B PENDING: queued
```

The header admits pending work, but the edit note has lost one of the two files it previously said the edit queued. This is not an unrelated backlog file: both keys moved because of the consumer's edits, and B never got its result. `Ledger.settle` retains the outstanding re-key attribution when a key moves back without a result (`src/core/scheduler/ledger.ts:175`). The new delivery implementation cannot reconstruct it from two snapshots.

**One-worker fix:** give delivery a store-backed representation of the scheduler's edit re-key attribution, or an equivalent persisted per-file history that distinguishes an untouched backlog from a changed-then-reverted file and a first-listed file affected by a source edit. Consume/update it in the same delivery transaction; keep the existing Stop silence and message merge. Add the two regressions above through delivery, with at least one using the scheduler's actual re-key set. Do not fix the cold case by counting every first-listed backlog file as an edit.

### B2. Resuming the same consumer session repeats the once-only first-edit line

**Proven.** `src/core/delivery/edits.ts:78`, `src/core/delivery/expiry.ts:170`, and `src/core/delivery/delivery.ts:262`. Row 001-224 says "once per consumer session" and "never again in that session."

`unregister` parks the registration identity for a later resume, but `forgetEdits` deletes both the snapshot and `said`. A registration of the same `(worktreeId, sessionId, agentId)` then calls `snapshotKeys` with its default `said = false`. Its next edit sends the onboarding line again.

Probe sequence: register `s1/main`; edit and deliver the first-edit line; unregister; register the same `s1/main`; edit; deliver. The second edit again printed:

```text
Squeal saw your edit and queued 1 test file; results arrive with later tool calls, and passing ones stay silent.
```

Calling `register` twice while the consumer remains registered is covered and safe. That test does not cover SessionEnd followed by a resume. Existing `registered.ts` deliberately recognizes the returning session and excludes its away revisions, so a resume is not a new consumer session.

**One-worker fix:** preserve a bounded, expiring once-told marker for a parked consumer identity and restore it on resume, while deleting the large key snapshot on departure. Share the existing parked-registration lifetime and cleanup rules; a genuinely new session still gets its own first-edit line. Test unregister/resume, expiry/resume within the retained session lifetime, and a new session ID.

## Should-fix

### S1. Removing a worktree bypasses cleanup of the new snapshot rows

**Proven.** New ownership in `src/core/delivery/edits.ts:73`; removal path in `src/core/store/repos/worktrees.ts:73`. Normal unregistration, harness disappearance and consumer expiry call `forgetEdits`; these delete the snapshot correctly. A probe using `expireConsumers` after 13 hours returned `EXPIRED SNAPSHOT: null`.

Removing/pruning a worktree directly deletes its consumers without calling delivery cleanup. The new `edit-keys:[worktreeId,sessionId,agentId]` row remains, as does its `edits:<worktreeId>` state. The same probe registered again and called `worktrees.remove`, then returned `REMOVED WORKTREE SNAPSHOT PRESENT: true`. There is no consumer left for a later expiry to discover. One snapshot per departed worktree/session can therefore accumulate permanently.

**Fix:** include these new ownership keys in the coordinator's already-listed per-worktree-meta pruning follow-up. Include the new `checkpoint.<worktreeId>` progress/debt row too. Use explicit ownership parsing or a prefix registry, not an arbitrary suffix match; shared node:test observation rows must survive. Add a prune regression with a removed worktree holding a snapshot and a live worktree holding another. The general meta-pruning omission predates this range; this finding is limited to the new rows.

### S2. The new checkpoint wait test depends on the invoking harness's environment

**Proven.** `test/cli/status-wait.test.ts:391`, with the helper at line 29. It expects the literal command `squeal`, but supplies no `CliIo.env`, so the CLI uses `process.env`. With Codex's `CODEX_SESSION_ID`, `statusCommand` correctly chooses the absolute Node command. This caused the sole new-test failure in the full suite and reproduced independently in 1.67 s. Removing that environment variable made it pass.

**Fix:** set `env: {}` for this fixture, or explicitly pass and assert the chosen command; add a Codex variant if desired. Change the test, not the correct harness-aware formatter. This is a test portability defect, not a proven product break, so it is not blocking under the reviewer rules.

## Brief answers and what fits

### Functional done-when coverage

All rows' lint/typecheck checks passed. Their common full-suite-green gate was not met in this independent environment; the table separates functional evidence from that gate.

| Row | Functional assessment at this candidate |
| --- | --- |
| 001-216 | Met by `atomic-save.test.ts`: cross-batch rename makes one revision naming the real file; ordinary adds bypass the hold; surviving temp-shaped adds are released; reconciliation does not leak held paths. |
| 001-217 | Join/progress/fresh-file counts and quiet wait wording are covered by checkpoint tracker, scheduler resume, real-daemon drain, status and CLI tests. Functional wording works; the new CLI test needs S2. |
| 001-219 | Graceful drain and restart debt are covered, including a real session ending mid-checkpoint, forced and non-forced resume, and rerun restart. See the shutdown-bound qualification below. |
| 001-220 | Met by `own-edit-unknown.test.ts`: exact moved-only reason plus pending phase, all moved paths among registered changes, and a prior PASS. Mixed causes, untouched paths, FAIL -> UNKNOWN and task 001-159 remain delivered. The silenced view stays PASS; the later failure is PASS -> FAIL. |
| 001-221 | Met by fingerprint tests: summaries include changed diff lines within 300 characters, while the fingerprint remains unchanged by diff-only changes. |
| 001-222 | Met by known-failure-line and checkpoint/status tests: first five names then status pointer, folded process counts by command, full per-process notes via `--notes`. |
| 001-223 | Not met: B1. Normal settlement, unknown-result wording and riding on other news work in the supplied tests. |
| 001-224 | Not met: B1 and B2. Normal first-edit delivery, no-edit silence, Stop silence and the simultaneous 223/224 merged wording work. |
| 001-225 | Met by changed-since tests: older observed revision, per-path revision lists, 20-path and 20-revision caps, no line for a current result. |
| 001-228 | Met for revision refinement calls by the stalled-call and bound tests. Startup and explicit retry exemptions remain a liveness limitation, below. |
| 001-232 | Met by discharge tests: the callback reads the real clock, expires every overdue hold in that callback, and re-arms from that clock. |
| 001-235 | Lost extra-file update/delete/re-create and duplicate suppression are covered by fake Parcel tests; the actual linked-parent Parcel tests passed. No native macOS proof is claimed. |

### Does 001-220 silence another UNKNOWN cause or lose a later PASS -> FAIL?

**No proven escape in the changed path.** `own-edit.ts` accepts only the complete task 001-146 reason, with its optional composite-runner prefix; additional lines or appended causes do not match. It also requires pending validity and that every named moved path is in the consumer's registered change window. `planDelta` skips both the delivery and view write only when the previous outcome is PASS. The later fail still compares against that PASS. Attribution here follows the existing registered-worktree change model, which does not identify which person/process wrote a path; it is not proof of an individual writer's identity.

### Can 001-216 delay or drop a real add?

**An ordinary add is neither held nor dropped.** An untracked real filename that happens to match `.tmp.<digits>.<alphanumeric>` is deliberately delayed 5 s from first sighting, then re-hinted and admitted once if it still exists. Debounce and event-loop scheduling add their ordinary delay; 5 s is the hold duration, not a hard filesystem-to-revision wall-clock guarantee. A temp-shaped path gone before recheck is deliberately absent from revisions. A tracked temp-shaped path bypasses the hold. The tests exercise the released real add and the cross-batch save; no permanent drop of a surviving add was found.

### Does 001-228 abandon a runner part that would have finished, and what happens next? Are the unbounded startup/retry paths safe?

**A call that answers after its deadline is abandoned even if it would eventually finish.** The default bound is 666 s, `runner.timeoutMs + 6 s + 60 s`; a null run timeout substitutes 600 s. This gives an ordinary bounded run/recreate its run deadline and grace plus a margin, but is not proof that every valid config/plugin/closure call finishes in time. The late answer and late rejection are consumed and dropped. Later calls in that same part fail immediately. A timed-out invalidate blocks all files UNKNOWN with a note, and the revision is committed refined; the next revision can recover if the adapter answers then. A permanently wedged adapter remains UNKNOWN, not a fabricated pass.

**The bound is per call, not one total deadline for the entire refinement.** Several slow calls that each finish within the bound can add up to more than 666 s. Startup calls in `bootstrap.ts` and failed-runner retry in `revision.ts:85` remain unbounded, exactly as D5 now states. A stall there can prevent readiness or recording an explicit checkpoint, hold the scheduler mutex during retry, and delay later batches. Hook/socket timeouts still bound the caller, and status does not claim completed validation, but scheduler progress and daemon exit are not guaranteed. Thus the exemptions are safe against false passing evidence, not safe as a general liveness guarantee. They predate this range and are explicitly excluded by its D5 amendment; they are a next-wave input, not a blocker against the new bound.

### Is the 001-223/224 snapshot bounded, expired, and race-free across hooks?

**Bounded by the current file set per registered consumer, not by a fixed byte cap.** Each snapshot contains one test-file ID and a 16-character key prefix per file, is replaced rather than appended, and costs O(files) space/read/write per consumer. The small `edits:` slot map is bounded by registered consumers. There is no revision history accumulated inside a snapshot; total cost still scales with files times consumers and test-path lengths.

**Normal expiry deletes it, but worktree removal does not:** S1. **Hook updates are serialized:** registration, delivery selection plus `tell`, and expiry cleanup run synchronously inside the store's `BEGIN IMMEDIATE` write transaction. There is no await between snapshot/state reads and their writes. Concurrent hooks cannot both observe `said=false` and commit a duplicate first line, nor lose another consumer's slot update. B1 and B2 are attribution/lifetime defects, not concurrent lost-write races. Contention may make a hook time out; successful transaction commit is not proof the harness consumed its text, an existing delivery limitation.

### Is 001-219's drain bounded, and can join/resume run a file twice or not at all?

**The drain's decision to stop is bounded by `daemon.idleExitMinutes` from the last departure**, plus the presence timer's scheduling delay. It does not extend the bound on every tier; a returning consumer cancels the departure exit. **Process termination has a further wait:** scheduler close awaits already-running tiers and runner work, then daemon shutdown closes the adapter. D5 already permits a running tier to finish after departure. A null run timeout, an unbounded retry, or an abandoned call still wedged inside the adapter's gate can make actual shutdown exceed that bound indefinitely. Do not describe `idleExitMinutes` as a hard process-lifetime cap.

**Join/resume does not introduce a second run of an already-completed unchanged file in the tested graceful path.** `queueFullSuite` joins only when the active tracker covers the requested outstanding files (and their strictness for force); it does not enqueue them again. Tracker maps/queue identity deduplicate test files. Close first stores in-flight results, then `owe` records only the remaining files and their forced subset. Resume attaches loose misses to the new baseline, looks them up when there is no active baseline, and explicitly queues the remaining strict files once. Removed files require no run; unrunnable files abandon the checkpoint. Those branches do not silently mark a runnable remaining miss complete.

This is **not unconditional exactly-once execution**: edits, discarded runs, cancellation, retry after unknown, and deliberate forcing may legitimately execute a file again; inherited current results may legitimately require no local run. A killed daemon that never writes `owed` has its old active checkpoint abandoned on restart, as `takeOwed` explicitly documents. The session-end guarantee has real-daemon proof; recovery from an arbitrary crash is not claimed by these tests. No joined/resumed file-loss defect was found within the graceful contract.

### Can 001-235 report a change that did not happen or cost too much in a busy folder?

**It can emit a hint without a byte change; it cannot create a content revision by itself.** Signatures include inode, size, mtime and ctime. A chmod-only probe on an unchanged file emitted one `change` hint. D2 treats every backend event as a hint and reconciles/hash-checks it; equal bytes produce no new revision. Named events update the remembered signature so the following sibling batch does not repeat a synthesized change. An erased delete/re-create becomes the appropriate hint. The state/result provenance check remains downstream of this heuristic.

**Cost is O(declared extra files in that parent) synchronous stats per callback**, including files already named in the batch. It does not scan every sibling or the whole root. A fake-Parcel probe with 1,000 declared extra files delivered 100 unrelated sibling batches: 490.7 ms total, 0 hints, about 4.9 ms per callback on this host. This is a measured sample, not an enforced budget. A very large declaration in a frequently-written parent or slow filesystem can consume substantial event-loop time; that broader latency concern is **plausible**, not a proven failure of this row's normal case. If it becomes a workload, measure those actual declarations and coalesce rechecks with the watcher batch rather than adding an unconditional directory scan.

The erased-event fix covers extra-file parent subscriptions only. The root Parcel event-loss follow-up is already on the board as 001-236; the root continues to depend on reconciliation for an erased event. No macOS performance or correctness experiment was run here.

## Inputs for the fix/next wave

- Dispatch B1 and B2 as one delivery repair if useful. Keep ownership of the attribution handoff explicit: the daemon computes the re-keyed set, the store persists what hooks need, and delivery reads/advances it within its write transaction. Test cold listing plus source edit, changed-then-reverted pending file, and same-session unregister/resume. Preserve Stop's news-only behavior and the merged 223/224 line.
- Repair S2 alongside those tests. Add S1's new ownership keys to the existing meta-pruning follow-up; cleanup must cover direct worktree removal, not only consumer expiry.
- Record the new delivery, checkpoint-progress/join/debt and status shapes in D6/D7/D10 and the amendment log when folding the repair. The board/brief already name them; D5 records the runner bound and D2 the temp hold, while those other spec sections do not yet describe all the new contracts.
- If the next wave promises bounded scheduler progress or shutdown, apply a deliberate bound/recovery policy to startup and explicit retry, and decide what happens to a timed-out adapter call that still owns its gate. Preserve the caller hook budget separately from the daemon's run/drain budget.
- Re-review B1/B2 with a fresh independent full suite under `GIT_CONFIG_GLOBAL=/dev/null`. Report any Codex environment sanitization explicitly. The red full run above must not be summarized as 2516 passing or as a green gate.
