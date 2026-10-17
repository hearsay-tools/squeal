# Wave 1.13: candidate 0.1.212, rows 011-13 and 001-438

FAIL 04edaa09b4a0955cd459abf44f346788a4090e5a

One proven blocker in 001-438. 011-13 passes this review. No should-fix findings or nits.

## Verification

Reviewed detached HEAD `04edaa09b4a0955cd459abf44f346788a4090e5a`, fetched from `cand/0.1.212`. Base `origin/main` was `0c599161886a096c8c0d1fd86a31e46ac1c5c93e`; the range contains seven commits. Node v24.21.0, Linux, uid 1001. Product, tests and committed bundles stayed unchanged throughout verification. The only committed review change is this file. `npm run build` was deliberately omitted as instructed.

```text
npm ci
added 196 packages, and audited 197 packages in 6s
found 0 vulnerabilities
exit 0

npm run lint
> biome check .
Checked 1405 files in 498ms. No fixes applied.
exit 0

npm run typecheck
> tsc --noEmit
exit 0

npm run check:version -- origin/main
version bump: 0.1.211 -> 0.1.212, ok
exit 0

npx vitest run test/cli test/scheduler test/daemon/low-priority.test.ts test/daemon/slow-lane.test.ts test/store/worktree-meta.test.ts test/keys/key-format.test.ts --maxWorkers=4
Test Files  174 passed (174)
     Tests  1022 passed (1022)
  Duration  287.44s
exit 0

flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
Test Files  701 passed | 1 skipped (702)
     Tests  5973 passed | 9 skipped (5982)
  Duration  793.95s
exit 0
```

CI 39053810050 targets the exact pinned SHA. It completed successfully: all three Node 22 shards and the Node 24 lint/typecheck/version-sensitive job passed; the conditional nightly and bundle-version jobs were skipped. This review uses its own independent full run, not the coordinator's earlier run or Squeal's checkpoint.

Squeal's separate background baseline reported two recorder-fidelity failures in `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`. The exact-check `why` histories show the same failures on earlier commits before this candidate (including d112396 and bbf5722). They are outside this diff and are not findings against either row. The independent full-run result above is reported separately.

## Findings per row

| Row | Verdict | Findings |
| --- | --- | --- |
| 011-13 | PASS | Promotion publication/read freshness and verdict group cap meet amended C15. Review wave-1.11 S1 is closed. |
| 001-438 | FAIL | Descendant identities and ordinary batch recovery work, but B1 violates D11's identity guard during the asynchronous retry. |

## Blockers

### B1. Proven: the failed-batch retry submits a PID after its start identity has changed

**Location:** `src/core/daemon/low-priority.ts:130-139`, especially line 139. The same retry ships in the four committed CLI bundles.

**Contract:** 001 D11 Priority, amended in `07e147c1`: "only a process whose start still matches is lowered". The review brief also requires the ionice retry to leave processes outside this run alone.

`lower` checks identities at lines 131-133, immediately throws their start values away, and starts an asynchronous `ionice` batch. Its error callback later retries every numeric PID without another `statOf` read. If a selected process exits and its PID names another same-user process by that callback, `ionice -c 3 -p <pid>` can change the replacement's I/O priority. The replacement need not belong to this carrier, lane, or Squeal. A PID already gone is retried too.

This is a distinct asynchronous retry after the first mutation attempt, not merely the unavoidable interval between a last identity check and a syscall. The callback has the opportunity to check but no longer has the expected starts.

**Controlled reproduction on the pinned candidate:** mock only the kernel identity table, OS priority calls and child-process transport; run the production `lowerWhile`. Carrier 101/start 1 lists descendants 202/start 2 and 303/start 3. Hold the first batch's callback. Replace the table entry at 202 with start 2002, leave 303 unchanged, then release the callback with exit code 1. The production retry submits 202 along with 101 and 303, reading no identities:

```text
{"singles":[101,202,303],"replacement":{"pid":202,"start":2002},"readsDuringRetry":[]}
FAIL does not retry an identity whose pid now names a stranger
AssertionError: expected [ 101, 202, 303 ] to not include 202
Test Files  1 failed (1)
     Tests  1 failed (1)
exit 1
```

The unsafe submission is proven at the controlled PID-reuse seam, as allowed for this row's identity regression. No real kernel PID recycle or mutation of an unrelated real process is claimed; its frequency is unmeasured. The probe sends no actual priority commands. All probes use a temporary HOME and XDG directories.

**Worker-sized fix:** retain the selected `Identity` values through the failed batch's callback and check each current start immediately before its individual retry. Skip exited or replaced identities; continue retrying the later matching live process. Keep one bounded fan-out, the `ENOENT` and singleton behavior, polling cadence, and the shared orphan scan unchanged. Add a callback-held regression covering replaced and gone entries beside a surviving identity; existing real-process idle-I/O coverage must still pass. Re-pin the unreleased guarded key hash and regenerate bundles in the coordinator's candidate build.

## Should-fix

None.

## Nits

None.

## What fits

### 011-13

- `Promotions` publishes after an actual add, removal through settling, or clear; a no-change settle writes nothing. An empty live list deletes the row. Deadline removal happens on the next settle; the reader itself rejects `until <= now`, so a dormant expired row cannot advertise promotion. This matches amended C15 and the worker's recorded decision.
- Publication is wired through `RunQueue.setPromotionClock` and `Ledger` without changing the queue's rank, fairness, lane selection, claims, or promotion lifetime. The existing scheduling tests and the new real-scheduler publication fixture pass.
- `readNamedFiles` reads publication beside the other status facts in the existing read snapshot. It accepts only `daemon.state === "alive"`, a present daemon record, a row written at/after that daemon's start, and unexpired promotions. Missing, malformed, predecessor and expired rows promote nothing. A daemon that publishes nothing retains plain `queued`.
- Independent probes covered a dead/stopped daemon and a cleared record, promoted slow and claimed files, and 1,000 distinct claim groups. Slow and claimed files retain their binding reasons. Running, unlisted, current, stale and unknown files cannot acquire the optional queued flag through the added branch.
- `reasonGroups` caps only its five displayed groups, counts all omitted files and groups, and distinguishes promoted and plain queues. The existing ten-file class previews retain their own reasons; per-file JSON serialization remains complete. The 1,000-file probe retained all 1,000 JSON entries and the existing ten-file preview. No global character bound on individual paths is claimed.

### 001-438

- Walk results and remembered descendants carry `pid:start`; a replacement can no longer hide behind the old descendant's numeric PID. Stale carrier and descendant identities are checked before the first lowering batch. Dropping an old descendant identity still triggers the existing orphan-discovery path.
- Ordinary failed multi-PID batches fan out once, with no recursive retry. Successful batches, missing `ionice`, and singleton errors do not fan out. The real-process regression confirms the later live slow-lane descendant receives idle I/O despite an earlier failure. B1 concerns identities across the callback, which that test does not replace.
- Lane attribution, the every-100-ms look, first-second/every-second walks, and shared orphan-scan cap are unchanged. No additional global process scan was introduced.

### Discriminating regressions against origin/main

Independent probes used an archived, unmodified `origin/main` source tree and the candidate source, with the existing walk seam adapted to each version's return type. They tested behavior rather than failing on newly added exports:

| Probe | origin/main | Candidate |
| --- | --- | --- |
| Published live queued file carries promoted flag; deadline drops it | FAIL: promoted undefined | PASS |
| 1,000 claimant verdict is bounded | FAIL: 74,888 characters with this probe's epoch-zero clock | PASS: fewer than 600 characters |
| Descendant identity changes between consecutive walks | FAIL: only start 2 lowered; replacement start 2002 stays nice 0 | PASS: both starts lowered |
| Failed I/O batch leaves a later surviving descendant to retry | FAIL: later PID never receives idle I/O | PASS |

The candidate's own new tests also pass in the touched suite. B1's additional callback-replacement regression fails the candidate and is needed in the repair.

### Walk cost

