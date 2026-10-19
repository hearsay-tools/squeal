# 004-80 the slow lane runs continuously: worker notes

Worker 6470300b, coordinator 8f17c7ea, 2026-10-19. Brief: `../wave-13.md` § 004-80. Branch `cez/6470300b`, base `ad5dd720`.

## What changed

- **Trigger** (`src/core/scheduler/slow-trigger.ts`, new, split from `slow-tier.ts` so the seam file does not grow): `policyTriggered` is D2's trigger (a) by `slow.trigger`. Under `"continuous"` it holds once the latest revision is `slow.quietMs` old (`quietLeftMs`; a worktree with no revision is quiet); the fast lane's being done stays `SlowTier.#fastFirst`, unchanged. Under `"idle"` it is `consumersIdle`, unchanged; `slow-tier.ts` re-exports `consumersIdle`.
- **Pumping** (`slow-tier.ts`): a fast tier's end already pumps (`scheduler.ts` `#pump` loops into `SlowTier.next` once no fast tier is left). What was missing was the quiet window's expiry: a slow file no trigger lets run now arms a timer for the rest of the window instead of `SLOW_RECHECK_MS`, and `#arm` replaces an armed timer that would fire later. Under `"idle"`, and for the slot, it still arms at `SLOW_RECHECK_MS`.
- **Published activity**: under `"continuous"` a file waiting out its quiet window publishes no activity (the line reads `N pending`), not "waiting for the agent to pause". No new `SlowTierWait` value, so no reader of another version reads an unknown wait.
- **Policy** (`src/core/types/policy.ts`, `src/core/daemon/policy.ts`, each in its own block for the join with 004-82): `slow.trigger` (`"continuous"` default, `"idle"`), `slow.quietMs` (default **3000**, below).
- **Path wait** (`src/cli/named-files.ts` `pauseOnlyIds`): returns none unless `slow.trigger` is `"idle"`, so under `"continuous"` a named wait holds for a queued slow file until its result, and one over slow files alone gives a verdict instead of `slow` (exit 3). `"idle"` keeps 004-78's behaviour.
- **D8 wording**:
  - `Slow tier:` line ending (`src/core/state/slow-text.ts`): "Squeal runs them after the fast tests" by default, "when the agent pauses" under `"idle"`. The same goes for "the pending ones … and has not queued the rest".
  - A queued slow file's named-wait reason (`src/cli/named-file-lines.ts`): "slow, run after the fast tests or on `squeal run --slow`", or "when the agent pauses" under `"idle"`.
  - Quiet `status --wait` clause (`src/cli/status-wait-lines.ts`): under `"continuous"`, with slow files pending, "N slow files are not current and Squeal runs them after the fast tests; …" (or "the pending ones" when some are not run). Under `"idle"` it is 004-71's text, verbatim.
- **Primer** (`src/harness/shared/primer.ts`): "Slow test files run after the fast tests; …", or "when you pause between turns" under `"idle"`. The second slow sentence (how a slow failure arrives) is true under both triggers and is unchanged.
- **Docs**: README "Slow tests"; the skill's `references/policy.md` (two rows after `slow.maxParallel`), `commands.md` (named wait, `run --slow`) and `reports.md` (Slow tier) in all three copies.
- `KEY_FORMAT_VERSION` 13 re-pinned in place, twice (`933c35b1`, `4ce172aa`); the guard's seam list names `slow-trigger.ts -> delivery/turn.ts`.

## Type changes (all additive)

- `SlowPolicy.trigger: SlowTrigger`, `SlowPolicy.quietMs: number`; new `SlowTrigger = "continuous" | "idle"` (`types/policy.ts`). `DEFAULT_POLICY.slow` gains both.
- `SlowTierState.pausesOnly?: true` (`types/status.ts`) and `SlowPolicyView.pausesOnly: boolean` (`state/slow.ts`), by the coordinator's agreement (reply to request `1f28922b`), in their own commit `c4ac97ee`.
- `PendingReason`'s `slow` kind gains `pausesOnly?: true` (`cli/named-files.ts`).
- `Coverage.slow.pausesOnly?: boolean` (`harness/shared/coverage.ts`).

## Outside the brief's file list

