# Wave 12b review: backlog tiers and daemon step-down

Candidate: `9c23b22357863601887da8ada8bed10acb1711b0` (0.1.33). Reviewed 001-124's cherry-picks `5c55b80`, `eedb4d2`, `71a7ca1`, `a177ea7` and 001-125's `74052fb`, `3b48f7f`, `1af0f22`, including both committed bundles. Original worker ranges: `9a6872f..61facb7` and `3cf205a..79b0d43`.

**FAIL: 1 proven blocker, 1 proven should-fix note, 1 proven provenance nit.** No plausible or unverified product finding. This is an initial review, not a re-review of wave-12.md.

## Verification output

All commands and probes below ran on a clean detached checkout of the exact candidate. `npm run build` left tracked files unchanged. The assigned branch was restored only after verification; its extra commit changes only `docs/board.md` and `tasks/wave-12.md`. No candidate implementation was edited. Throwaway probes lived in ignored `node_modules/.cache/squeal-review/` and were removed before committing this file.

```text
$ git rev-parse HEAD
9c23b22357863601887da8ada8bed10acb1711b0

$ npm ci
added 56 packages, and audited 57 packages in 1s
18 packages are looking for funding
found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.

$ npm run lint
> squeal@0.1.33 lint
> biome check .
Checked 537 files in 222ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.33 typecheck
> tsc --noEmit

$ npm run build
> squeal@0.1.33 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.33 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts

$ git status --porcelain
(no output)

$ npx vitest run
FAIL test/cli/status-wait.test.ts > waitForStatus > polls at the given interval and reports the outcome with the snapshot
AssertionError: expected 212.36151400000017 to be less than 200
at test/cli/status-wait.test.ts:296:27
Test Files  1 failed | 206 passed | 1 skipped (208)
Tests       1 failed | 1709 passed | 10 skipped (1720)
Start at    15:19:34
Duration    135.22s (tests 97%, transform 2%, import 1%)

$ npx vitest run test/cli/status-wait.test.ts -t 'polls at the given interval'
Test Files  1 passed (1)
Tests       1 passed | 17 skipped (18)
Duration    925ms (transform 75%, import 15%, tests 9%)
```

The full-suite failure is recorded, not counted against this wave: the 200 ms timing assertion is outside both ranges and passes in isolation. This is not a green full-suite claim. The suite also printed two `repair: gitdir incorrect` fixture-worktree messages. No second full suite was run.

Additional discriminating probes, using separate Vitest configs on the same clean candidate:

```text
Backlog edits at first and last selected file, sizes 1 and 10000, busy-loop abort:
Test Files 1 passed (1); Tests 5 passed (5); Duration 14.86s

Both shipped plugins against released 0.1.31, plus real equal/newer/prerelease daemons:
Test Files 1 passed (1); Tests 5 passed (5); Duration 14.89s

Mixed-version handover, repeated with the released 0.1.32 daemon:
Test Files 1 passed (1); Tests 1 passed | 5 skipped (6); Duration 1.49s
Observed daemon versions: 0.1.32 -> 0.1.31 after a 0.1.33 upgrade request

Busy-loop abort and timeout, with retained sibling results and a subsequent usable run:
Test Files 1 passed (1); Tests 2 passed | 4 skipped (6); Duration 7.74s
abort: elapsed 1425 ms, 1013 ms after abort, end completed, fast sibling retained
3000 ms timeout: elapsed 4010 ms, end timed-out, fast sibling retained

Pure selection probe with 10001 queued files of unknown duration:
{"selected":10000,"queued":1,"durations":"all unknown","timeoutMs":100,"estimatedMs":0,"selectionMs":22,"cancellable":true}
```

These probe tests asserted the observations above; the downgrade test intentionally asserted the bad replacement version to establish the counterexample. They are review evidence, not shipped regression tests.

## Blockers

### B1. Proven: an older plugin can win the handover and downgrade the daemon

Location: `src/harness/shared/ensure.ts:63` (the next boundary is the only successor mechanism), `ensure.ts:31` (request then ordinary ensure), and `src/core/daemon/daemon.ts:412` (shutdown clears the daemon record without arranging a successor). The socket request carries only a version, not the requesting bundle's CLI.

