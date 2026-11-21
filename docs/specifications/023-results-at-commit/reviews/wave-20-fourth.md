# Wave 20 fourth review

PASS `bf4c15a9d424a9fc952f5f308843999880670f9f`: **zero blockers**. B8 is closed. The mixed current/queued witness now leaves the later ordinary run and its child alone, while the flagged request's newly queued work still receives cleanup.

Reviewed `8d69025d8..bf4c15a9d`, bounded by `d809cc521:docs/specifications/023-results-at-commit/reviews/wave-20-third.md` and the parent's fourth-look brief. Fetched and checked out `origin/cand/0.1.586` detached; HEAD matched. Used the reviewer skill. The repair is rebased as `2d2f7b834` (the brief's pre-rebase id was `6c92f1c48`). The only other commit builds the bundles. Skipped generated bundle content.

## Verification

| Command or evidence | Actual result on this candidate |
| --- | --- |
| Dependencies | Used installed dependencies; no install repeated. |
| `pnpm run lint` | Passed: 3,942 files checked, no fixes; one existing unrelated `noProto` warning and two literal-key infos. |
| `pnpm run typecheck` | Passed, no diagnostics. |
| `pnpm run build` | Passed, all four plugin builds; tree stayed clean. |
| `pnpm run check:private` | Passed: `13929 added lines in 118 files over bc30db2a6b0537c89ba12ba7c6a2d50ef1026a24, ok`. Empty private denylist warning. |
| Independent probe plus nine relevant candidate files | Exit 0: **10 files, 48 tests passed**, 10.58 s. Product code was unchanged; only the throwaway probe was untracked. |
| Clean candidate targeted command below | Exit 0: **12 files, 73 tests passed**, 10.35 s, after removing the probe. |
| Installed Squeal focused wait | Exit 0 at revision 34 on the clean candidate and again at revision 35 with only this review staged: all six named files current, no known failures. Latest worktree count: 761 of 2,093 files not current (1 running, 368 queued, 391 stale, 1 unknown). No whole-worktree pass is claimed. |
| Exact-candidate CI | [CI 44913175365](https://github.com/hearsay-tools/squeal/actions/runs/44913175365) remained in progress at the last read. Full-suite evidence is unverified. [Private material 44913175467](https://github.com/hearsay-tools/squeal/actions/runs/44913175467) passed. |
| Benchmark comparison, process 6c | Unverified: no base/candidate comparison supplied. This is not a blocker. |

The task requires the independent witness. Initial Squeal source-path evidence was also incomplete: its 60-second wait returned exit 3 during listing, with 325 selected files current and 1,162 pending or stale. The final focused wait named `take-back-flags-current.test.ts`, `take-back-flags.test.ts`, `run-group-paths-at.test.ts`, `run-groups-watch.test.ts`, `narrow-run.test.ts` and `request-desk.test.ts`; each then had a current result. No new failure was reported. `squeal checks` covers default tests and excludes e2e, typecheck and build.

All direct runs used explicit paths, `timeout 600` and `--maxWorkers=2`. No full suite ran. `squeal.config.json` stayed unchanged. The probe was removed, and the candidate tree was clean before writing this file.

```sh
timeout 600 pnpm exec vitest run --maxWorkers=2 \
  test/scheduler/take-back-flags-current.test.ts \
  test/scheduler/take-back-flags.test.ts \
  test/daemon/run-group-paths-at.test.ts \
  test/daemon/run-groups-watch.test.ts \
  test/scheduler/narrow-run.test.ts \
  test/scheduler/narrow-run-promotes.test.ts \
  test/scheduler/take-back.test.ts \
  test/daemon/take-back.test.ts \
  test/runners/boundaries.test.ts \
  test/daemon/run-group.test.ts \
  test/daemon/run-group-paths.test.ts \
  test/daemon/request-desk.test.ts
```

## B8 closure

The independent probe repeats the third review's failure through the **real scheduler**, with `withRunGroups` installed in the scheduler's actual runner path and real `stopRuns` process cleanup. A fake adapter controls run completion and starts real detached Node servers. It does not mock flag registration, token injection, recording, identity checks or termination.

1. Run A normally to make it current; leave B unknown.
2. Submit flagged `[A,B]` with owner `fourth-mixed`. The answer has `queued:1`, `narrow.current:1` and `newlyQueued:[B]`. A is unflagged and B is flagged.
3. Hold B running. Edit A's source and submit an ordinary request for A without `at` or an owner. Release B, then A.
4. Check actual run environments and processes. B has the run token; A has none. Only B's run id is recorded. B's detached server is gone and named in the cleanup note. A's detached server remains alive and is absent from that note.

This probe passes. Its worker rule is `() => () => false`, as in the prior proof: the adapter runs inside the test process, so its child represents test work rather than a daemon worker. The server left alive by the assertion is explicitly killed in test cleanup. Nothing was left running by the probe.

A second independent real-scheduler control starts an ordinary request for A and C, holding one running while the other stays queued. A flagged request for `[A,B,C]` returns only B in `newlyQueued`. Neither A nor C becomes flagged. An answer without `newlyQueued` flags nothing. These controls pass, as do the candidate's mixed-current and running/shared-queue tests. The held-intake take-back regression test also passes.

## Boundary and regression check

`queueNarrow` excludes current, unkeyable and blocked files. It separates entries whose phase is already queued/running from the phase-null entries it sends to `ledger.settle`. `newlyQueued` is built from that call's returned misses under the same scheduler intake transaction. A store hit is not a miss. The response therefore carries this request's newly queued refs, rather than reconstructing them from aggregate counts or `narrow.selected`.

`flagAccepted` has one production caller, after the scheduler answer in `Daemon.#requestGroup`. It uses only `newlyQueued`, requires `at:true`, and does nothing for a missing or empty list. `AtRunRequests.accepted` still rejects taken-back owners. Project and path identity, one-hour expiry and removal after the run are unchanged. No other production call was found that can register selected or shared refs as this request's work.

The new field is optional and internal. The socket response still copies its public fields explicitly and does not send `newlyQueued`. Neither daemon protocol parsing nor either desk mode changed. The relevant protocol/desk tests pass. Answers from schedulers without the field conservatively register no cleanup work; they still run through the existing request interface.

The complete non-generated delta contains four source files, two test files and the row note, all for this acceptance repair. Beyond those, only generated CLI bundles and their runtime hash changed. B1–B7, N1 and N2 remain settled by the earlier reviews; this delta did not reopen them. No additional regression, should-fix item or nit was established.

## Next-wave inputs

Keep the per-file `newlyQueued` contract and conservative missing-list behavior. Keep both process controls: the ordinary server survives and the newly queued flagged server stops. There is no remaining repair to dispatch from this bounded review. Exact-candidate full-suite CI and the benchmark comparison remain unverified evidence, separate from this PASS.