All are additive or text-only, and no sibling owns them (004-82 owns `queue.ts`, `ledger.ts`, `src/core/slow/rank*.ts`, `main.ts` `why`; 005-70 owns `src/cli/setup/**`):

- `src/core/types/status.ts`, `src/core/state/slow.ts`: agreed with the coordinator (commit `c4ac97ee`).
- `src/cli/status-wait-lines.ts`: the coordinator's condition on the quiet line (below).
- `src/cli/named-file-lines.ts`: the queued-slow reason text, part of the path wait's output.
- `src/harness/shared/coverage.ts`: the field the primer reads.
- `plugins/*/skills/squeal/references/{policy,commands,reports}.md`: the user-facing key table and texts. **004-82 will add `slow.rank` to the same `policy.md` table**, a one-line merge at the join.
- `src/core/keys/key-format.ts`, `test/keys/key-format.test.ts`: the re-pin and the seam's new file name.

## Decisions the brief or spec did not settle

1. **The brief's "quiet line holds for it"** (resolved with the coordinator, 2026-10-19). The plain `status --wait` keeps D8 and D9 as written and does not hold for slow files. Only the path wait changes. The coordinator's condition: under `"continuous"` the quiet return's 004-71 clause says the pending slow files run after the fast tests, tested under each trigger (`test/cli/status-wait-slow-policy.test.ts`). Under `"idle"` the clause is 004-71's verbatim, which claims nothing about when they run.
2. **Idle-semantics tests pin `slow.trigger: "idle"`** instead of being rewritten: the 16 tests in 9 files that failed once the default changed (`47b64b6c`), `slow-off-line`'s 2 (`66bb2f05`), and `status-wait-paths-slow`'s fixture, whose default trigger is now `"idle"` (`69fe76f9`). They test the idle trigger, its nudge, its activity, the lane mechanics behind a turn and the exit drain, so "idle keeps today's tests green" holds literally. The text tests (status line, named reason, quiet clause, primer, skill) now assert the continuous default and gain an `"idle"` case each.
3. **No new wait reason** for the quiet window (see What changed).
4. **The primer's second slow sentence is unchanged** ("A slow failure wakes you when you are idle…; otherwise it arrives with your next prompt or tool call"): it is true under both triggers.
5. **Spec D7 says `slow.quietMs` 5000 "to be set by the code row's measurement"**: the measurement sets 3000. The spec and `status.md` line are the coordinator's to amend.

## Measurements: `slow.quietMs` and the browser `globalSetup` cost

Host: 24 CPUs. Load is the one-minute average from `sar -q` (10-minute samples) for stored runs, `/proc/loadavg` for live ones. "Calm" is a load below 12 (0.5 per CPU); "loaded" is above 24 (1 per CPU).

### What the quiet window buys: gaps between edits

The window only helps when a later edit would land while the slow file runs and discard its result (D4). The data is the gaps between consecutive `watch` revisions of one worktree, under 10 minutes apart, from copies of two real Squeal stores, read-only: this repository's (`.git/squeal/store.sqlite`, 1,117 gaps) and cezarion's (464 gaps). For a window `q` and a slow run of `d` seconds, the table gives the share of runs a later edit discards: of the gaps that outlast `q`, those that end before `q + d`.

| window `q` | 0 s | 2 s | 3 s | 5 s | 8 s | 10 s | 15 s | 30 s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| squeal, `d` 12 s | 40% | 24% | 23% | 25% | 26% | 27% | 24% | 18% |
| squeal, `d` 17 s | 47% | 33% | 33% | 35% | 33% | 32% | 31% | 24% |
| cezarion, `d` 12 s | 31% | 29% | 32% | 30% | 31% | 29% | 25% | 22% |
| cezarion, `d` 17 s | 41% | 39% | 39% | 39% | 39% | 36% | 33% | 26% |

Gaps under 1 s, 2 s, 3 s and 5 s: squeal 18.7%, 24.0%, 26.9% and 29.1%; cezarion 8.2%, 9.5%, 10.6% and 15.1%. The medians are 19.3 s and 23.5 s.

Reading: the window pays only for the sub-3-second bursts (multi-file saves, formatters): this repository's discard rate falls from 40% to 23% between 0 and 3 s. From 3 s to 15 s it is flat within 1 to 3 points, while every slow result arrives that much later. The knee is 2 to 3 s; 3 s also catches the 2 to 3 s band (2.9 points of gaps here).

