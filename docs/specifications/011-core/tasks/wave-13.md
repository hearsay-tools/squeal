# Wave 13 of spec 011

Three rows the human approved on 2026-10-22 (digest `triage/2026-10-22-digest.md`), now free since 011-32, 011-34 and 005-75 shipped in 0.1.261. Their seams are disjoint, so they run in parallel from main with 0.1.261. 005-77 is a spec 005 row; its brief is here so that the wave has one file.

## W1: 011-66 and 011-106, a tier the daemon cannot finish is re-queued, never stored

Use /worker. Shape: slice, one commit per row, 011-66 first.

Outcome: a tier that crashes while its daemon stops, or whose daemon's own runtime is gone, leaves its files queued and stores no FAIL or UNKNOWN for them.

Read board rows 011-66 and 011-106, `research/issue-50.md` (Recommendation), `research/issue-72.md` with `research/probes/issue-72/probe.sh`, the digest's group A, and spec 011 C4, C5, C9 and C11.

Seam: the crash path in `src/core/scheduler/tiers.ts` (`end: "crashed"` and `ledger.markUnknown` near line 744), the install re-queue in `src/core/scheduler/install.ts`, and the daemon's tier start and `#shutdown("reinstalled")` in `src/core/daemon/daemon.ts`. A lead: write 011-106's three probe-shaped tests first.

Owns: those files, `src/core/scheduler/ledger.ts`, their tests, notes under `tasks/011-66/` and `tasks/011-106/`. Not yours: `src/core/delivery/` (W2), `src/harness/` and `src/cli/start.ts` (W3), `src/core/scheduler/yields.ts` and the 011-99 test files, the board, spec text, bundles, version.

Done when: both rows' done-when hold; `test/keys/key-format.test.ts` passes; lint, typecheck and `squeal run --all --wait` pass, their output in your summary. Answer gh-72's open question in the notes: why the restart re-ran the two false FAILs.

## W2: 011-109, a regression notice groups checks with one error and location

Use /worker. Shape: slice.

Outcome: 91 failing checks with one first error and location read as one block with their count and one `squeal failures` command, in every harness's notice and deny reason.

Read board row 011-109, `002-codex-adapter/research/issue-71.md`, the digest's group D, spec 011 C5, and the evals parsers under `evals/lib/` that read `formatDelta`'s text.

Seam: `formatDelta` in `src/core/delivery/format.ts:244`. A lead: a test with 91 checks that share one error first.

Owns: `src/core/delivery/format.ts`, its tests, the evals parsers that read its blocks and their tests, notes under `tasks/011-109/`. Not yours: `src/harness/shared/deny.ts` (the deny-once contract is unchanged), W1's and W3's files, the board, spec text, bundles, version.

Done when: the row's done-when holds, the parsers round-trip the grouped block through the real `formatDelta`, in plain text and hook JSON; lint, typecheck and `squeal run --all --wait` pass, their output in your summary.

## W3: 005-77, a daemon the CLI spawns from the plugin cache runs from a kept copy

Use /worker. Shape: slice.

Outcome: `squeal start` run from a plugin cache path spawns a daemon whose command line names the kept copy of its version, as a SessionStart daemon does under Codex since 005-73.

Read board rows 005-77 and 005-73, `005-agent-adoption/tasks/005-73-notes.md` ("Open after this row"), and spec 005 D3.

Seam: `keepVersion` in `src/harness/shared/version-copies.ts:86`, called today only from `src/harness/codex/kept.ts:38`, and the spawn in `src/cli/start.ts:50`. A lead: a test that runs `start` from a cache path first.

Owns: `src/harness/shared/version-copies.ts`, `src/cli/start.ts`'s spawn, `src/core/daemon/ensure.ts`'s `daemonCliEntry` if the copy is chosen there, their tests, notes under `005-agent-adoption/tasks/005-77/`. Not yours: the launcher, W1's and W2's files, the board, spec text, bundles, version. No `npm run build`.

Done when: the row's done-when holds; a SessionStart spawn is unchanged; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

