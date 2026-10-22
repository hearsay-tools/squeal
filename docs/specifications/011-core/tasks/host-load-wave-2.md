# Host-load wave 2: the accepted designs 011-82 and 011-83

The human, 2026-10-21: 011-82 and 011-83 accepted as recommended, after asking how edits stay fast. The answer is the rule for every row here: an edit's own tier never waits, never takes a permit, and is never held by a quiet wait. The spec text is in 011 C4 step 5, C4's checkpoint paragraph, C6, C10 and 013 V7 (`status.md`, 2026-10-21). Wave 1 (`host-load-wave-1.md`) runs beside this one: W3 (011-91 to 011-93) changes `scheduler.ts`, `ledger.ts`, `slow-tier.ts`, `lifecycle.ts` and `daemon.ts`; W1 and W2 change `src/core/keys/` and `src/runners/vitest/project.ts`.

Every worker: tests first, red before green. Your full-suite verdict is `squeal run --all --wait`; `npx vitest run --maxWorkers=4` only when Squeal is unavailable, and say so. A file that fails under load and passes alone is named in your summary. Run `npm ci` first. No build, no bundles, no version raise, no spec text, no board. Done when your rows' tests are red before and green after, and `npm run lint`, `npm run typecheck` and `squeal run --all --wait` pass, their output in your summary.

## W4: 011-94, the quiet wait after a cancel

Use /worker. Shape: slice. Read `tasks/011-82/design.md` sections 1.1, 2.3 and 7 (row A), C4 step 5 and C6 as amended.

Seam: `selectTier` in `src/core/scheduler/tiers.ts`. First edit, a lead: the new `src/core/scheduler/quiet.ts` (`BacklogQuiet`, `BACKLOG_QUIET_MS`) and a unit test that `selectTier` with a waiting lane and only backlog files queued starts nothing; then that an edit's file queued is taken. The backlog cancel is `cancelsBacklog` in `backlog.ts` and `yields.ts` (the design's defect note).

Owns: row A's files in section 7. In `scheduler.ts` only the pump's wake and `run --all`'s call: W3 edits other methods of that file, so keep your hunks small. Not yours: `src/runners/`, `src/core/capacity/`, `src/core/daemon/`, `ledger.ts`, `slow-tier.ts`.

## W5: 011-95, the related walk loads only listed files

Use /worker. Shape: slice. Read `tasks/011-82/design.md` sections 1.5, 2.6 and 7 (row B), 013 V7 as amended.

Seam: `relatedSpecifications` in `src/runners/vitest/related.ts`. First edit, a lead: the fixture whose `squeal.config.json` excludes `e2e/**` while Vitest includes `e2e/x.test.ts`, and row B's test 1, red on main.

Owns: `src/runners/vitest/related.ts`, `affected.ts`, their tests. Not yours: `project.ts` and `environment.ts` (wave 1), `moved.ts`, `sources.ts`, `touched.ts`, `src/core/`.

## W6: 011-96, 011-97, 011-98, the CPU cap (not dispatched yet)

Starts after 011-93 and 011-94 land (`slow-tier.ts`, `tiers.ts`), and 011-98 after 014-21 lands, whose `src/core/ps/` tree arithmetic (`cutime`, `cstime`) 011-98's `cores.ts` reuses. Read `tasks/011-83/design.md` sections 1, 2, 3.3 and 7, C10 as amended. Rows in order, one commit each, as section 7 names their seams, owned files and red-first tests. Check 011-97's risk first: Vitest's sequential group for an isolated project at `maxWorkers` 1 against `tierPart`.

## R1: review of cand/0.1.253

Use /reviewer. Shape: review. Pinned to the `cand/0.1.253` SHA named in the spawn; the range is `origin/main..<sha>` on base `0fdccf30a` (0.1.252): 011-87 to 011-90 (design 011-85), 011-91 to 011-93 (design 011-84), 011-94 and 011-95 (design 011-82), RP1's three test commits (below), and the release commit (0.1.253, bundles). The candidate was first cut as cand/0.1.251; 0.1.252 landed before it by agreement. The candidate predates this brief: read it from main.