### The eval fixture (`evals/ledgerline`, `test/slow/ledger.test.ts`, a 12 s sleep)

No `globalSetup`: its setup cost is 0 by construction.

- Bare run in a copy, `nice -n 10 ionice -c 3`, `--maxWorkers=2`, load 7.4 to 7.7 (0.31 per CPU), 3 runs: 12,453 to 12,478 ms wall, 12.18 to 12.19 s in Vitest.
- Edit to slow result through the real scheduler, continuous trigger, consumer in a turn: a copy of the fixture with a temporary test that is not committed (its script is in the next section). Load 2.3 to 3.5 (calm), two edits per window:

| `quietMs` | fast tier done | slow file starts | slow result |
| --- | --- | --- | --- |
| 0 | +0.29 to +0.34 s | +0.29 to +0.35 s | +12.44 to +12.53 s |
| 3000 | +0.28 to +0.32 s | +3.01 s | +15.15 to +15.19 s |
| 5000 | +0.32 to +0.34 s | +5.00 to +5.01 s | +17.17 to +17.18 s |

The timer starts the file within 10 to 22 ms of the window's end, and the result lands at `quietMs` + 12.15 s. With 3000, the eval cells' slow result arrives about 15.2 s after the edit, not 17.5 s (`006-model-evals/research/slow-tier-tasks-0219.md` 2), still after Luna's ~5 s claim.

At a second load, the same measurement out of the tree (`/tmp/004-80/scripts/vitest.measure.config.mjs`, so no revision of this worktree). It was armed to start once the one-minute load passed 24; load fell while it ran, to 10.96 to 19.36 at the edits (0.46 to 0.81 per CPU), so this is a moderate load, not above 1 per CPU. cezarion's stored runs below cover that.

| `quietMs` | load at the edit | fast tier done | slow file starts | slow result |
| --- | --- | --- | --- | --- |
| 0 | 19.36, 16.29 | +0.35, +0.43 s | +0.36, +0.45 s | +12.52, +12.66 s |
| 3000 | 13.70, 12.30 | +0.42, +0.32 s | +3.01, +3.01 s | +15.16, +15.14 s |
| 5000 | 11.15, 10.96 | +0.38, +0.31 s | +5.00, +5.01 s | +17.15, +17.17 s |

On this fixture load moves the fast tier by about 0.1 s and leaves the slow result at `quietMs` + 12.15 s: its slow file is a sleep, so the window, not the host, sets when the agent sees it.

### cezarion's browser specs (`packages/web/e2e/*.e2e.ts`)

I did not run them. Their `globalSetup` (`environment.ts`) runs `.ai/scripts/test-env-up.sh`: a `pnpm install`, builds, a server, and agent-browser driving Chrome under `CEZ_HOME`. That is external agent tooling with side effects, which the probe-isolation rule keeps off the real HOME, and a copy under the throwaway user would need its own browser install. They are measured instead from cezarion's own record. These are 1,225 completed browser-spec runs in a copy of `/home/agent/projects/cezar/.git/squeal/store.sqlite` and their `report.json` files (2026-10-14 to 2026-10-18), joined with `sar` load at each run's start. All ran under today's idle trigger, one file per tier (`slow.maxParallel` 1).

Setup overhead = run wall time minus the sum of its tests' durations: Vitest's collect, the browser start and, for the first file of a slow Vitest instance, `globalSetup`.

| | calm (n, load p50 6) | loaded (n, load p50 67) |
| --- | --- | --- |
| run wall p50 / p90 | 10.0 / 32.4 s (723) | 17.3 / 93.1 s (190) |
| in-file p50 / p90 | 6.7 / 29.1 s | 12.0 / 81.8 s |
| overhead, back to back p50 / p90 | 2.1 / 4.7 s (608) | 4.0 / 11.2 s (167) |
| overhead, first of a pass p50 / p90 | 3.0 / 8.3 s (115) | 3.9 / 19.9 s (23) |
| first of a pass, build inputs unchanged since the last pass, p50 / p90 | 2.8 / 6.8 s (108) | 2.7 / 11.8 s (19) |
| first of a pass, build inputs changed (a rebuild), p50 / p90 / max | 7.9 / 17.8 / 17.8 s (7) | 19.9 / 34.4 / 34.4 s (4) |

