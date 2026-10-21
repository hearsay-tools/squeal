# Wave 4 review: FAIL

Candidate: `cand/0.1.246`, `563a806190085b6b364fd8d89cc7f0a7c5949798`.
Range: `c3b6888a7..563a80619`. Row: 014-29. Reviewed on Linux, Node v24.21.0.

Three proven blockers. One proven should-fix. One plausible note. Live proof remains unverified where stated below. No product code changed.

## Verification output

The candidate matched `HEAD`. The tree was clean for verification. `npm ci` installed from the lockfile and exited 0:

```text
added 196 packages, and audited 197 packages in 17s
1 high severity vulnerability
```

No dependency was changed during this review.

```text
$ npm run lint
> squeal@0.1.246 lint
> biome check .
Checked 1671 files in 1918ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.246 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.246 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.246 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0

$ git status --short
(no output)
$ git diff --quiet plugins/claude-code/dist plugins/codex/dist plugins/pi/dist plugins/opencode/dist
exit 0
```

**Unverified: no full Vitest run ran at this SHA.** An independent run was queued under `nohup` and the host lock at load `53.47 46.99 36.75`, on 24 CPUs. The first wrapper disappeared before acquiring the lock; its log contains no Vitest start. The replacement remained queued, with no Vitest output. After the three blockers were proven, the coordinator instructed this reviewer to stop that queued run and commit this FAIL report. Only this worktree's verified flock process was stopped. No replacement run was started.

The full run belongs to the repaired SHA at re-review. The 650-process cost test and full-suite status at this candidate are therefore **unverified**, not passing. No failed file was available to rerun alone. The known flakes `test/harness/opencode-dispose.test.ts` (008-38) and `test/e2e/stop-gap.test.ts` (011-20) were not run by this review. Squeal's checkpoint was not substituted for the independent gate.

```text
initial queue log: Wed Oct 21 20:31:03 UTC 2026
                  53.47 46.99 36.75 79/4066 3347053
replacement full-run log: empty; still waiting for the lock
own queued flock: PID 3806857, cwd matched this review worktree
stopped own queued flock: exit 143
Vitest full runs started: 0
```

## Blockers

### B1. Proven: an immutable read can silently discard committed WAL data

Location: `src/core/ps/work.ts:106`, `src/core/ps/work.ts:126`.
Contract: vision principle 2, D3 and goal 4. Read the committed state without creating a file, or report the store unknown. D3's amendment assumes that if either WAL sidecar is missing, the database file holds every commit. That assumption is false.

`held` requires both `-wal` and `-shm`. With a WAL but no shared-memory file, the code takes `immutable=1`. SQLite ignores the WAL in that mode. Neither the database inode nor its size or timestamps need change. The before-and-after check accepts the older state as current.

Reproduction on this candidate:

1. Write a fixture store with heartbeat `1792599465000` and close it.
2. Open a writer and commit heartbeat `1792599525000` into its WAL.
3. Copy the database and its WAL to an isolated directory. Do not copy the shared-memory file. This is a database image with committed WAL data and no shared-memory file.
4. Call the real `readWork` on that copy. Then read it with an independent SQLite WAL reader.

```text
candidate heartbeat: 1792599465000
independent WAL reader heartbeat: 1792599525000
candidate unknown: daemon 800 lastUsedAt only; no daemon 800 work entry
before: [store.sqlite, store.sqlite-wal]
after:  [store.sqlite, store.sqlite-wal]
```

The candidate creates no file in this case, but reports stale work without warning. The existing no-sidecar test covers neither this state nor the false assumption in D3.

One-worker fix: distinguish both sidecars absent from a WAL present without its shared-memory file. Report the latter store unknown unless a read can preserve committed WAL data without creating a file. Keep the immutable fingerprint check for the supported state. Add this crash-image case and amend D3's assumption.

### B2. Proven: a directory in use can enter the deletion list

Location: `src/core/ps/flags-leftovers.ts:209`, `src/core/ps/flags-leftovers.ts:221`, `src/core/ps/flags-leftovers.ts:227`.
Contract: wave 4's leftover outcome, P5, and this review's explicit check that no directory in use is listed. D7 also requires a failed open-file read to appear in `unknown`.

The fd loop treats an unreadable process as having no use. Its warning runs only when **no** process had a readable fd table. One readable table hides every unreadable table.

A real-process probe created an old key directory and started a same-user Python process. The child opened its `file`, set `PR_SET_DUMPABLE=0`, and stayed alive. Its directory path came through stdin, not its arguments. It did not use the directory as its cwd. A second process had readable fds. The real Linux source and `fileFlags` returned:

```text
child: open=True prctl=0
child fds: null
second process fds readable: true
in-use key directory listed: true
unknown: []
```

Thus the printed `rm -rf` pipeline includes a directory that a live process uses. No deletion command was run.