W3 also takes 011-110 as its last commit (steered 2026-10-22 after main CI 39755680012): `finishHandoff` in `src/cli/start.ts:123` spawns with no lock wait when it joined a live claim with the lock free; with the lock wait only when it claimed. W3 may edit `start.ts`'s `finishHandoff`, `test/daemon/start-handoff.test.ts` and `test/daemon/handover-tier.test.ts` for it.

## R1: review of cand/0.1.262

Use /reviewer. Shape: review. Pinned to the `cand/0.1.262` SHA named in the spawn; the range is `origin/main..<sha>`: W1 (011-66, 011-106, three commits from `cez/829153ea`), W2 (011-109, four from `cez/6bc5552e`), W3 (005-77, three, and 011-110, one, from `cez/323b4ae4`), one docs commit (spec 011 C5, C9, C11, spec 005 D3 and both `status.md` files) and the release commit (0.1.262, bundles).

Read W1 to W3 above, the notes under `tasks/011-66/`, `tasks/011-106/`, `tasks/011-109/` and `005-agent-adoption/tasks/005-77/`, board rows 011-66, 011-106, 011-109, 011-110 and 005-77, and the amended spec sentences. Check that:
- 011-66: a tier that crashes after its daemon's stop began leaves its uncompleted files queued, once per file and key; a second such crash is UNKNOWN; a crash outside the stopping phase and a stop's own cancel are unchanged;
- 011-106: a missing runtime directory starts no tier, leaves the files queued, persists one note naming `squeal start` and exits as `reinstalled`; a tier during which it went stores nothing; no missing recorder is stored as a FAIL;
- 011-109: checks with one error and location give one block with their count and a `squeal failures` command that lists each; mixed errors stay apart; `failures` and `why` keep every check's evidence; the evals parsers round-trip the block through the real `formatDelta`; the deny-once contract is unchanged;
- 005-77 and 011-110: `start` from Codex's cache spawns from the kept copy, other paths and SessionStart unchanged; a joined `start` with the lock free spawns with no lock wait, a claiming one with it;
- `test/keys/key-format.test.ts` passes with `KEY_FORMAT_VERSION` unchanged; the version is raised in all eight places; the bundles match the tree; the four launchers are byte-identical.

