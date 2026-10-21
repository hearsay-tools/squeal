# Wave 10 of spec 011

## W1: 011-20, the stop-gap e2e race

Use /worker. Shape: repair. The human, 2026-10-21: fix now.

Outcome: `test/e2e/stop-gap.test.ts` passes on CI's Node 22 shard 2/3 under load, because the race behind its six sightings is named and fixed, in the code or in the test's premise.

Read board rows 011-20 (six CI runs, two shapes) and 011-08 (the stop mark holds until the next edit or `squeal start`), and the test's header (001-340, 001-355). Evidence: `gh run view <id> --log-failed` for 39141267519, 39576507169, 39628123539, 39648758886, 39657056174 and 39658902847. Shape 1: the SessionStart after the edit in the gap reads `The daemon is stopped by request` at `:58`. Shape 2: it reads `registered at revision 0`, the replacement already serving.

Seam: `livenessSentence` in `src/core/delivery/header.ts`, and the mark's tree check in `src/cli/stop.ts` and `src/core/daemon/escaped.ts`. A lead, not a ruling: shape 2 may be a right outcome the test does not admit; shape 1 may be an edit inside the mark's mtime tick. Reproduce each first with fewer CPUs (`taskset -c 0-1 npx vitest run test/e2e/stop-gap.test.ts`, the file excluded from Squeal), never by loading the shared host.

Owns: `test/e2e/stop-gap.test.ts`, `test/e2e/restart-evidence.ts`, the source the cause names in `src/cli/stop.ts`, `src/core/daemon/` or `src/core/delivery/header.ts`, and their unit tests. Not yours: other e2e files, the board, spec text, bundles, version.

Done when: each shape is reproduced, or `tasks/011-20/notes.md` says why not and what evidence stands instead; the fix turns the reproduction green; the test still proves 001-340 (stop waits for its lock, the replacement serves); no other test weakened; the file passes 10 runs in a row at the reproduction's CPU limit; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

## W2: 011-86, one Node floor, 22.19

Use /worker. Shape: slice. The human, 2026-10-21: the floor is 22.19, and a change to it should not take twenty edits.

Outcome: Squeal's Node minimum is 22.19, `package.json` `engines.node` is its one source, and a test fails, naming each file and line, when a shipped file states another.

Read board rows 010-33 and 011-86; spec 010 D4; the CI trials 39669531454 (22.13: about 40 files fail; `registerHooks` needs 22.15), 39671301374 (22.15: Pi needs 22.19, `.ts` children need 22.18) and 39671309714 (22.19: green); `scripts/check-version-bump.ts` as a model.

Seam: `git grep -n '22\.13' -- ':!docs' ':!package-lock.json'` lists today's places. A lead: `engines.node` to `>=22.19`; the build reads the floor from `package.json` for `target` in `src/harness/build.ts` and `src/harness/opencode/build.ts` and for the OpenCode plugin's check and log line (`src/harness/opencode/plugin.ts`); one variable at the top of `install.sh` and of the launcher; `node-version: "22.19"` in `ci.yml`'s `node22` job, literal, because setup-node resolves a range to the newest. Then `test/node-floor.test.ts` over README.md, `plugins/*/README.md`, `install.sh`, `plugins/*/bin/squeal-launcher`, `src/` and `ci.yml`.

Owns: those files, the floor case in `test/cli/install-sh.test.ts`, the new test. Not yours: spec text and the board (the coordinator amends specs 001, 003, 005, 010 and 011), bundles, version.

Done when: with only `engines.node` raised, the floor test fails and lists every place; after, it passes; `install.sh` stops on 22.18 with the new floor; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

## R1: review of cand/0.1.249

Use /reviewer. Shape: review. Pinned to the `cand/0.1.249` SHA named in the spawn; the range is `origin/main..<sha>`: W1 (011-20, two commits from `cez/f98df774`), W2 (011-86, from `cez/c0e11c37`) and the release commit (0.1.249, bundles).

Read W1 and W2 above, `tasks/011-20/notes.md`, `tasks/011-86/notes.md`, board rows 011-20, 010-33 and 011-86, spec 011 C8 and C9 on the stop mark and the starting daemon, and spec 010 D4. Check that:
- 011-20: a daemon a hook spawned and still starting voids the mark, and after `DAEMON_START_GRACE_MS` with no heartbeat a held mark is told again; no later liveness-only delta says "stopped by request" under a "starting" header; the e2e forces the late-mark order through the `stop-mark` pause and still proves 001-340;
- 011-86: `engines.node` is the one source; the floor test fails with only `engines.node` raised and names every place; `install.sh` stops below 22.19; the key-format alarm fires on an `engines.node` change and not on a version raise; the target change leaves the key format unchanged, as the notes claim;
- CI's Node 22 shards run v22.19.x, and `stop-gap.test.ts` passes there;
- the version is raised in all eight places and the bundles match the tree.

Run `npm ci`, then `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once in the candidate tree. A file that fails loaded and passes alone is named; `slow-slot-fair.test.ts` failed alone at load 52 on 0.1.247, outside that range. Write `reviews/0.1.249.md` with a PASS or FAIL verdict and commit it.

## Q1: quality scan of waves 8 to 10

Use /quality. Shape: survey. The human, 2026-10-22: a read-only scan now, code rows later.

Stretch: `squeal--v0.1.240..squeal--v0.1.249`, the rows of this coordinator's waves 8 to 10: 013-03, 011-54, 011-56 to 011-59, 011-63, 011-65 (0.1.242), 011-71, 011-75, 011-76 (0.1.245), 005-73 (0.1.247), 011-20, 011-86 (0.1.249). Other rows in the range (011-69 in 0.1.244, spec 014's waves in 0.1.246 and 0.1.248) are context: name a duplicate they share with a row above, nothing else of theirs.

Read `docs/vision.md`, `docs/styleguide.md`, the rows on the board and their notes under `tasks/`, and the `status.md` lines of 011, 005 and 013 dated 2026-10-20 to 2026-10-22. Leads, not rulings: the four launchers kept identical by hand (005-73, 005-74, 005-75 all edit them); `nodeFloor` and `rootVersion` both reading `package.json` in `src/harness/build.ts`; the yield and supersession paths of 011-54 and 011-71 in the scheduler; `testFileFrame` beside the existing location code in `src/core/status/`.

Write `docs/specifications/011-core/quality/2026-10.md` and commit that file alone. No board, spec or code edits. Run no full suite: the host is loaded; a single test file to prove a duplicate is fine.