A second real-process probe bound an AF_UNIX datagram socket under an old key directory. Its fds were readable but exposed only `socket:[inode]`. `ss -xle` found no listener for that datagram socket. The directory was listed, with `unknown: []`, while the child held the socket open. P5 asks for bound socket paths from `/proc/net/unix`; D7's amendment narrowed this to listening sockets. That narrower rule fails the brief's no-directory-in-use check.

One-worker fix: report each failed use read and withhold candidates whose lack of use cannot be established. Do not turn permission failure into a deletion claim. Include all bound Unix socket paths in the leftover use source; preserve the listener semantics needed by other flags. Add the mixed readable/unreadable fd case and a real bound datagram case. Keep `/tmp/sq-*` out of scope.

### B3. Proven: a vanished parent does not prove who reaped its child

Location: `src/core/ps/measure.ts:103`, `src/core/ps/measure.ts:105`, `src/core/ps/measure.ts:157`.
Contract: D4 subtracts first-reading ticks only for a child that a measured process waited for. D6, D8 and P2 require a lower-bound mark when CPU is left out.

`waited` tests only whether the old parent had a `childTicks` field. Linux always provides that field. It does not prove that the parent waited for this child. If a worker exits without waiting for its browser, the browser is reparented and can be reaped outside the measured tree. The code still subtracts its old ticks and sets its `reapedBy` to the daemon. `sumCosts` then claims that none of its CPU was skipped.

A deterministic probe used `measure`, `sumCosts` and the repository's source fixtures at 100 ticks/s over 2 s:

```text
first:  daemon own=5000 children=700
        worker own=300 children=20, parent=daemon
        browser own=40 children=0, parent=worker
second: daemon own=5010 children=1120; worker and browser absent
```

The worker used 100 ticks, exited without waiting for the browser, and the daemon reaped its 420 lifetime ticks. Init reaped the browser. The daemon's own 10 ticks plus the worker's 100 recoverable ticks give 55% CPU; the browser's window CPU is unknown.

```text
candidate daemon cpuPct: 35
candidate worker reapedBy: daemon
candidate browser reapedBy: daemon
candidate total skipped.cpuPct: 0
```

The own-growth floor holds, but does not repair this lost child CPU or the false completeness claim. The existing test named “children waited for outside the tree” checks only that floor.

One-worker fix: distinguish confirmed recovery from uncertain reaping when the old parent also vanished. When two samples cannot establish the reaper, keep a conservative bound and propagate the uncertainty to the total, repository, descendants and text. Do not set `reapedBy` merely from the existence of the old parent's counter. Add this case with positive worker growth; assert the lower-bound mark and unknown cause as well as the own-growth floor.

## Should-fix

### S1. Proven: the macOS CPU warning does not mark the displayed total

Location: `src/core/ps/snapshot.ts:120`, `src/core/ps/render.ts:107`.

A fixture source with `childTicks: null` produces the D10 warning `a lower bound: the source reads no children's CPU...`, but `squeal.skipped.cpuPct` stays 0. The Squeal and repository lines therefore show an unqualified CPU value. A direct snapshot-and-render probe returned:

```text
skipped.cpuPct: 0
unknown: squeal cpuPct, a lower bound: the source reads no children's CPU ...
Squeal  CPU 0.0 CPUs (share of busy unknown) ...
```

D10 explicitly accepts a platform warning instead of children's times, so this is not a separate blocker. Fold its display into B3's treatment of CPU uncertainty, in line with D6. Add a fixture assertion on the rendered line. A real Mac run remains unverified.

## Plausible notes

### N1. Plausible: sidecar existence can change between the check and SQLite open

Location: `src/core/ps/work.ts:106`.

A writer can close after both `existsSync` calls and before the ordinary read-only open. That open could recreate sidecars. No concurrent reproduction was run, so this does not block. B1's worker should check this boundary and report the residual limitation if it cannot be closed without writing or rejecting the store.

## Row requirements and what fits

These are evidence labels, not a claim that the deferred live proof passed. P1 and P2's draft row numbers in `lessons.md` differ from the final board numbers; this table uses the board and wave brief.