Read the three designs' decisions and code rows, spec 011 C3, C4, C6, C7, C9, C11 and C14, 004 D2 and 013 V7 as amended 2026-10-21, the `status.md` lines of 2026-10-21 and 10-22, `tasks/011-91/notes.md`, and the board rows. Check that:
- 011-87 and 011-89: a root or workspace version raise keeps the fingerprint; an upgrade, a new workspace, a moved link and a stale install still move it; only a linked dependency's `specifier` leaves pnpm's input;
- 011-88: a sibling's config moves no project's key; the root config and a shared import move each project that reads them;
- 011-90: the former-definition read can never accept a row whose inputs differ from the file's current ones in a way the former key does not encode; no former entry where the inputs match; another install's former key is not read; a set is copied only where no row is stored; a format raise ends the read. Name the case if you find a hole;
- the release re-keys no check: a pass stored by 0.1.249 is found at the first lookup; the key-format alarm passes at format 20 with no raise;
- 011-91 to 011-93: only a start after a rest queues its start revision's reach under `lookup-only`; a drain runs its session's work and leaves the backlog queued; a draining daemon takes no slow permit while another worktree's mark is fresh; under `daemon.unusedExitMinutes` the backlog is no use, and an edit, a wait, `run --all` and `run --slow` are;
- 011-94: an edit's own tier never waits; the wait follows only a backlog cancel; `run --all` ends it; status names it; the accepted deviation (a pull's cancel starts a wait, `status.md` 2026-10-22) is as stated;
- 011-95: the walk loads only listed files, and a computed `import()` still withholds every file of the run;
- RP1: each of its three commits changes only test timing, never a bound, and each test still fails with its row's behaviour turned off (the commit messages name the check); the three tests that move their clock past the quiet wait still assert that no backlog tier starts inside it;
- the version is raised in all eight places and the bundles match the tree.

Run `npm ci`, then `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once in the candidate tree. Known load-sensitive files: `opencode-dispose.test.ts` (008-38), `slow-slot-fair.test.ts`, `vacant-wait.test.ts`, `node-test/graph-cost.test.ts`, and `backlog-slots-overhead.test.ts` test 3, which fails alone on main 0.1.252 too (local bound 1.2: main 1.25, 1.22, 1.26 and the candidate 1.23, a pass, 1.22, interleaved at load 5 on 24 CPUs, 2026-10-22; CI's bound 1.6 passes; row 011-99); a file that fails loaded and passes alone is named. The coordinator's flock'd full run on 517967658 had that one failure only (1.203 against 1.20; 864 files passed); CI 39704040348 is green. Write `reviews/0.1.253.md` with a PASS or FAIL verdict and commit it.

## RP1: repair of cand/0.1.251, three Node 22 CI failures

Use /worker. Shape: repair. Base: `cand/0.1.251` at `3ec1999dc` (main `08cb64a51` with 0.1.250, rows 011-87 to 011-95, the release commit). CI run 39695184172 (the same rows on 0.1.249, Node 22 shard 3/3, 4 vCPUs) failed three tests that main's CI passes; run 39696846845 is the same on this base.

1. `test/scheduler/backlog-quiet-vitest.test.ts` test 8 (011-94, new): timed out at 120 s.
2. `test/scheduler/edit-cut-route.test.ts` test 6, "starts the next edit's node:test tier beside the cut's catch-up slots, with no permit": `expected 0 to be greater than 0`.
3. `test/scheduler/backlog-slots-overhead.test.ts` test 3: 29.4 s against a bound of 25.5 s (also failed once under load in W4's checkpoint).

For each, find whether a row of this candidate causes it (start with 011-94's `selectTier`, the pump's 1 s wake and `yields.ts`, and 011-93's `Ledger.fastQueued`), and prove it: the file on the candidate and with the suspect commit reverted, both alone and on 4 CPUs (`taskset -c 0-3`), with the load beside each. Fix a regression at its cause in the row's code. Make a test deterministic only when the defect is the test's own timing, and never widen a bound to pass a slower product. Commit on your branch, one commit per cause.

Owns: the files of the cause you prove and these three tests. Not yours: the release commit, bundles, version, spec, board. Rules as in this file's header: tests first, `npm ci` first, `squeal run --all --wait` as the verdict, a file that fails under load and passes alone named. Done when each of the three has a named cause, its fix or test commit is red before and green after, and lint, typecheck and `squeal run --all --wait` pass, their output in your final message with the whole report.

## RP2: repair of cand/0.1.253, review B1 (the former read misses a sibling's opacity)

Use /worker. Shape: repair. Base: `f88527eb8` (cand/0.1.253's rows and RP1 without the release commit, plus the coordinator's B2 test fix). Read `reviews/0.1.253.md` B1, `tasks/011-85/design.md` sections 2 (finding 2: a sibling config's builtins make a project's environment opaque), 4 and 8 (R4), and 011 C3's key-format bullet.

Outcome: a pass stored by 0.1.252 is found at 0.1.253's first lookup when a sibling project's config made the stored environment opaque, or a scoped one whole. Under the former definition a project's environment packages were those of every config file (`formerFiles`), so its opacity, its environment input and each file's segment differ from today's.

Seam: `formerReadAsOne` in `src/core/keys/former.ts` and `dependencyKeys` in `src/core/keys/dependencies.ts:46`. First edit, a lead: the Vitest adapter returns the former environment packages beside `formerFiles` (`src/runners/vitest/environment.ts`, `RunnerEnvironment` in `src/core/types/runner.ts`), and `keying.ts` builds the former `DependencyKeys` from them with the former fingerprint. The former segment is then that key set's `of(packages)` per file, not a `whole:` rename: it covers empty, scoped and whole segments both ways. Start from the reviewer's probe as a red test: two file-based projects, B's config imports `node:child_process`, a pass stored under 0.1.252's definition, a hit at the first lookup.

Keep: no former entry where the definitions agree; another install's former key is never read; a set is copied only where none is stored; a format raise ends the read; no key-format raise. Owns: `src/core/keys/former.ts`, `dependencies.ts`, `key-index.ts`'s segment mapping, `src/core/scheduler/keying.ts`'s former hunk, `src/runners/vitest/environment.ts`, the `formerFiles` type, their tests. Not yours: the release commit, bundles, version, spec, board.

Rules as in this file's header. Done when the probe case is red before and green after, the four kept guarantees each have a passing test, and lint, typecheck and `squeal run --all --wait` pass, their output and the whole report in your final message.

## R2: re-review of cand/0.1.253 after RP2

Use /reviewer. Shape: review, the one re-review of this candidate. Pinned to `6a9dff117` (cand/0.1.253 re-cut: main `0fdccf30a`, the rows, RP1, B2's fix `f88527eb8`, RP2's `507e82130`, a new release commit). Read `reviews/0.1.253.md` and this file's RP2.

Check B1 and B2 against their proofs, then the repair's own ground:
- B1: re-run the reviewer's real-adapter probe (two file-based projects, a sibling config importing `node:child_process`, a trusted npm install): the pass stored under 0.1.252's definition is found at the first lookup. Then each kept guarantee: no former entry where the definitions agree; another install's former key is never read; a set is copied only where none is stored; a format raise ends the read; no key-format raise. Look for a new false hit: a former segment that a current file's packages could match while the file's inputs moved.
- B2: with `BacklogQuiet.cancelled` returning at once, `edit-cut-route` Vitest test 6 fails; as committed it passes.
- The release commit: eight version places, bundles match the tree.

Run `npm ci`, then `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once. `backlog-slots-overhead.test.ts` test 3 is red alone on main 0.1.252 too (row 011-99); name it if it fails. Append a dated "Re-review" section to `reviews/0.1.253.md` with PASS or FAIL on `6a9dff117` and commit it. A finding outside B1 and B2 that is not a proven break goes to "Inputs for the next wave", not the verdict.