Run `npm ci`, then `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once in the candidate tree. Row 011-99 lists the known load-flaky files. Write `reviews/0.1.262.md` with a PASS or FAIL verdict and commit it.

## Wave 13.5: repair of review 0.1.262

Both start from `8e28e960e` (the candidate dfc218b26 plus `reviews/0.1.262.md`). Their seams are disjoint; they run in parallel.

### W4: B1, the group's command lists every member

Use /worker. Shape: repair.

Outcome: the one `squeal failures` command a group prints lists each of its checks, also when the same files or directory hold other, newer failures.

Read `reviews/0.1.262.md` B1 and its Inputs, W2 above, `tasks/011-109/notes.md`, and the amended C5 sentence.

Seam: the command at `src/core/delivery/failure-groups.ts:105-111`, and what `squeal failures` can select (`src/core/status/failures.ts:98`, `src/core/store/repos/failures.ts:66`). A lead: write the review's probe as a real-CLI test first, with 25 newer other failures and repeated historical rows in the same directory.

Owns: `src/core/delivery/failure-groups.ts`, `src/core/delivery/format.ts`, the `failures` CLI and `src/core/status/failures.ts` if the selection must grow, their tests, the evals parsers if the block's text changes, `tasks/011-109/notes.md`. Not yours: `src/core/scheduler/` (W5), the board, spec text, bundles, version. No `npm run build`.

Done when: the probe's test lists all 91; one command and the notice cap stay; `failures`, `why` and the parser round trip hold; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

### W5: B2 and B3, a tier without its runtime stores nothing and never starts

Use /worker. Shape: repair, one commit per blocker.

Outcome: a runtime-lost tier's startup failure is rejected with its results, and no slow tier starts after its runtime went during the load wait.

Read `reviews/0.1.262.md` B2, B3 and Inputs (the order it gives), W1 above, `tasks/011-106/notes.md` and `tasks/011-66/notes.md`, spec 011 C9 and C11 as amended.

Seam: B2 at `src/core/scheduler/scheduler.ts:883` into `recordTier` (`tiers.ts:735`) and `failStartup` (`setup.ts:81`); B3 at `scheduler.ts:696-727` and `slow-tier.ts:208`. A lead: the review's two probes as failing tests first.

Owns: `src/core/scheduler/scheduler.ts`, `tiers.ts`, `setup.ts`, `slow-tier.ts`, `interrupted.ts`, their tests, `test/daemon/runtime-gone.test.ts`, the two notes. Not yours: `src/core/delivery/` (W4), `test/scheduler/backlog-slots-overhead.test.ts` and the other 011-99 files, the board, spec text, bundles, version. No `npm run build`.

Done when: both probes' tests pass with a second queued file in the project; a rejected slow selection holds no slot, lease or claim; normal setup failures and slot fairness are unchanged; `test/keys/key-format.test.ts` passes; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

### R2: narrow re-review of cand/0.1.262 after the repair

Use /reviewer. Shape: review, narrow, the last round. R1 failed `cand/0.1.262` at dfc218b26 (`reviews/0.1.262.md`, B1 to B3). The coordinator re-cut it at c30f5181a on main 42e87532b (docs only since 60fb71694): the same twelve commits (W1 to W3 and the docs commit), W4's two, W5's two, one docs commit (C5, C6, `status.md`), then the release commit (0.1.262, bundles and skill copies).

Check only:
- `git range-diff 60fb71694..14aac727f 42e87532b..53ff37bd6` shows the twelve commits unchanged but for their cherry-pick lines;
- B1 to B3 hold as the review's expected behaviour says, by W4's and W5's tests and your own probes; the order the review's Inputs gives holds;
- the new `squeal failures` options (`--error`, `--per-check`, `--limit all`, and `--all-worktrees` on an inherited group's line) match the amended C5 and C6, their help text and the skill's `commands.md`, and keep `--json` additive;
- `test/keys/key-format.test.ts` passes with `KEY_FORMAT_VERSION` unchanged; the version is 0.1.262 in all eight places; the build leaves the tree clean; the four launchers are byte-identical.

Run `npm ci`, then the test files W4 and W5 changed or added, directly. The full suite is CI on c30f5181a and the coordinator's locked gate (`.ai/cezar/t/04a258b0/logs/gate-0.1.262b.log`); the pre-repair gate on dfc218b26 passed 888 files. Read both by test name. Write `reviews/0.1.262-r2.md` with a PASS or FAIL verdict on c30f5181a and commit it alone.

### W6: 011-110, the second source of a second successor

Use /worker. Shape: repair. Baseline the candidate `c30f5181a` (cand/0.1.262); it lands after 0.1.262.

Outcome: `squeal start` never spawns a lock-waiting daemon beside the successor the hooks claimed, and `test/daemon/handover-tier.test.ts:161` counts one successor on CI.

Read board row 011-110, `tasks/011-34/notes.md`, `tasks/011-32/notes.md`, spec 011 C9 on `start` during a handoff. Evidence: CI 39769624080 (Node 22 1/3) on c30f5181a, with 011-110's first fix in, still counted two `--await-lock` daemons; `lockWaits` at line 160 was 1, so the hooks spawned one and `start` the other.

Seam: `claims()` in `src/cli/start.ts:169` and its caller `finishHandoff` (line 123). The coordinator's hypothesis, unverified: `finishHandoff` passes the record read when `start` began (`stopping.record`); if the successor registered meanwhile and cleared the claim, `claims()` finds no live claim for the old incarnation, writes a new one and spawns with the lock wait. A lead: prove or refute it first with a test that registers a successor between that read and `claims()`. If the second daemon has another source, find it by its parent process.

Owns: `src/cli/start.ts`, `test/daemon/start-handoff.test.ts`, `test/daemon/handover-tier.test.ts`, `tasks/011-110/notes.md`. Not yours: the board, spec text, bundles, version. No `npm run build`.

Done when: the new test fails on the baseline and passes; `handover-tier.test.ts` passes 20 runs in a row here (`npx vitest run test/daemon/handover-tier.test.ts --repeat 19` or a loop); lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.