"First of a pass" is a run with no browser run in its worktree in the 30 s before. "Build inputs" are `test-env-up.sh`'s `BUILD_INPUT_PATHS`, matched against the paths the revisions since the worktree's previous pass changed.

The `globalSetup` cost, recorded:

- With the bundle's fingerprint unchanged (a cache hit), about 1 s at calm load (first of a pass minus back to back, p50: 3.0 − 2.1 s). At load it is lost in the noise (n = 23).
- After a change to the bundle's sources it rebuilds: about 5 s above a cache hit at calm load and about 17 s at load (p50; n = 7 and 4, so unconfirmed).

Under a continuous lane every pass after a web-source edit pays that rebuild, and a further edit during it discards the run (the cezarion rows of the gaps table: 30 to 39% at any window from 2 to 10 s). Whether cezarion keeps `"continuous"` or sets `"idle"` is its call (amendment, "This repository"); this data is what it asked for. No window in the 2 to 10 s range changes cezarion's discard rate.

### The default

`slow.quietMs` default **3000**: the knee of both repositories' gap distributions. A longer window lowers the discard rate by at most 1 to 3 points up to 15 s and delays every slow result by its length; a shorter one lets the sub-3-second bursts discard runs (squeal: 40% at 0 s).

### Scripts (read-only, outside the worktree, not committed)

`/tmp/004-80/scripts/`:
- `analyse.mjs` and `rebuild.mjs`: browser runs by load, first of a pass, and build-input changes;
- `gaps.mjs`: the gaps between edits;
- `measure.test.ts` with `vitest.measure.config.mjs`: the ledgerline edit-to-result timing.

The stores were copied to `/tmp/004-80/` before reading. The measurement test also ran once inside the worktree, so Squeal's daemon ran it beside the manual run; that is the duplicate rows in the calm data, all within the ranges above.

## Checks

- Red first: `test/scheduler/slow-continuous.test.ts` against the old predicate (forced to `consumersIdle`): 2 of 3 failed (the start at `quietMs` mid-turn, and the delivery at the next tool call); green after. The path wait's two continuous cases failed before `pauseOnlyIds` changed (`outcome` `slow`, `waitedMs` 161).
- `npm run lint` at `f67f9f07`: `Checked 1441 files in 373ms. No fixes applied.`
- `npm run typecheck`: clean (exit 0) at `f67f9f07`.
- Not run: `npm run build` (the brief: the coordinator builds at integration). So the four bundle checks fail on `cli/squeal.mjs`, because the committed `dist` predates this row's `src` changes:
  - `test/harness/plugin.test.ts`;
  - `test/harness/codex/plugin.test.ts`;
  - `test/harness/pi/package.test.ts`;
  - `test/harness/opencode/package.test.ts`.

- `test/types.test.ts` and `test/policy/slow.test.ts` asserted the whole default `slow` object. The full checkpoint caught them, and both are fixed (`fd60ac29`, `f67f9f07`).
- **Full suite, `squeal run --all --wait 600000`** (Squeal 0.1.199), at revision 46, HEAD `f67f9f07`: verdict, exit 1 with 6 known failures:
  - The four bundle-drift checks: expected, since this row runs no build.
  - `test/runners/vitest/observe-fidelity.test.ts` and `test/runners/node-test/run-reads-fidelity.test.ts`: **not this row**. Both fail under Squeal in every recorded run since 2026-10-17, in worktrees 6a627ff7 and 9e2c5309 at older commits (`squeal why`: 0 passes of 18 results). A `squeal retry --reason load` failed again. Both pass under plain `npx vitest run` (5 of 5, run alone at load 12): they fail under Squeal's run, not under load.
  - Earlier checkpoints at revisions 42 and 43 ended without a verdict: an edit landed mid-run, and the revision-43 wait joined the 42 checkpoint.

