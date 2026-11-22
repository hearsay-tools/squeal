# Wave 23 third review

FAIL `d0925e820b8d7a380fa722ffcf19ad8c4e9a61cd`: **2 blockers, no should-fix findings, 1 note**.

Range: `ecc5ff1ba..d0925e820b8d7a380fa722ffcf19ad8c4e9a61cd`, candidate `cand/0.1.592`. HEAD matched. Reviewed prior B1 and rows 023-40c and 023-46. Requirements include D7.3/D7.4 and `tasks/wave-24.md` as amended on `origin/main`. Only this report is committed.

## Verification

Heavy checks ran in an isolated sandbox. The archive and original commit object reconstructed the exact candidate and tree `d622af1cb406fa95a9632f77a0fa1df2d100ae4f`. Node was 24.22.1; Corepack selected pnpm 12.15.0. No full suite ran.

| Check | Actual result |
| --- | --- |
| Dependencies | Kept the prepared worktree dependencies. Sandbox `pnpm install --frozen-lockfile`: exit 0, 3.9 s. |
| `pnpm run lint` | Exit 0; 3,991 files checked, no fixes. One warning and two infos. |
| `pnpm run typecheck`; `pnpm run build` | Both exited 0. No tracked build drift. |
| `git diff --check ecc5ff1ba..HEAD`; `pnpm run check:private` | Passed. The private denylist was empty, so that rule was skipped. |
| Installed `squeal checks`; affected `squeal status --wait 60000` | Revision 8 at `d0925e82`. The second path wait exited 3 after 60.6 s: **398 selected files pass, 305 pending**. Whole worktree then: zero known failures; 421 of 2,116 files not current. This remains incomplete affected-test evidence. A later background failure is recorded below. |
| Targeted command below | Exit 0: **13 files, 40 tests passed**, 32.91 s. An earlier invocation printed the same 40 passes, but its remote launcher had a 30 s limit and exited 143. The completed invocation used a 700 s launcher limit. |
| Deadline witness | Default 100 s call returned after **125,276 ms**, using production current-side keying and a slow Vitest configuration hook. B1 below. |
| Stored-closure witnesses | Real Vitest closures with real schedulers/store reproduced missing candidates. A separate real-daemon call reproduced missed commit-side selection. B2 below. |
| Red controls | Removing spawn ownership, the cut worktree spawn wait, the post-install tree check, D4.9 refusal, or the incomplete-closure list each made its regression fail at the intended assertion. Removing only the stored-walk shortcut made its three committed tests fail and restored the missing candidates and public-call selection. Source edits were restored. |
| Exact-candidate CI | [CI 44964561901](https://github.com/hearsay-tools/squeal/actions/runs/44964561901) remained in progress. Its Node 24 lint/typecheck/version-sensitive job passed. [Private material 44964561880](https://github.com/hearsay-tools/squeal/actions/runs/44964561880) passed. Full-suite evidence remains pending. |
| Performance | Read `tasks/023-46-notes.md`: source measurements on a loaded machine show reduced start cost. The integrated bundle measurement was still running separately; no per-release benchmark comparison was supplied. Performance is unverified here and is not a blocker. |

Affected paths:

```text
src/cli/status-at-call.ts src/cli/status-at-daemons.ts
src/core/daemon/commit-start.ts src/core/daemon/at-asks.ts
src/core/scheduler/proven-walks.ts src/core/scheduler/bootstrap.ts
```

Targeted command, with pnpm selected through Corepack:

```sh
timeout 600 pnpm exec vitest run --maxWorkers=2 \
  test/cli/status-at-setup-bound.test.ts \
  test/cli/status-at-deadline.test.ts \
  test/cli/status-at-commit-daemon.test.ts \
  test/cli/status-at-commit-refused.test.ts \
  test/cli/status-at-run-gitattributes.test.ts \
  test/cli/status-at-not-selected.test.ts \
  test/cli/status-at-call.test.ts \
  test/cli/status-at-call-after.test.ts \
  test/cli/status-at-join-recorded.test.ts \
  test/cli/status-at-stopped.test.ts \
  test/daemon/at-asks.test.ts \
  test/scheduler/proven-walks.test.ts \
  test/scheduler/changed-selects.test.ts
```

The supplemental probes and controls were outside the clean acceptance run and are not committed. The install tests use barriers and a real held lock. The slow configuration hook is a controlled workload, not a sleep used to guess background completion. Closure probes await daemon readiness and scheduler quiet points.

Squeal later reported `test/scheduler/group-lanes-moments.test.ts:113`: the pause-group request still had one queued file, expected zero. Read its full `why` report. The same assertion has a recorded FAIL-to-PASS history before this wave; this run reported load 1.33 per CPU. A requested load retry found a run already queued. Squeal then reported FAIL-to-PASS at the same tracked inputs, inherited from another worktree at the exact candidate. This is additional flaky-test evidence, not evidence for either blocker.

## Blockers

### B1 remains open: current-side keying can exceed the whole-call deadline (proven)

**Locations:** `src/cli/status-at.ts:231`; `src/cli/status-at-call.ts:181`, `:195`; `src/cli/status-at-now.ts:64`, `:150`.

Amended D7.3 says: “Every step the call takes (locks, worktree add, daemon start, requests, waits, reads) counts against the one wait (100 s by default), with a small reserve for the report.” Q7/T6 requires the answer inside the 120 s tool limit.

The commit-side install and temporary keying are gone from the call. That repairs the previous install witness. But `statusAtCommand` still awaits `nowSide` before entering `daemonCall`. With no serving worktree daemon, or one that has listed nothing, this opens the real adapters and keys in the caller. It has no call deadline or cancellation. The final `readAfter` can open them again after the daemon waits; `listLate` can also key files there. A two-second report reserve does not bound these operations.

**Reproduction:** a fresh fixture tracks `test/a.test.ts`, importing `src/a.ts`, and a Vitest configuration with this plugin:

```js
{
  name: "slow-project-start",
  async configResolved() {
    if (!existsSync(marker)) {
      await new Promise(resolve => setTimeout(resolve, 125000));
      writeFileSync(marker, "done");
    }
  }
}
```

`marker` is outside the fixture and prevents repeating the delay during the final read. Commit A has value 1; HEAD changes it to 2. There is no worktree daemon. Call `status --at A test/a.test.ts --run --json`, with the default wait. Adapter creation and keying are production code. Daemon ports are stand-ins; the call has already exceeded its bound before reaching them.

```text
elapsed:       125276 ms
run.waitMs:    100000
run.usedMs:    125271
exit:         3
working tree: the call's wait ended before its daemon was asked
```

The default call is still not bounded below 120 s. This is the previous whole-call finding, not a performance-score objection. The notes call current-side fresh keying “short”; loading user configuration cannot guarantee that. The independent package-store query and `git worktree add` timeout also have no shared remaining deadline (`src/core/checkout/location.ts:101`, `src/core/checkout/checkout.ts:134`), though this review needed no second timing witness for them.

**Fix boundary:** give current-side discovery, initial keying, late-file keying and final reads a deadline-aware owner too. Prefer handing that work to the user's daemon and reporting setup/unknown while it runs. Preserve explicit stops and command holds. Cancel and settle any caller-owned operation within the deadline; a timeout race that leaves it running does not settle ownership. Pass the remaining deadline through worktree creation and location queries as D7.3 requires.

**Required regressions:** a slow real configuration hook with no worktree daemon must not hold a finite call beyond its reporting allowance. Cover the final-read fallback when the daemon is unavailable at expiry. Keep the passing install, install-lock, late-start and spawn-owner tests.

### B2: an equal key does not prove the stored closure's absent candidates (proven)

**Locations:** `src/core/scheduler/proven-walks.ts:62`, `:64`; `src/core/scheduler/bootstrap.ts:198`. Consumers: `src/core/scheduler/scheduler.ts:937`, `:969`; `src/core/daemon/at-asks.ts:220`.

Row 023-46 requires safe closure reuse. Row 023-40c uses that closure for D4.5 selection and D4.9 refusal. `checkKey` omits absent paths, so equal keys prove present paths and bytes, not equal absent candidate lists. The shortcut keeps the latest shared `testFiles` closure even when the matching walk row belongs to a different closure at the same key.

**Reproduction, with no stored result for the test:**

1. At A, a test imports extensionless `../src/foo`; no target exists. A daemon walks it. Its closure includes `src/foo.js`, `src/foo.ts` and the other unresolved candidates, and stores a walk at key K. Keep this worktree's row at K, so import-graph pruning retains the walk.
2. In another worktree, add and commit `src/foo.js`. Start its daemon. Its resolved closure holds `src/foo.js` but omits `src/foo.ts`. This becomes the latest shared closure list. Stop this second daemon.
3. In the caller's main worktree, branch from A and add only `src/foo.ts`. Call `status --at A test --run --wait 30000 --json`. The named folder narrows selection and does not force the test.
4. The real commit daemon at A keys the latest list at K, finds A's walk row at K, and skips its fresh walk. It keeps the other worktree's resolved list. Its reverse index misses the changed `src/foo.ts`.

Observed public-call result:

```text
at:                 no result, notSelected: true, closure: unchecked
run.commit.files:   0
run.notSelected:    1
exit:               3
```

Disabling only `unprovenWalks` at the baseline call site makes the same real-daemon fixture select and run the test: `run.commit.files: 1`, `at: fail` with its missing-import error, `notSelected: 0`. Its key remains K. The lower-level real-adapter fixture also shows `changedSelects(["src/foo.ts"])` and `closureReads(path => path === "src/foo.ts")` empty with the shortcut, and populated without it.

This demonstrates no wrong known comparison or changed key. It does prove that the new miss shortcut serves the wrong closure and skips a file the change selects. Existing lookup-hit behavior does not dismiss it: this fixture has no result, and the previous miss path rewalked it correctly. The notes acknowledge the absent-candidate case, but the spec does not accept this regression.

**Fix boundary:** reuse a closure proven for the matching walk, including its absent resolution candidates, or rewalk when the latest list cannot prove that closure. A walk row's existence does not prove a different stored list. Restoring the previous behavior needs no key-format change.

**Required regression:** use the three-worktree sequence above with real Vitest resolution and no result at K. Assert that the commit call selects the test after `foo.ts` is added, and that D4.9's closure query retains that candidate. Keep a live A row so the walk at K survives pruning; reusing one worktree for A and B misses this case. Preserve the unchanged-file no-walk tests.

## Note

### N1: the daemon path announces a temporary commit-keying checkout (proven)

**Location:** `src/cli/status-at.ts:233`.

Every text `--run` or `--wait` call prints “keying test files at <commit> in a temporary checkout” immediately before taking the new daemon path. That path keys nothing at the commit in the call. Move the line into the plain lookup branch or describe daemon setup. This is stale progress text, not a wrong comparison or a blocker.

## Closed parts and what fits

| Boundary | Evidence and judgment |
| --- | --- |
| Commit install and initial/final commit keying | The call creates with `installs: false` and reads daemon rows. It takes no commit install lock and makes no second keying checkout. A held install returns setup/unknown; the daemon finishes it, and a later `--wait` reads its pass. A separately held install lock also leaves the call bounded. These parts of prior B1 are closed. |
| Late working-tree start | The real `squeal start` path receives the remaining spawn allowance. Its regression passes; restoring 30 s makes it take 30,283 ms against the 16,000 ms assertion. This part of B1 is closed. |
| Unclaimed start ownership | The spawned pid owns the marker before the call waits for service. Sweep keeps the live owner's tree and removes it after exit. Removing the handoff fails the owner-pid assertion. This part of B1 is closed. |
| Ceiling, death and groups | The full-ceiling wait ends, early daemon death returns promptly, and groups share the request bound. The estimate is now 2 GiB per commit daemon. |
| Prior B3 | The tracked runtime-read fixture with a fresh store and real commit daemon passes in the same call. The call reads its completed key. The wrong-row-key negative control also passes. |
| Prior B2, S1 and S2 | Recorded asks survive setup and Q7 joins them; join queues no new work. Stop marks and command holds remain respected under the coordinator's policy. Completed joins have no stale `--run` next step. |
| Whole-checkout and refusal | Pre-install git-rule changes and post-install tracked-file changes refuse the whole commit side. D4.9's ordinary generated-file case and node:test incomplete-closure marks pass. Removing each mechanism fails its test. B2 above is the remaining stored-closure seam. |
| Prior N1 preservation | The identity-failed-folder repair is unchanged. The prior review's preservation evidence remains applicable. |

The committed shortcut tests prove fewer walks, equal keys in their simple fixtures, and a changed-file negative control. All three fail when the shortcut is removed. They do not model a resolved target becoming absent while a different worktree preserves a matching walk at K. Neither finding uses a fixed sleep to infer background completion.

## Inputs for the next step

1. Resolve B1 for current-side reads and discovery as well as commit setup. Preserve stop/hold behavior and the passing setup/ownership tests.
2. Restore absent-candidate coverage on misses before trusting the stored closure for selection or refusal. Add the three-worktree real-resolution regression.
3. Keep the closed B2/B3/S1/S2 and whole-checkout protections. Exact-release full-suite CI must pass before release. Missing performance evidence remains separate from these correctness findings.