Re-ran the preserved `tasks/001-438/bench.test.ts.txt` from a temporary directory with only import paths adjusted, using a temporary HOME. The same process alternated the 001-437 walk and the 001-438 walk for two rounds. Host load was about 27 on 24 CPUs during the probes; this is a local measurement, not a hard latency bound.

| 12 carriers | Old walk round 1 | New walk round 1 | Old walk round 2 | New walk round 2 |
| --- | --- | --- | --- | --- |
| After-first-second reads/look | 20.1 | 21.1 | 19.9 | 21.1 |
| After-first-second walk CPU, ms/s | 2.41 | 2.81 | 1.76 | 3.05 |
| First-second walk CPU, ms/look | 3.70 | 3.39 | 2.39 | 2.87 |
| After-first-second mean wall, ms/look | 0.345 | 0.300 | 0.249 | 0.323 |

One carrier for 60 seconds measured 0.08 ms walk CPU/s after its first second. The added stat reads have a measurable but small absolute cost; these figures are above the worker's quieter 2.08-2.27 ms/s and near the prior walk's range, without changing the walk or scan cadence. No walk-budget blocker. Bench exit 0.

## Inputs for the repair and re-review

One repair row: `src/core/daemon/low-priority.ts` and its focused tests, followed by the coordinator's key pin and bundle update. Keep identities until every retry decision is made; do not repeat the whole batch or add retry recursion. Re-review B1 and the repair delta, including the surviving real slow-lane process and the callback-held replaced/gone identities. 011-13 needs no product repair, and earlier reviews' settled findings are not reopened.

## B1 probe

Replace `<repo>` with the absolute candidate root. Run with Vitest from a temporary directory whose `node_modules` points to this repository's installed dependencies; its temporary config selects only this probe and uses one worker. Set the child's HOME, XDG_CONFIG_HOME and XDG_RUNTIME_DIR to directories under that temporary root. No repository or real HOME files need changing. The probe aborts the polling loop before releasing the held callback, so only one batch contributes to its output.

```ts
import { expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  starts: new Map([[101, 1], [202, 2], [303, 3]]),
  calls: [] as string[][],
  reads: [] as number[],
  batchDone: null as null | ((error: unknown) => void),
}));
vi.mock("node:os", () => ({ getPriority: () => 0, setPriority: () => {} }));
vi.mock("node:child_process", () => ({ execFile: (_cmd: string, args: string[], done: (error: unknown) => void) => {
  fake.calls.push(args);
  if (args.length > 4) fake.batchDone = done;
  else done(null);
  return { unref() {} };
} }));
vi.mock("<repo>/src/core/daemon/terminate.ts", () => ({
  childrenOf: () => [],
  statOf: (pid: number) => {
    fake.reads.push(pid);
    const start = fake.starts.get(pid);
    return start === undefined ? null : { pid, start, ppid: 101, pgrp: 101 };
  },
}));
import { lowerWhile } from "<repo>/src/core/daemon/low-priority.ts";
it("does not retry an identity whose pid now names a stranger", async () => {
  const stop = new AbortController();
  const running = lowerWhile(
    { carriers: async () => [{ pid: 101, start: 1, ppid: 0, pgrp: 101 }] },
    "slow:vitest", 0, stop.signal,
    () => [{ pid: 202, start: 2 }, { pid: 303, start: 3 }],
  );
  await vi.waitFor(() => expect(fake.batchDone).not.toBeNull());
  stop.abort();
  await running;
  // Kernel identity table at asynchronous completion: original 202 exited,
  // its pid now names a different process; 303 is still ours and alive.
  fake.starts.set(202, 2002);
  const before = fake.reads.length;
  fake.batchDone!({ code: 1 });
  const singles = fake.calls.slice(1).map(args => Number(args.at(-1)));
  console.log(JSON.stringify({ singles, replacement: { pid: 202, start: 2002 }, readsDuringRetry: fake.reads.slice(before) }));
  expect(singles).toContain(303);
  expect(singles).not.toContain(202);
});
```