```
Checkpoint c7b43b10-75e1-4575-93ec-bff265b794f4 completed at revision 46: 6 known failures: 6 tests; 724 test files, 724 already current, 0 run now
Checkpoint c7b43b10-75e1-4575-93ec-bff265b794f4 started at revision 46: 0 test files to run, 724 already current

Revision: 46 · fd60ac29 + 2, dirty
Known failures: 6 (6 tests)
  FAIL  test/harness/codex/plugin.test.ts > committed Codex plugin > has the bundles exactly as `npm run build:plugin` produces them
        cli/squeal.mjs differs from the build: expected false to be true // Object.is equality; diff (- Expected, + Received): - true | + false
        at test/harness/bundle-helpers.ts:122:52, observed at revision 43, current
        recorded 16 min ago in this worktree at revision 43, load 0.78 per CPU when it ran; no retry asked at these inputs
  FAIL  test/harness/opencode/package.test.ts > the OpenCode package > has the bundles exactly as `npm run build:plugin` produces them
        cli/squeal.mjs differs from the build: expected false to be true // Object.is equality; diff (- Expected, + Received): - true | + false
        at test/harness/bundle-helpers.ts:122:52, observed at revision 43, current
        recorded 15 min ago in this worktree at revision 43, load 0.60 per CPU when it ran; no retry asked at these inputs
  FAIL  test/harness/pi/package.test.ts > the Pi package > has the bundles exactly as `npm run build:plugin` produces them
        cli/squeal.mjs differs from the build: expected false to be true // Object.is equality; diff (- Expected, + Received): - true | + false
        at test/harness/bundle-helpers.ts:122:52, observed at revision 43, current
        recorded 15 min ago in this worktree at revision 43, load 0.60 per CPU when it ran; no retry asked at these inputs
  FAIL  test/harness/plugin.test.ts > bundles > are committed exactly as `npm run build` produces them
        cli/squeal.mjs differs from the build: expected false to be true // Object.is equality; diff (- Expected, + Received): - true | + false
        at test/harness/bundle-helpers.ts:122:52, observed at revision 43, current
        recorded 15 min ago in this worktree at revision 43, load 0.60 per CPU when it ran; no retry asked at these inputs
  FAIL  test/runners/node-test/run-reads-fidelity.test.ts > a node:test warm-up's recorder a test cannot tell is there (task 001-390) > names the recorder in a failure with its signature while it is in NODE_OPTIONS
        expected [ [ 'fail', undefined ] ] to deeply equal [ [ 'pass', undefined ] ]; diff (- Expected, + Received): - "pass", | + "fail",
        at test/runners/node-test/run-reads-fidelity.test.ts:116:30, observed at revision 44, current
        recorded 8 min ago in this worktree at revision 44, load 0.81 per CPU when it ran; retry asked (load) at these inputs: it failed again
  FAIL  test/runners/vitest/observe-fidelity.test.ts > vitest adapter: a recorder a test cannot tell is there (task 001-390) > names the recorder in a failure with its signature, and only under it
        expected [ [ 'fail', undefined, false ], …(1) ] to deeply equal [ [ 'pass', undefined, false ], …(1) ]; diff (- Expected, + Received): - "pass", | + "fail",
        at test/runners/vitest/observe-fidelity.test.ts:119:37, observed at revision 44, current
        recorded 8 min ago in this worktree at revision 44, load 0.81 per CPU when it ran; retry asked (load) at these inputs: it failed again
Affected checks: 6918 passed (6194 tests, 724 test files loaded), 0 running, 0 queued, 9 skipped (9 tests)
Full-suite checkpoint: completed at revision 46

Worktree: /home/agent/projects/squeal/.ai/cezar/worktrees/6470300b-f0b5-4d73-a063-74bb2bcebcf9 (HEAD fd60ac2, dirty at revision 46)
Daemon: running, last heartbeat 4 s ago
Inherited from other worktrees: 1279 current results (1201 tests, 78 test files loaded)
  578 (552 tests, 26 test files loaded) from /home/agent/projects/squeal/.ai/cezar/worktrees/4dd0c8d9-55df-4ebc-9732-3ee1aedc5871 at ad5dd72
  351 (333 tests, 18 test files loaded) from /home/agent/projects/squeal/.ai/cezar/worktrees/4dd0c8d9-55df-4ebc-9732-3ee1aedc5871 at 987fe35
  146 (132 tests, 14 test files loaded) from be171a62dbbccf00 at 65ae6c0
  81 (76 tests, 5 test files loaded) from /home/agent/projects/squeal/.ai/cezar/worktrees/9920d411-dada-4cc9-81ac-b69351bef57d at ef26bc5
  75 (65 tests, 10 test files loaded) from /home/agent/projects/squeal/.ai/cezar/worktrees/4dd0c8d9-55df-4ebc-9732-3ee1aedc5871 at 7e9ddde
  48 (43 tests, 5 test files loaded) from /home/agent/projects/squeal/.ai/cezar/worktrees/9920d411-dada-4cc9-81ac-b69351bef57d at ad5dd72
Closure method: static imports plus declared inputs
Store schema: 1
Notes:
  2026-10-19T06:17:22.831Z: squeal.config.json: unknown key "vitest.exclude"; the defaults apply in their place
  2026-10-19T06:17:23.923Z, revision 0: no dependencies are installed in this worktree, so Squeal runs none of its tests and inherits none of their results. Run `npm ci` to install them: Squeal then inherits the results other worktrees recorded for the same code and dependencies, and runs the rest
  stopped 26 processes a test left running after its tier, in 7 notes since 2026-10-19T06:23:01.864Z: 8 × /usr/bin/git -c safe.bareRepository=explicit ls-remote https://github.com/openai/plugins.git HEAD; 8 × /usr/lib/git-core/git remote-https https://github.com/openai/plugins.git https://github.com/openai/plugins.git; 7 × /usr/lib/git-core/git-remote-https https://github.com/openai/plugins.git https://github.com/openai/plugins.git; 3 × /home/agent/.nvm/versions/node/v24.21.0/bin/node --experimental-import-meta-resolve --require /home/agent/projects/sq... (`squeal status --notes` lists each)
exit 1
```