Spec D10: "a downgrade replaces nothing" and "the next boundary after its record is cleared spawns one from the hook's own CLI"; 001-125's outcome: "the hook's own ensure path starts a current one." The brief explicitly asks whether step-down can replace a newer daemon with an older one.

**Failure scenario, reproduced with released bundles:**

1. Start the released Claude Code 0.1.32 daemon from `dbeb862` in a fixture worktree. A ping reports `squealVersion: "0.1.32"`.
2. Run the candidate's shipped Codex `dist/session-start.mjs` (0.1.33). It requests `step-down`, falls back to `stop` because 0.1.32 predates the protocol, and returns while the old daemon exits. Its registration keeps the newer session present.
3. After that process exits, run the **released Claude Code 0.1.31** `dist/post-tool-batch.mjs` from `8654424` in the same worktree. It represents another session still using the older installed plugin. It is the first tool boundary after the record is cleared.
4. A ping reports a new daemon at **0.1.31**, older than both the daemon just stopped and the hook that requested the upgrade. The only shutdown note is `daemon stopped: squeal stop`.

The same sequence first reproduced with a candidate-source daemon reporting 0.1.32 and taking the new step-down protocol, so this is not peculiar to the legacy stop fallback. With no further boundary from the newer session, the old replacement remains. The newer SessionStart itself returns without arranging the promised current successor. All processes and stores were private to the probe.

This is an upgrade-induced downgrade, not a comparison error against a live newer daemon. The live comparison correctly protects equal and newer versions. The gap starts when the record is cleared and the next ensure has forgotten which bundle requested the handover.

**One-worker fix:** make an upgrade arrange a successor from the requesting newer bundle independently of which session takes the next tool boundary. Carry its CLI identity through a bounded handover mechanism and ensure a legacy contender cannot leave the older daemon serving indefinitely. A detached handover helper that retries if a legacy contender wins is one possible shape; merely adding a version floor to new hooks is insufficient because the released 0.1.31 hook and daemon do not read it. Preserve the existing lock and shutdown order, keep synchronous hooks within their socket budget, and add this mixed-bundle counterexample as a real-daemon regression test. Update D10 to name the handover owner and its timeout. This needs no scheduler rewrite.

## Should-fix

### S1. Proven note, nonblocking: the backlog budget is an estimate, not a wall-clock limit

Location: `src/core/scheduler/backlog.ts:5`, `src/core/scheduler/tiers.ts:84`, and spec D5 step 5's phrase "so it ends within that bound whatever the runner's parallelism".

The estimate counts unknown durations as zero and always admits the first file even when it alone exceeds the estimate. The 10001-file selection probe admitted 10000 files with a zero estimate under a 100 ms runner timeout. This follows the spec's explicit unknown-duration and first-file rules, but contradicts the claim that the estimate guarantees a runtime bound. Earlier timings also cannot bound a later run that becomes slower.

The independent run deadline still initiates cancellation. It is not an end-to-end wall-clock deadline: a real busy-loop run with `timeoutMs: 3000` returned after 4010 ms. `execute` waits another 1000 ms before forcing, and can wait a further 5000 ms before abandoning the instance (`src/runners/vitest/run.ts:70`). That cancellation grace predates this wave; it is not a new timeout blocker. In the probe the completed sibling was retained, the busy file produced no result, and the next run remained usable.

**One-worker fix:** correct the new budget comments and D5 wording to say it limits selected **last-known** time, and name the unknown-duration/oversize-first-file exceptions and cancellation grace. If the product needs a hard few-minute execution cap, specify and implement an actual deadline separately. Do not change timeout semantics on the strength of this wording note alone.

## Nits

### N1. Proven provenance mismatch at assignment, corrected for verification

Initial `git rev-parse HEAD` was `7ec5085b8a978e6ec5b6eb8ddf64dd3b53404a45`, not the named candidate `9c23b22`. `git diff --stat 9c23b22..7ec5085` contained only `docs/board.md` and `docs/specifications/001-core-loop/tasks/wave-12.md`. Verification and probes ran after explicitly checking out `9c23b22`; the assigned branch was restored for the findings-only commit. No code or build evidence was taken at the mismatched HEAD. Nonblocking; dispatch the exact SHA when possible.