## R3: review of cand/0.1.255, the CPU cap (011-96 to 011-98)

Use /reviewer. Shape: review. Pinned to the `cand/0.1.255` SHA named in the spawn; the range is `origin/main..<sha>` on base `35ca57846` (0.1.253): 011-96, 011-97, 011-98, W6's notes and the release commit (0.1.255; 0.1.254 is another coordinator's). Read `tasks/011-83/design.md` sections 1 to 3 and 7, C10 as amended 2026-10-21, `tasks/011-96/notes.md` (its "Decisions the design left open" are deviations to judge), and the board rows.

Check that:
- an edit's tier never waits and takes no permit, with any pool, gate or mark state; it writes a want-0 mark with its cores and clears it at its end;
- every backlog worker holds a permit: no free worker; a share can be 0; a waiter is served first at the next division and forgets its age 30 s after its last look; a refused pump looks again on a tier's end or within 2 s, with no busy loop (`#capacityWake`);
- a tier gives back permits as its files end, and its mark says so; Vitest's floor of 2 applies only to `isolate: false` projects; a mixed tier can never reach Vitest's "different maxWorkers but same groupOrder" throw; `raiseToLeast` cannot starve a waiter or hand out more than `hostSlots`;
- the CPU gate counts Squeal's measured process trees, reaped children included; no `/proc` means no gate; `hostSlots` above the CPU count is cut with a note; an older release's marks still work (C10 compatibility);
- the version is raised in all eight places and the bundles match the tree.