## For the coordinator and the next worker

- **The integration build** regenerates every `plugins/*/dist`; the bundle-drift tests are this row's expected known failures until then.
- **The 004-82 join**:
  - `types/policy.ts`: 004-80's block is the last two `SlowPolicy` fields plus `SlowTrigger`.
  - `daemon/policy.ts`: the two `slow` shape keys under their comment.
  - `DEFAULT_POLICY.slow` gains `trigger` and `quietMs`; `test/daemon/policy.test.ts`'s expected defaults name them, so 004-82's `rank` goes into the same literal.
  - `policy.md`'s table (all three copies).
  - `KEY_FORMAT_VERSION` 13 needs one more in-place re-pin after the join.
- **Spec**: D7's "`slow.quietMs` (5000, …)" becomes 3000 from these notes. The eval research estimate of ~17.5 s from edit to slow result becomes ~15.2 s on the fixture at calm load.
- **Confirm eval** (a2, a3, a8, a11): under the continuous default a path wait on the fixture's slow file now holds about 15 s and returns its verdict. The plain wait still returns on quiet, now saying "Squeal runs it after the fast tests". `evals/lib` does not parse either ending (checked: no match for "pauses" or "after the fast" there).
- **D9**: no change was needed in `stop.ts` or `stop-slow.ts`. The waiting Stop entry already waits for the tier to settle, and under a continuous lane the tier is usually already running at Stop.

## Commits (base `ad5dd720`)

- `d48a96ef` feat(004-80): slow.trigger continuous by default; a slow file starts slow.quietMs after the revision, mid-turn
- `47b64b6c` test(004-80): idle-trigger tests pin slow.trigger "idle", so today's behaviour stays covered
- `69fe76f9` feat(004-80): a path wait holds for a queued slow file under slow.trigger continuous; idle leaves it out as 004-78
- `c4ac97ee` feat(004-80): SlowTierState.pausesOnly and SlowPolicyView.pausesOnly from slow.trigger "idle"
- `66bb2f05` feat(004-80): D8 wording per slow.trigger: "after the fast tests" by default, "when the agent pauses" under idle
- `b587d56e` feat(004-80): the primer says slow files run after the fast tests, or when you pause under slow.trigger idle
- `933c35b1` chore(004-80): re-pin KEY_FORMAT_VERSION 13 in place; the turn seam moved to slow-trigger.ts
- `4ce172aa` feat(004-80): slow.quietMs defaults to 3000 from the measurement; README and skill references name slow.trigger and slow.quietMs
- `dbef5c7f` test(004-80): the fold-reach cases are a const tuple, so typecheck passes
- `fd60ac29` test(004-80): the slow policy test names slow.trigger and slow.quietMs
- `f67f9f07` test(004-80): the core types test names slow.trigger and slow.quietMs in the defaults