| Row | Assessment |
| --- | --- |
| 014-21 / P2 | **Proven, partial.** Unit and snapshot cases count a child born and reaped entirely inside the sample, a surviving child born inside it, and a reaped row. Independent probes cover live children, reaped children, born parent-plus-child, and the own-growth floor without double counting in those cases. B3 breaks completeness for uncertain reaping. The one-minute host comparison is **unverified**, due in 014-30. |
| 014-22 / P1 | **Proven for the name rules.** Exact lowercase key and moved-key patterns, this uid's fallback, and six-character mkdtemp suffixes match their constructors in `daemon/scratch.ts`, `cli/update.ts` and the three e2e fixtures. The cases reject review directories, eval roots, the e2e cache, other uids, malformed suffixes and `/tmp/sq-*`. No broader `squeal-*` glob remains. The live host exclusion check is **unverified**, due in 014-30. |
| 014-23 / P3 | **Proven for the implementation changes.** `--full` reaches the real flag wrapper. The ordinary snapshot reads no entry below leftovers. The link-count bound avoids a walk that cannot finish. `OPEN_RUNS` is lazy and shared once per store and reading, then filtered by worktree and start time. Integer counts retain en-US separators without `Intl`. Five whole-command CPU measurements, Node start included, are **unverified**, due in 014-30. |
| 014-24 / P4 | **Proven for the fixture requirements.** Missing and zombie descendants add no memory. Snapshot tests read memory before the second store/mark reads. Render tests keep the head's memory and mark incomplete sums with `+`; total and repository lines use `at least`. Three live snapshots are **unverified**, due in 014-30. |
| 014-25 / P5 | **Proven, partial.** The listening-socket case required by the unit done-when exists, as do open-file and deleted-file cases. Reads stop once every candidate is used. B2 disproves the broader no-directory-in-use outcome. |
| 014-26 / P6 | **Proven for the exact no-sidecar case.** The test reads a closed WAL-mode store with neither sidecar and checks its unchanged listing and work. Other tests cover a live writer's WAL and a changed immutable database. B1 exposes the unsupported partial-sidecar state. |
| 014-27 / P7 | **Proven.** A consumer or a departure before process start suppresses `session left`; an own departure prints; an unknown start suppresses it. The worktree's raw departure remains in JSON. |
| 014-28 / P8 | **Proven.** The first-reading clock enforces the 60 s floor on both samples. The 5 s case is unknown, not flagged; the 61 s case is flagged. Token, identity and second-sample confirmation remain. |
| 014-29 | This review covers the pinned range. Its independent full run is **unverified**, cancelled while queued at the coordinator's instruction. |
| 014-30 | **Unverified, intentionally deferred.** Run after release. The approved status does not claim `shipped`, and this review does not replace round 2. |

## Amendments and interfaces

| Section | Result |
| --- | --- |
| D3 | One transaction per store and one open-runs query per reading fit. The immutable fingerprint compares inode, size, nanosecond mtime and ctime and rejects changed/disappeared files. B1 breaks its partial-sidecar assumption. N1 remains plausible. |
| D4 | `proc` parses fields 16 and 17; the second sample includes the old subtree and newly born pids. Hidden descendants count in the nearest row. The clamp preserves a row's own nonnegative growth. B3 breaks the reaper inference. No double count was found in the discriminating live/reaped/born fixtures; this is not a proof over all process races. |
| D5 | Gone descendants contribute zero memory; unread live values are counted in `skipped`; the renderer keeps a head's own unknown value unknown. |
| D6 | Per-value lower bounds reach Squeal and repository totals. B3 and S1 expose CPU uncertainty that does not reach those marks. |
| D7 | Constructor-specific names, uid, age, live-key, path-boundary and `--full` rules fit. The orphan floor fits. B2 exposes incomplete use evidence and the narrowed socket check. |
| D8 | **Proven additive under v 1.** The shape diff adds `skipped` and repository totals. It removes or renames no existing public key. `reapedBy` and `left` remain internal because `costOf` selects only the public cost keys. The amended meaning of window CPU is stated in D4 and D8; cumulative `cpuMs` remains own CPU. Own-departure text fits. |
| D9 | No amendment or product change in this range. |
| D10 | The fallback supplies `childTicks: null` and emits one platform cause. Missing sockets/fds remain explicit platform limits. S1 concerns the displayed bound; real macOS execution is **unverified**. |
| D11 | The leftover module split and optional `processTable(pids, since)` argument match their callers. Both platform sources and fixtures implement the added argument. |

**Proven:** all four committed plugin bundle trees match the build at the pinned candidate. Package and plugin metadata name 0.1.246. No new runtime dependency appears in the range.

## Nits

None.

## Inputs for the repair and next wave

- Repair B1 in the store reader and its store tests. Keep the one-query-per-store rule and no-file-created tests. Update D3's partial-sidecar claim.
- Repair B2 in the leftover use reader and platform source contract, with mixed-permission and bound-socket cases. Keep the constructor allowlist, uid checks, live keys, path boundaries and short-circuit order. Never run the printed end command.
- Repair B3 in measurement, uncertainty propagation and rendering. Include S1 in that repair. Preserve the additive v 1 fields, own-growth floor and one-count-per-contribution cases.
- Run the 650-process cost gate after these repairs. Keep its 25-daemon fixture, 2 s sample, 0.5 s outside-window wall bound and 0.3 s snapshot CPU bound.
- Re-review the repair delta against B1 to B3. Only then can the coordinator decide whether the candidate lands. Round 2 still owes the host CPU share, memory and five whole-command timing measurements with load and counts.