Run `npm ci`, then `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once. Known red on main too (row 011-99): `slow-slot-fair.test.ts`, `backlog-slots-overhead.test.ts` test 3, `opencode-dispose.test.ts` (008-38). Write `reviews/0.1.255.md` with a PASS or FAIL verdict and commit it.

## RP3: repair of cand/0.1.255, review B1 and B2 (the pool's marks)

Use /worker. Shape: repair, two commits. Base: `5fa31c1c1` (011-96 to 011-98 and W6's notes on 0.1.253, without the release commit). Read `reviews/0.1.255.md` B1 and B2, C10 (An edit's tier, Backlog and checkpoint tiers) and `tasks/011-96/notes.md` decisions 6 and 10.

B1, seam `#startRefresh` in `src/core/capacity/pool.ts`: a refresh applies the waiter's 30 s expiry (`#forget`) and, when it forgets, rebuilds the mark through `#publish`, keeping the edit's cores. B2, seam `running()` in the same file: prepare and check the pool directory before the first edit mark, with `acquire`'s private-directory rules; the edit still never waits and takes no permit, and a directory failure stays non-blocking. First edit, a lead: the reviewer's two probes as red tests in `test/capacity/pool.test.ts` or a new `test/capacity/edit-mark.test.ts`, with an injected clock, not a real 31 s wait.

Owns: `src/core/capacity/pool.ts`, `test/capacity/`. Not yours: `src/runners/vitest/` (RP4 runs beside you), `src/core/scheduler/`, the release commit, bundles, version, spec, board. Rules as in this file's header. Done when both probes are red before and green after, waiter seniority inside 30 s still holds, and lint, typecheck and `squeal run --all --wait` pass, their output and the whole report in your final message.

## RP4: repair of cand/0.1.255, review B3 (an isolated tier's width)

Use /worker. Shape: repair. Base: `5fa31c1c1`, as RP3. Read `reviews/0.1.255.md` B3, C10 (Runner ceiling), 013 V9, and `tasks/011-96/notes.md` "The 011-97 risk check".

Outcome: the floor of 2 applies only when a tier holds a file of an `isolate: false` project, so an isolated-only tier at grant 1 runs one worker and asks for one permit; a tier that mixes both kinds still never reaches Vitest's "different maxWorkers but same groupOrder" throw. Seam: `#rootFloor` and `floorOf` in `src/runners/vitest/width.ts:71`, and the width the scheduler's `fewest()` reads (`src/core/scheduler/tiers.ts`): the floor must follow the tier's files, not every sibling that reads the root width. First edit, a lead: the reviewer's shared-root fixture (a isolated, b `isolate: false`, both `extends: true`, no `maxWorkers`) as red tests in `test/runners/vitest/width.test.ts`: a-only at grant 1 runs worker id 1 only; a mixed tier at grant 2 runs without the throw.

Owns: `src/runners/vitest/width.ts`, the width hunk of `tiers.ts` and the `RunnerAdapter` width type if its signature must take the tier's files, their tests. Not yours: `src/core/capacity/` (RP3), the release commit, bundles, version, spec, board. Width hints stay outside key inputs (`test/keys/validity/adapters.test.ts`). Rules and done-when as RP3.

## R4: re-review of cand/0.1.255 after RP3 and RP4

Use /reviewer. Shape: review, the one re-review of this candidate. Pinned to `398630b3f` (cand/0.1.255 re-cut: main `35ca57846`, the three rows and W6's notes, RP3's `3ff1d3cb5` (B1) and `d9f949cd0` (B2), RP4's `735688173` (B3), a new release commit). Read `reviews/0.1.255.md` and this file's RP3 and RP4.

Check B1 to B3 against their proofs, then the repairs' own ground:
- B1: an edit that runs past a refused look's 30 s leaves no waiter in its mark, and a newcomer takes a free permit; a waiter inside 30 s keeps its seniority.
- B2: the first edit before any acquisition creates the pool directory and writes its mark; a refused directory leaves the edit running without a mark, never waiting.
- B3: with the shared-root fixture, an isolated-only tier at grant 1 runs one worker and asks for one permit; a mixed tier runs without Vitest's "different maxWorkers but same groupOrder" throw; a project that set `maxWorkers: 1` still runs at 1.
- The release commit: eight version places, bundles match the tree.

Run `npm ci`, then `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once. Known red on main too (row 011-99): `slow-slot-fair.test.ts`, `backlog-slots-overhead.test.ts` test 3, `opencode-dispose.test.ts`. Append a dated "Re-review" section to `reviews/0.1.255.md` as it is on origin/main, with PASS or FAIL on `398630b3f`, and commit it. A finding outside B1 to B3 that is not a proven break goes to "Inputs for the next wave".
