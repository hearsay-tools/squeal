# shared-proof: the cezar proof, measured (row 018-21)

Researcher c5546f90 for spec 018, 2026-11-10, 19:18Z to 20:20Z. Brief: `tasks/wave-9.md`. Squeal `squeal--v0.1.426` (`f20fd5f33`), run as `node <shallow clone of the tag>/plugins/claude-code/dist/cli/squeal.mjs`. cezarion main from `ef0c1ff0` (the first publish, cezarion#3176) to `13582fdd`. Node 26.13.0 and 24.22.1 from `/home/agent/.nvm/versions/node/v*/bin`, set explicitly on `PATH`. Every clone and install ran under `$TMPDIR` with a temporary `HOME`. Every daemon ran under `env -i`, with that `HOME` and a temporary `XDG_RUNTIME_DIR`. Squeal ran lookup-only. No `squeal run`, no cezar test, and every daemon was stopped (`stop.txt` per count). GitHub calls were read-only. Host: 24 vCPUs, one-minute load 3.6 to 42 during the counts (load does not change a count). Probes: `probes/shared-proof/` (throwaway). Tags: **[exp]** verified by experiment, **[src]** read in source code, **[inf]** inferred.

## Questions answered

| # | Question | Answer (effect first, n behind it) |
|---|---|---|
| 1 | CI cost of recording | **About +16% Vitest shard time per merge-group run against plain runs of the same period, not +3%. Not confirmed by a same-commit comparison.** Summed test steps of the 4 shards: 2,738 s with recording (n=18 runs) against 2,362 s for plain merge-group runs since 2026-11-09 (n=30). The same-run E2E control gives +16.3% (95% CI 11.9 to 21.1%). Against all plain runs since 2026-11-08 (n=92) it is only +4.6% (1.3 to 8.7%), because the Vitest suite itself was 14% slower on 2026-11-08 for a reason unrelated to Squeal. One run that did not attach (0.1.423) was as slow as the recording runs. Added steps: 9 s per shard (release fetch 7 s, upload 1 to 2 s, n≈100). Export job 80 s median (n=11), publish job 33 s (n=8), both after the gate: no merge waited for them (6 of 6). Runner noise: one run's 4-shard sum varies 7 to 10% (cv), one shard 16 to 18%, and two runs of one commit differ 0.8x to 1.4x **[exp]** |
| 2a | Files current in a fresh clone at a published commit, Node 26.13.0 | **First daemon start: 31 of 1,449 exported files current (2%), and still 31 after 11 min (44 reads). Second start on the same store: 1,449 of 1,449 (100%).** The second start covers 78% of the 1,862 listed files and 89% of the 1,626 Vitest files of the four recorded projects. Replicated in a second fresh clone at `13582fdd`: 31 of 1,477, then 1,477 of 1,477 (79% of 1,864 listed). The first-start miss is a Squeal defect: the reader imports after the daemon has keyed, and the daemon does not re-key with the observed entries the import added **[exp][src]** |
| 2b | At a later main commit (no ref) | At `efcfb0e3`, which has no ref because its merge group reused a PR's results, the reader took the parent's export (`9dd2ca62`). **31 of 1,449 at first start, then 694 of 1,449 (48%) after a restart.** The 755 others are exactly the exported files whose closure names one of the 15 paths the commit changed (754 read `packages/cezar/src/workspace/backups.ts`). This is correct invalidation. Five exports one commit later keep 47.9 to 88.3% (median 86.5%) **[exp; decay inf, checked against the measured 694]** |
| 2c | Why the others are not current | Of the 413 listed files not current after the restart at `afd1b777`: **177 Vitest files ran in CI but the export left them out** (145 "inputs here are not what their shard read", 32 "two checks of one name"), **136 node:test files** (`ci record` records Vitest only), and **100 `e2e` files** (`at: manual`, not in the recorded shards). Status names no other reason **[exp]** |
| 2d | Node 24.22.1 | **0 of 1,449** at both starts: `environment differs`, "Node v26.13.0 in the export, v24.22.1 here" for all four projects. **The Node pin is worth the whole share** **[exp]** |
| 3 | Live cezar worktrees | **Not moved.** All 7 live cezar daemons run Node 24.22.1 (`/proc/<pid>/exe`, 19:4xZ). A second block is independent of Node: cezar's main checkout has no `refs/remotes/origin/HEAD`. So the reader stops in every live worktree with "CI results: shared.ref is set, but no remote names its default branch; run `git remote set-head origin --auto`", and cezar's shared store has no `imports` table. Live share today: **0** **[exp]** |

## Q1. CI cost

Source: `fetch-ci.sh` saved 269 `ci.yml` runs (merge_group, push to main) since 2026-11-08 and 580 job logs. `ci-cost.mjs` and `ci-control.mjs` read them (`out/ci-cost.txt`, `out/ci-control.txt`). GitHub reports no CPU per job. The nearest proxy is Vitest's own phase sum (transform + setup + import + tests + environment, summed over workers). It moves with the step wall (cv identical), so this section uses step seconds. All shards ran Node 26.13.0 (440 of 440 logs) and the same command (`vitest run --project server --project contract --project api-client --project web --shard=N/4 --maxWorkers=4`).

**Within-run control** (`ci-control.mjs`). Each merge-group run also runs four cockpit E2E shards at the same time on the same runner pool, and they are not recorded. Their sum stays flat, so the runner pool's speed did not move. The Vitest sum moved twice:

| Group | Runs | Vitest sum (s) | E2E sum (s) | Vitest / E2E (sd) |
|---|---|---|---|---|
| plain merge group, 2026-11-08 | 62 | 2,737 | 2,705 | 1.013 (0.079) |
| plain merge group, 2026-11-09 | 28 | 2,362 | 2,722 | 0.869 (0.087) |
| plain merge group, 2026-11-10 before 03:41Z | 2 | 2,296 | 2,665 | 0.861 |
| plain push to main, 2026-11-10 (same code as the recording runs) | 4 | 2,305 | 2,729 | 0.847 (0.108) |
| 0.1.423 recording step, hook not attached, 2026-11-10 10:29Z | 1 | 2,741 | 2,732 | 1.003 |
| **recording, 0.1.425 and 0.1.426, 2026-11-10 13:03Z to 19:36Z** | **18** | **2,738** | **2,716** | **1.010 (0.069)** |

- Against same-period plain runs: **+16.3% (95% CI 11.9 to 21.1%)**, n=18 against 30. Per test file, without the control: +13.9% (10.0 to 17.9%). The suite grew from 1,593 to 1,623 files per run.
- Against all plain runs: +4.6% (1.3 to 8.7%). Against 2026-11-08 alone: −0.3% (−3.5 to 3.4%). The Vitest suite got 14% faster from 2026-11-08 to 2026-11-09 with no Squeal change. I did not find which cezar commit did it. That step is why the baseline decides the answer.
- **What argues against the +16%**: the 0.1.423 run (cezarion#3151's first merge group) has the recording step, but `ci record` could not attach (status.md, 2026-11-10). It is as slow as the recording runs (ratio 1.003). It is one run, 1.6 sd above the same-period plain mean. Whether 0.1.423's wrapper still preloaded the read recorder before the attach failed is not determined.
- **Same-commit pairs** (merge group against the push run of the same commit) do not help. Only 6 push runs since 2026-11-08 ran their shards; the rest reused a result. The one plain-plain pair has a ratio of 0.8, and the one 0.1.426 pair 1.4.
- **Merge wait**: the gate job waits for the slowest Vitest shard in 7 of 10 recording runs, against 30 of 79 plain runs. The mean margin over the last E2E shard is +36 s, against −29 s. The slowest shard is +104 s (+15%, 95% CI 11 to 20%) against the 31 plain runs of the day before cezarion#3151. So recording now lengthens the merge path, by about 1 to 2 min a merge **[inf]**.
- **Export and publish**: export 80 s median (IQR 72 to 83, n=11 successes), publish 33 s (31 to 37, n=8; the first one took 88 s). Both start after the gate. On 6 of 6 published commits the commit landed on main before or as the publish ended (`gh api …/runs?event=push&head_sha=`): refs appear 0 to 99 s after landing. 8 failed export runs before 0.1.426 used 36 to 47 s each.
- **Runner noise**: one shard's step varies 16 to 18% (cv), a run's 4-shard sum 7 to 10%, and the E2E-normalised ratio 7 to 9%. At a run-level cv of about 8.5%, a 3% effect needs about 60 runs per arm for a 95% interval that excludes zero, and about 125 per arm for 80% power **[inf]**.

## Q2. Files current from the fetched export alone

`count.sh`: blobless `git clone` of cezarion, checkout, `pnpm install --frozen-lockfile` (pnpm 12.11.2 from `packageManager`), empty `.git/squeal`, `squeal start`. Then `squeal status --full --json` every 15 s until three listed reads agree, and `squeal stop`. Counts from status's own `imports[]` (D5) **[exp]** (`out/counts/<label>/reads.txt`):

| Clone, Node, start | Export read | Listed | Exported, listed here | Current from it | Not current (status reason) |
|---|---|---|---|---|---|
| afd1b777, 26.13.0, first | run 42873763583 at afd1b777 | 1,862 | 1,449 | **31** | 1,418 content differs |
| afd1b777, 26.13.0, restart | same | 1,862 | 1,449 | **1,449** | none |
| afd1b777, 24.22.1, first and restart (fresh store) | same | 1,862 | 1,449 | **0** | 1,449 environment differs (Node) |
| efcfb0e3 (no ref), 26.13.0, first | run 42864434332 at 9dd2ca62 | 1,862 | 1,449 | 31 | 1,418 content differs |
| efcfb0e3, 26.13.0, restart | same | 1,862 | 1,449 | **694** | 755 content differs |
| 13582fdd (second fresh clone), 26.13.0, first | run 42883978163 at 13582fdd | 1,864 | 1,477 | 31 | 1,446 content differs |
| 13582fdd, 26.13.0, first, watched 11 min | same | 1,864 | 1,477 | 31 (all 44 reads) | 1,446 content differs |
| 13582fdd, 26.13.0, restart | same | 1,864 | 1,477 | **1,477** | none |

**Why the first start misses** **[exp][src]**.
- The 31 files current at first start are exactly the exported files with no observed entries (contract 29, api-client 2). The 1,418 misses are exactly the files with observed entries (server 1,075, web 343).
- In the clone's store, every one of them was re-keyed (D11): `import_files.environment` is the local hash. The re-keyed key over the commit's blobs had no differing file path (`key-paths.cjs`) and no differing listing (`key-listings.cjs`). So the local daemon's own key had left out the observed paths.
- Cause in 0.1.426: `daemon.ts` creates the shared reader only after `await loop.start()` (lines 830 to 849), so the start's keying is done before any import. The reader's `imported` callback only calls `scheduler.requestRetries()` (`daemon.ts:841`, `scheduler.ts:771`), a lookup at the keys already held. The observed entries that the import adds to the shared store reach a key only at the next daemon start. In the clone, environments were recorded at 19:24:10Z and the import came at 19:25:12Z.
- Status calls this "content differs", which hides the real cause. Status compares this worktree's stored closure list and the shared observed set (both now hold the import's paths), not the daemon's in-memory key.
- The first import trial (`import-trial.md`, count 1) did not see this, because `squeal import` ran before `squeal start`.

**What the export leaves out** **[exp]**. The export job's log (`out/export-left-out.txt`): "Exported 1449 test files … Left out: 145 test files whose inputs here are not what their shard read, 32 test files with two checks of one name". At 13582fdd: 1,477, with 119 and 32 left out. It names only three, for example `ast-grep-rules.test.ts` (`.ai/ast-grep/*`) and `ci-tools-definitions-validation.test.ts` (`packages/cezar/scripts/mock-cursor-print.mjs`). `parts-cmp.cjs` read the four downloaded parts of run 42883978163 (`out/parts-cmp-13582fdd.txt`). Findings:
- The 32 are the files whose part carries `sharedNames` (templated names such as `rejects invalid arguments "inspect"`).
- 77 files read a path that has no content evidence, mostly scripts the tests start as child processes: `pi-retry-degraded-service.mjs` 46, `mock-cursor-print.mjs` 39, `pi-default-tools.mjs` 38, `pi-project-skills.mjs` 26. 3 files have a recursive listing. 1 file read `packages/cezar/dist/hsq.js`, a build output.
- That accounts for 80 of the 119. The other 39 have every recorded input and listing equal to the commit tree. Their reason is not determined from the parts alone. The export compares against its own checkout, which also ran `pnpm install` and "Build server dependencies".

**At a later commit** **[exp][inf]**. `decay.mjs` applies D11's match rule offline: same blob for every closure and observed path, same names for every listing. For 9dd2ca62 → efcfb0e3 it gives 694, the measured count. One commit after an export, five exports keep 1,280, 704, 1,253, 694 and 1,276 of 1,449 files (88.3, 48.6, 86.5, 47.9 and 88.1%). Two of the five PRs touched a module that about 750 test files import. After those two, the share stays near 45% for the rest of the day (`out/decay.txt`). Since cezarion#3176, 6 of 7 main commits have their own ref (`out/main-line.txt`). `efcfb0e3` has none, because its merge group reused a PR's suite (shards ran 4 s; export and publish skipped). The spec's non-goal says "none now" for this case; it happened once in 7. A worktree started in the 0 to 99 s between landing and publish takes the parent's export. The reader handles one export per start point, so it does not take the newer one later (`reader.ts` `#start`) **[src][inf]**.

**Node 24.22.1** **[exp]**. 0 of 1,449. `squeal status --full` names "Node v26.13.0 in the export, v24.22.1 here" and also "config fields allowOnly, browser, watch differ" for each project. Under Node 26.13.0 the same fields did not block the match, because D10 tolerates them. So the difference text names fields that D10 ignores.

## Q3. Live cezar worktrees

At 19:4xZ, 7 cezar daemons ran (`ps` and `/proc/<pid>/exe`), all on Node 24.22.1, so the condition of Q3 is not met. One read-only `squeal status --full --json` in worktree `ccaba06a` (HEAD `afd1b777`, `.node-version` 26.13.0) gave `imports: []`. Its daemon notes hold, three times: "CI results: shared.ref is set, but no remote names its default branch; run `git remote set-head origin --auto`". `git -C ~/projects/cezar symbolic-ref -q refs/remotes/origin/HEAD` exits 1. `upstreamOf` (`src/core/shared/choose.ts:32-48`) needs that ref, and a fresh `git clone` creates it, which is why the probes' clones worked. Read-only, cezar's `store.sqlite` has no `imports` table: no live worktree has imported anything since cezarion#3176 **[exp][src]**.

## Recommendation for Squeal

1. **Fix the first-start miss before reading any day's share.** After an import, the daemon must re-key the files whose observed entries the import added, as at start. Today a fresh worktree gets 2% instead of 100% until its daemon restarts. The same gap applies whenever the reader imports into a running daemon (a new start point after `git pull`) **[exp][src]**. Also, status should not call this "content differs".
2. **Do not claim +3% for `ci record`.** The same-period evidence says about +16% Vitest shard time (CI 12 to 21%, n=18 against 30), and recording now sets cezar's merge gate in 7 of 10 runs. What decides it: an A/B at equal content, with plain and recording runs alternating on the same commits (about 60 to 125 of each for a 3% effect), or a cheap self-report of `ci record`'s hashing time in each part. Both are cezar or Squeal changes for the human to approve **[inf]**.
3. **cezar host setup** (not a Squeal change): `git remote set-head origin --auto` in `~/projects/cezar` and a cockpit restart onto Node 26.13.0. Both are needed before Q3 can be measured; until then the live share is 0. Each is the human's call **[exp]**.
4. **Export coverage**: 177 of 1,626 recorded Vitest files (11%) are left out. 32 are left out for templated duplicate names and about 77 for scripts started as child processes with no content evidence. These are the two largest remaining gains **[exp]**.
5. Small: the publish job also pushed a ref for `655a388a`, a merge group whose run failed and which never landed. D14 ignores it, but it counts toward `--keep 100`. The Node-difference text should leave out the D10-tolerated fields **[exp]**.

## Open questions

- Recording cost at equal content (see recommendation 2). Not determined, because the brief forbids running cezar's suite and no same-commit plain run exists.
- Why cezar's Vitest suite was 14% faster from 2026-11-09. It decides the naive baseline.
- The reason for 39 of the 119 evidence refusals at 13582fdd: it needs the export checkout's state.
- The share in a live worktree whose store already holds the union. D11 re-keys there, but it is not measured until Q3's two blocks are gone.

## Sources

- CI: `gh api repos/hearsay-tools/cezarion/actions/workflows/ci.yml/runs?event=…`, `…/runs/<id>/jobs?filter=all`, and `gh run view <id> --log --job <job>` for 2026-11-08T00:00Z to 2026-11-10T19:50Z. Export job logs of runs 42873763583 and 42883978163. Parts: `gh run download 42883978163 -p 'squeal-parts-shard-*'`. Exports: `git fetch --no-write-fetch-head origin <oid>` of `refs/squeal/{ef0c1ff0,f4e3fbb6,a015077a,9dd2ca62,afd1b777}…` in a throwaway clone. Downloads deleted after use.
- Squeal `squeal--v0.1.426` (`f20fd5f33`): `src/core/daemon/daemon.ts` (780 to 849), `src/core/scheduler/scheduler.ts` (`requestRetries`), `src/core/shared/reader.ts`, `src/core/shared/choose.ts`, `src/core/status/imports.ts` (`reasonOf`), `src/core/store/transfer-rekey.ts`, `src/core/keys/check-key.ts`, `src/core/keys/dependencies.ts`, `src/core/ci/export-parts.ts`, `src/cli/ci-export.ts`.
- cezarion at `afd1b777`, `efcfb0e3` and `13582fdd`: `squeal.config.json` (`shared.ref`, `baseline.onStart: lookup-only`), `.node-version`.
- Live, read only: `ps`, `/proc/<pid>/exe`, `git symbolic-ref` in `~/projects/cezar`, one `squeal status --full --json` in cezar worktree `ccaba06a`, and a read-only open of `~/projects/cezar/.git/squeal/store.sqlite` (table list).
- Probes and outputs: `probes/shared-proof/README.md`.
