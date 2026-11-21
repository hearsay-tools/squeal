# Wave 23 review

FAIL `15417c90cad267e53ba7befb242a7d4b86f7eb89`: **3 blockers, 2 should-fix findings, 1 note**.

Range: `d05244033..15417c90cad267e53ba7befb242a7d4b86f7eb89`, candidate `cand/0.1.592`. HEAD matched the requested candidate. The review worktree was clean. Only this report is committed.

## Verification

Heavy checks and probes ran in an isolated boat.dev sandbox. The candidate archive, original commit object and index reconstructed HEAD at the exact candidate, with tree `f44bb6610fa833c3cdfd5b5cb8b45760e96afbec`. Node was 24.22.1, pnpm 12.15.0. No full suite ran.

| Command or evidence | Actual result |
| --- | --- |
| Dependency setup | Kept the review worktree's prepared dependencies. Sandbox `pnpm install --frozen-lockfile`: exit 0, 5.7 s. |
| `pnpm run lint` | Exit 0, 3,971 files checked, no fixes. One existing warning and two infos in unrelated tests. |
| `pnpm run typecheck` | Exit 0, no diagnostics. |
| `pnpm run build` | Exit 0, all plugin builds. `git status --short` was empty afterward. |
| `git diff --check`; `pnpm run check:private` | Diff check passed. Private-material check exited 0; its configured private denylist was empty, so that rule was skipped. |
| Installed `squeal checks` | Default tests: 2,105 files. Typecheck, build and `test/e2e/**` are outside coverage. |
| Installed `squeal status --wait 60000` on the ten changed core/CLI paths listed below | Exit 3 at revision 0: 1,288 selected files current and passing; 206 unknown, comprising 99 waiting on another worktree's run and 107 never run under lookup-only baseline. Whole worktree: zero known failures, 207 of 2,105 not current. This is incomplete affected-test evidence. |
| Clean targeted command below | Exit 0: **7 files, 46 tests passed**, 22.39 s. The gated e2e file and its two tests were skipped. The checkout permissions case ran, rather than skipping. |
| `timeout 600 pnpm exec vitest run --maxWorkers=2 test/cli/status-at*.test.ts` | Exit 1 on a clean tree, 155.10 s: **28 files passed, 1 failed; 112 tests passed, 1 failed**. `status-at-review13-b2.test.ts` hit `database is locked` while its polling helper opened the store (`PRAGMA user_version`, `schema.ts:233`, called by `status-at-kit.ts:48` and `storedOnce:60`). The cause remains unresolved; this is not a proven product regression. The earlier supplemental run passed all 29 files and 113 tests in 186.57 s, but a temporary probe file existed briefly during it, so it is not clean-tree evidence. No further broad rerun was made. |
| Exact-candidate CI | [CI 44945491667](https://github.com/hearsay-tools/squeal/actions/runs/44945491667) was still in progress at the last read. Full-suite coverage remains unverified. [Private material 44945491616](https://github.com/hearsay-tools/squeal/actions/runs/44945491616) passed. |
| Performance | No per-release benchmark comparison was supplied. A separate measurement worker is measuring this SHA. Its forwarded reproduction supports B3 below; start/memory results have not been accepted here as completed performance evidence. Performance remains unverified and is not a finding or gate. |

Affected paths:

```text
src/cli/status-at-call.ts src/cli/status-at-daemons.ts
src/cli/status-at-after.ts src/cli/status-at-join.ts
src/core/checkout/commit-identity.ts src/core/checkout/sweep.ts
src/core/daemon/commit-mode.ts src/core/daemon/daemon.ts
src/core/daemon/policy.ts src/core/types/policy.ts
```

Clean targeted command:

```sh
timeout 600 pnpm exec vitest run --maxWorkers=2 \
  test/cli/status-at-call.test.ts test/cli/status-at-commit-daemon.test.ts \
  test/cli/status-at.test.ts test/checkout/commit-kept.test.ts \
  test/checkout/commit-worktree.test.ts test/checkout/commit-identity.test.ts \
  test/daemon/commit-removal.test.ts test/e2e/at-commit-status.test.ts
```

The throwaway probes below were separate supplemental checks, removed afterward. They assert the observed defects, so their passing assertions are defect witnesses, not product acceptance tests. They used explicit test paths and `--maxWorkers=2`. Their waits use event barriers or daemon state, with no fixed sleep as proof.

## Blockers

### B1: the finite wait does not bound admission or daemon setup — proven

**Locations:** `src/cli/status-at-call.ts:93`, `:120`; `src/cli/status-at-queue.ts:64`; `src/cli/status-at-daemons.ts:107`, `:122`, `:130`.

D7.3 says the call waits up to 100 s by default, then reports. Q7 ties this to the 120 s tool limit. The row notes explicitly say the bound counts from the call's start, including keying.

The deadline reaches requests and result waits, but not commit admission, installation, daemon start or claim. `ensureCommitWorktree` receives no call deadline. At a full ceiling it uses its independent 600,000 ms default. Installation has another 300,000 ms bound. Starting then claiming can add a further independent 60 s claim wait. Each group request can also create a new minimum ten-second allowance after the call deadline.

**Failure scenario:** configure `daemon.maxCommitDaemons: 1`, keep one commit daemon live, then call `status --at <another-commit> <file> --run`. The waiting note reaches stderr, but the call can wait ten minutes for admission. It cannot produce the promised report at 100 s. The new ceiling test hides this by injecting `placeWaitMs: 1500`.

**Probe:** with `--wait 0`, hold the commit setup promise. Wait until the other side reaches its result-wait barrier. The comparison remains unresolved after its deadline until commit setup is released. This proves the missing bound without a timed sleep. The production ceiling constants give the concrete ten-minute case.

**Fix:** one finite deadline must govern keying/admission/start/claim/request work, with bounded reporting overhead. A place request that must continue afterward needs a live owner outside the caller. Do not fix this with an unowned `Promise.race`: the creator must stay alive until a live daemon claims the marker. Cover a full ceiling, death before claim, claim expiry and several groups after deadline. A daemon that dies before claiming currently consumes the whole claim allowance; expiry reports it not queued and leaves creator ownership to the later sweep.

### B2: Q7's follow-up cannot join recorded requests before they are taken — proven

**Locations:** `src/cli/status-at-join.ts:33`; `src/cli/status-at-call.ts:116`; `src/cli/status-at-report-queued.ts:115`.

D7.3: "`--at … --wait` without `--run` joins work already queued." The first call correctly counts a recorded request as pending. The next call loses that information: commit joins read only `test_file_keys.pending`, and worktree joins use only the file states derived from those rows. A request can be recorded in the daemon's socket request map while startup or listing still prevents the scheduler from taking it. It has no pending file row yet.

**Probe:** both daemons answer the first narrow request as recorded/pending, without changing the file-key rows. The first call exits 3 and prints Q7's `--wait 100000` command. Run that command against the same daemons. It performs zero waits and prints:

```text
--wait: nothing is queued or running for these files at <commit> or in the working tree
```

It also offers another `--run`. No request was cancelled or completed between calls. The second command does not do what the first command promises.

This probe still exits **3**, not 0: the expected keys have no results. The gap alone does not prove a false "all known" comparison. The proven defects are the missing join and the false queue statement.

**Fix:** retain or expose recorded narrow requests and their covered files, on both sides. Join the request until it is taken, failed or completed, then join its file work. A new caller must discover it without queueing another run. Test the exact Q7 follow-up while a request is held before scheduler acceptance.

### B3: a completed first-seen run is read at its obsolete pre-run key — proven

**Locations:** `src/cli/status-at-call.ts:77`, `:195`; `src/cli/status-at-after.ts:88`; `src/cli/status-at-select.ts:67`.

D7.1 requires commit keys to equal D2's. The recommendation explicitly asks the call to read live commit-daemon keys, including observed growth. T4 requires a first-seen file to become comparable. Instead, this call keys before either daemon runs and fixes the report to that snapshot. A run can add observed inputs and finish at a new key. `commitAfter` then deliberately reports `not determined`, even though a fresh D2 keying reads the completed result.

**Independent real-daemon probe:** commit a test that reads tracked `payload.json` with `readFileSync(new URL('../payload.json', import.meta.url), 'utf8')`. Change the payload at HEAD. Use a fresh store and the real commit daemon, with a stand-in only for the current side. Call `--run --wait` until done. The initial key is `5f7fe77be25b`; the daemon stores its completed pass at `f84a66bfd8e9`. The report says:

```text
not determined: the daemon stored it at key f84a66bfd8e9,
not at this call's 5f7fe77be25b
```

An immediate plain `status --at` keys again using the shared observed set and reads that pass. The differing input is the newly observed tracked payload, not a different commit or environment.

The coordinator independently forwarded the same defect on this repository at the exact candidate. On a fresh store, `test/daemon/commit-removal.test.ts` was keyed at `65938cf808a8`, then stored at `31ba6e218a52`. Both had environment hash `c0477f403ad3`. Runs added 92 observed paths; four present paths entered the key: `package.json`, `pnpm-workspace.yaml`, `src/core/code/coverage/provider.mjs`, and `src/runners/observe/recorder.cjs`. A later plain lookup read the new key and reported unchanged. That measurement ran the published candidate bundle against a four-commit chain of its trees, using `status --at HEAD~1 test/daemon/commit-removal.test.ts --run`.

The refusal to mix different keys is honest and must stay. The defect is retaining an obsolete key after learning its inputs, so the completed run cannot answer the call.

**Fix:** use validated live commit keys, or repeat D2 keying after observed growth before the final lookup. Keep the commit-tree integrity and environment checks. Never substitute an arbitrary daemon key just because it has a result. Test a first-run tracked runtime read and require its completed result in the same call, plus a genuine wrong-key negative control.

## Should-fix

### S1: implicit start clears an explicit stop and command holds — proven

**Locations:** `src/cli/status-at-daemons.ts:99`, `:187`; `src/cli/status-at-queue.ts:73`. Called contracts: `src/cli/start.ts:56`, `:107`, `:113`.

When no worktree daemon answers, the comparison calls `startCommand`. That clears the stopped mark, including `stop --until-start`, and removes every command hold. A held command can still be running. `quietStart` drops stdout, including the warning that the hold ended while its command runs. A daemon that already answers follows a different path and keeps the hold.

**Scenario:** stop validation while a long install or manual test holds the worktree; an agent asks for an older-commit comparison. This starts continuous validation and removes the existing hold, rather than merely requesting the selected comparison files.

**Judgment:** this overrides the user's explicit stop. I do not consider the silent override acceptable. The row explicitly asked for start behavior, so this is a design issue to resolve, not another blocker against its implementation. Prefer preserving stops and command holds, reporting the current side as held/stopped with the explicit `squeal start` next step. Otherwise obtain and record an explicit policy amendment, expose the override, and test it. D7's instruction to start an absent daemon does not explain this broader loss of user controls.

### S2: a completed join keeps the stale pre-wait `--run` advice — proven

**Locations:** `src/cli/status-at-call.ts:150`; `src/cli/status-at-assemble.ts:56`; `src/cli/status-at-report.ts:311`.

`--wait` uses `commitRun(run: null)`, which builds Q1's next-step probe before waiting. Assembly retains that probe after replacing the file states with completed results.

**Probe:** join one running file on each side; both finish and store their passes during the wait. The call exits 0 and prints `1 unchanged, 0 unknown`, then ends with:

```text
squeal status --at <commit> test/a.test.ts --run
runs the 1 file with no result there (estimate 1 s).
```

This is reachable old lookup-path logic with a new wait between its snapshot and report. It also puts obsolete `--run` advice after Q7 when only part of the work finished.

**Fix:** suppress the pre-wait probe for queued/joined reports, or recompute next steps from the final states. Test text and JSON for a completed join and a partially completed join.

## Notes

### N1: an identity-failed tree can still cause user-file deletion — proven, pre-existing fallback

**Locations:** `src/core/checkout/sweep.ts:84`, `:86`; `src/core/checkout/checkout.ts:233`.

The worker's qualification is a real data-loss risk. It is not restricted to deleting a corrupted marker. An identity failure selects generic `removeTree`, which recursively deletes the whole folder, including unknown siblings.

**Real-worktree probe:** create and install a commit worktree through `ensureCommitWorktree`; add `user-file.txt` beside `tree`; unlock that linked worktree with Git; set its marker owner to a dead lease. Identity is now null because the lock reason is absent. Sweep the repository's cache checkout directory. Result:

```text
userFileExists: false
treeExists: false
notes: []
```

The same identity failure can follow a removal that unlocked the worktree but could not remove it. A safety check rejecting identity is not proof that recursive removal is safe.

This fallback already exists at the base SHA. The new treeless repair does not create it, so it is a nonblocking note under the bounded review rule. Follow-up: keep and report a fingerprint-marked folder whose live tree fails identity; never escalate failed identity to broader deletion. Add the identity-failed tree and unknown sibling to the preservation regression.

## What fits

- N2's intended treeless case is repaired in both checkout locations: the retained marker survives, a later sweep preserves the unknown file, a new worktree is made beside it, and an empty retained folder can go. Disabling only the new treeless sweep branch made both preservation tests fail with ENOENT on `user-file.txt` (exit 1, two failures). Source was restored afterward.
- N3 distinguishes unreadable from missing. The non-root permissions regression passed. The daemon uses the removal outcome and falls back to `lstat` when no outcome is returned; it no longer calls an unreadable tree removed.
- Normal fixture runs prove a commit daemon claims the worktree, stores at the initial D2 key when inputs do not grow, serves a second caller without another start, and forwards the ceiling note to stderr. These are useful assertions, but do not cover B1 or B3.
- The new call sends one narrow request per group, with `at`, an owner token and named-file priority. It sends no take-back. The current-side and commit-side result waits run together.
- Parsing accepts finite and bare `--wait`, joins without `--run`, refuses `--timeout` with exit 2, and emits report version `squeal-status-at/2`. The new positive-integer config key and skill step 8 match the chosen interface.
- The normal comparison still reads results by project, path and key. No probe demonstrated a wrong-key result reported as a valid comparison. Unknown/no-result cases retain exit 3; completed known comparisons retain exit 0, including failures as comparison answers.
- The old in-call modules remain reachable through private test helpers and proof's gate-child path, not the public `status --at --run` route. Their removal is still row 023-41's work. S2 is the old lookup probe that is now inconsistent with the new join path.
- The existing opt-in e2e file still expects the old run shape and tries `--at HEAD --run` despite the HEAD refusal. This review did not enable it or claim it passed. Its skipped output supplies no end-to-end evidence for the daemon path.

## Inputs for the repair wave

1. Keep the order: identify/key the commit, obtain a safely owned commit worktree, start or reuse its daemon, confirm its live claim, send narrow requests, then wait and report. Give every finite-call step the same deadline. Preserve ownership if work outlives the caller.
2. Join recorded requests before joining pending file rows, on both daemons. The printed follow-up must work before scheduler acceptance and queue no new run.
3. Refresh commit keys after observed growth, with integrity and environment validation. Compare only at the refreshed D2 keys. Keep the wrong-key refusal for genuine mismatches.
4. Remove stale next-step advice from joined reports. Resolve the stop/hold policy explicitly. Retain N1 as a separate cleanup safety follow-up.
5. Add behavioral regressions for these seams. Keep the successful claim/reuse/kept-file/permissions checks. A re-review should cover the blocker fixes, their boundary changes, and current exact-SHA CI evidence; no full local suite is needed.