## What fits

- **Current results and stability:** D5's run keys remain snapshots. Revision changes join `ledger.tierChanges`; `unstableInputs` re-hashes the tier's stability paths; `recordTier` rejects files whose inputs changed. In both first/last selected-file probes an imported module was edited to make its assertion fail during a 12-file forced backlog tier. The next tier ran the edited file first with at most two files; its final test state was current/fail. Completed unaffected files did not run again. No stale result escaped as current in these cases.
- **Partial cancellation:** an abort after a fast file completed alongside a synchronous busy-loop file was not honoured within 1 s. The second cancel stopped it 1013 ms after abort. Only the fast file was completed and retained; the subsequent fast-file run passed. A pre-aborted signal and async cancellation are also covered by the candidate's adapter tests.
- **Queue size and starvation:** seven unknown-duration files ran in seven tiers at size 1, and one tier at size 10000. The pure 10001-file probe confirmed the 10000-file cap exactly. Recent work keeps `runner.tierSize`; the backlog turn after four recent-only tiers stays small and uncancellable. The existing ordering/recent-first/starvation tests passed in the full run. Unfinished cancellation work is re-queued without discard counts and retains `forced`; completed stable work is stored under its run key.
- **Normal handover, both plugins:** each shipped 0.1.33 plugin stopped its own released 0.1.31 daemon during a 4 s test. Another hook in the window did not start a replacement, and an explicitly spawned contender exited 0 while the old process still served its socket. The old tier's test result was current/pass before its daemon record was cleared. The next boundary from the same current plugin started 0.1.33. B1 concerns a different-version plugin taking that boundary.
- **Version ordering:** real daemons reporting 0.1.33, 0.1.34 and 0.1.31-rc.1 retained their PIDs after current Codex hooks. The hook-side tests also cover numeric ordering and malformed versions; daemon-side handlers repeat the comparison. Prerelease strings deliberately compare as not newer under the amended D10 contract. General semver precedence is not implemented or claimed.
- **Module seams:** `RunOptions.signal` reaches the Vitest adapter and `execute`; a cancelled completed report causes `recordTier` to re-queue unfinished files, not classify them as a crash. Graceful shutdown calls scheduler close, waits for tier recording, closes the runner, clears the record, closes the socket, then releases the lock. The new request passes through parsing, handlers, the front-desk worker message and the main daemon callback in the correct argument order.
- **Section conformance and scope:** the D4/D5/D12 runner and storage paths, D10 normal/equal/newer/legacy handover, and D11 policy key were checked against the changed boundaries and tests. Other spec sections and the unrelated 001-126/S1 code in the build were not re-prosecuted. No new runtime dependency or schema migration was added by these rows. Both plugin bundles rebuild without drift.

## Inputs for the next wave

1. Dispatch one 001-125 repair row for B1 across shared ensure, the handover protocol/lifecycle as needed, and real-daemon tests. Its done-when must include released **mixed-version** hooks, not just multiple current hooks: stop a released 0.1.32 daemon with the 0.1.33 Codex hook, let released 0.1.31 Claude Code take the first boundary, and obtain a serving daemon from the requesting newer bundle without requiring another turn from that session. Cover the new protocol path too.
2. Keep the transaction/lock order: let the running tier finish and store, leave abandoned queued checkpoint work to the successor, clear the old record, close its socket, release its lifetime lock. Test a competitor in the window and prevent two lock winners. The handover mechanism must have a named owner, a budget, and a cleanup rule if the worktree vanishes. The current request budget is one 100 ms round trip, or two for the legacy fallback; do not wait synchronously for the tier in a hook.
3. Fold S1's wording into that wave or a documentation row. Selection remains `min(300000, timeoutMs / 2)` of last-known durations, with unknown zero and first-file exception; cancellation currently permits up to 1000 + 5000 ms of cleanup. No proof here supports tightening either value.
4. The backlog probes and normal both-plugin handover are settled for this candidate. Re-check them only if the repair changes those paths. The full suite remains recorded with one out-of-range timing failure; the isolated timing check passed. No product code was repaired by this review.
