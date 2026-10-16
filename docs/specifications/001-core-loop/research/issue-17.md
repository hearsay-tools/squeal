# Research: issue-17

Brief `research/issue-17-brief.md`, 2026-10-16. Subject: hearsay-tools/squeal#17 (reported during hearsay-tools/cezarion#1179, Squeal 0.1.199). Examined: the shipped CLI and daemon 0.1.199 (`~/.claude/plugins/cache/hearsay/squeal/0.1.199`), Vitest 5.0.5, Node 24.21.0, and this checkout at `d189f659` (0.1.202) for source. `git log squeal--v0.1.199..d189f659` touches none of the cited files except `squeal stop` (001-367), so the source citations hold for both. Probes and logs: `probes/issue-17/`. Isolated fixtures, own `XDG_RUNTIME_DIR` each; no other daemon touched. Host load 15 to 25.

PR 1185 in cezarion is about archive-on-merge and names nothing of Squeal. Its file list includes the unit file the issue names (`packages/web/src/routes/settings/project-general.test.tsx`) and two browser specs. It is context, not evidence.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | What has a board row, what is new | Rows exist for: the named-wait design and its "no priority" decision (005-11, 006-55); an edit waiting behind its daemon's own tier in a lane (001-381, research planned, backlog tiers only); the runner part waiting behind a run (001-150, 001-228's bound); the shared slow slot (004-11, 004-30, 001-376). New: a test-file path also selects every file whose closure holds it (code and spec 005 D2 differ); an unlisted revision whose cause and bound no status line names; status counting an open run's checks as queued, `running 0`. | read in source code, verified by experiment |
| 2 | Can a named unit file wait on dependent browser files after its own result | Yes, reproduced. The unit result was stored 390 ms after the edit. `status --wait 30000 src/unit.test.ts` selected the 3 browser files too, timed out at 30.2 s (exit 3), and settled only 46.4 s after the edit, once all three had re-run one at a time. | verified by experiment |
| 3a | Can discovery stay pending | Yes, reproduced, for one cause. When a same-bytes rewrite (touch) or a Vitest config edit lands while a fast-lane run is in flight, `runnerPartPending` stays true until that run ends: 54 s for a 60 s run, 24 s for a hung run cut at `runner.timeoutMs` 30 s. No fast tier starts meanwhile. A plain edit lists at once. A slow-lane run does not hold it. | verified by experiment |
| 3b | Do newly created test files need a restart | Not reproduced. The new file was unlisted for the whole stall. It was listed and run within 0.2 s of the in-flight run ending or timing out, with no restart. Its bound is that run's `runner.timeoutMs`: 600 s in cezarion. | verified by experiment |
| 3c | 6,816 queued, 0 running, a 7-minute Vitest fork | The shape is reproduced at small scale. The config variant showed `queued 10, running 0` for 54 s while the run was open, because a re-key counts the checks of a running file as queued. Whether cezarion's stall had this cause is not determined (see open questions). | verified by experiment; cause inferred |

## 2. A named unit file waits on its dependents

- `selectNamedFiles` (`src/cli/status-wait-paths.ts:66`) keeps a row when `row.testFile.path === rel || closures.get(row)?.has(rel)`. Both rules apply to every path. A closure holds the declared `inputs` matches (`src/core/keys/closure.ts:153-160`, method "static imports plus declared inputs"). Spec 005 D2 reads: "A test-file path selects itself. Any other path selects the test files whose closure holds it." No test in `test/cli/status-wait-paths.test.ts` names a test file that sits in another file's closure. *read in source code*
- Fixture (`make-fixture.sh`): `inputs: { "e2e/*.e2e.ts": ["src/**"] }`, as cezarion declares `packages/web/src/**` for `packages/web/e2e/*.e2e.ts`; the three browser files are slow, `maxWorkers: 1`, 15 s each. `logs/named-wait.txt`:
  - `Selected: e2e/b1.e2e.ts, e2e/b2.e2e.ts, e2e/b3.e2e.ts, src/unit.test.ts`
  - runs after the edit: `src/unit.test.ts` 148 to 390 ms; b3 397 to 15,679; b1 15,685 to 30,918; b2 30,924 to 46,148
  - `exit 3 after 30196 ms; Named test files have no verdict: the deadline passed after 30.0 s: 2 test files still pending at revision 1`
  - the next `--wait 120000` exited 0 at edit + 46,374 ms: `4 test files, each with a current result`.
  *verified by experiment*
- The verdict line names only a count of pending files. It does not say that the named file itself is current. *verified by experiment*
- In cezarion, the named file is under `packages/web/src/**`, so every browser spec selects it. One `pid-file.testkit.test.ts` entry declares `packages/cezar/src/**/*.test.ts` too. That fits the reported 79 to 83 selected files. *inferred (from cezarion's `squeal.config.json` on main, read 2026-10-16)*
- A path-less `status --wait` after the same edit would hold for the browser files too, since the edit re-keyed them (001-186). Not run. *inferred*

## 3. Discovery pending, and new files

- Mechanism. The scheduler selects no tier while runner work is queued (`src/core/scheduler/scheduler.ts:500`, `runner-work.ts:55`). The Vitest adapter's runner part overlaps a run (`gate.ts`, 001-150). The exception is when the instance must be recreated: a touch (`adapter.ts:227`, 001-159), a recreate trigger such as the config (`adapter.ts:300`), or an unsure instance. The recreate is `Gate.exclusive`, which waits until no lane is inside a call (`gate.ts:57`). The slow lane has its own instance (`src/core/daemon/slow-instance.ts`), so a slow run never holds it. The wait is bounded at `runner.timeoutMs` + 6 s + 60 s (`runner-work-bound.ts`, 001-228). The scheduler comment says so: "A runner that serializes its calls behind its own run (Vitest's adapter) still holds the runner work for as long as its tier runs." *read in source code*
- `discovery.sh`, a 60 s fast-lane file in flight, then the variant, then, about 3 s later, an edit of `src/unit.test.ts` and a new `src/new.test.ts`. Times run from the variant's step; samples come every 2.2 s (`logs/discovery-*.txt`):

| Variant | `runnerPartPending` | New file listed | Edit's tier started | Counts while pending |
|---|---|---|---|---|
| fast, plain | false at +235 ms | +235 ms (queued) | +57.3 s, when the long run ended | queued 8, running 2 |
| fast, touch | true at every sample to +55.3 s, false at +57.5 s | +57.5 s | +57.4 s | queued 8, running 2 |
| fast, config | true at every sample to +57.4 s, false at +59.6 s | +59.6 s | +57.5 s | queued 10, **running 0**, run open |
| slow, touch | false at +3.2 s | +3.2 s | +3.2 s, beside the slow run | then queued 6, running 0, slow run open |
| fast, config, hung 600 s, `timeoutMs` 30 s | true at every sample to +27.1 s, false at +29.3 s | +29.3 s | +27.2 s, after `timed-out` | queued 10, running 0 |

  *verified by experiment*
- With a plain edit, the listing is immediate, but the edit's tier still waits 57 s for the lane's tier in flight. That tier was an edit's tier, which D5 never cancels. 001-381 covers only a backlog tier in flight. *verified by experiment*
- `running 0` while a run is open: the edit re-keyed the running file (config here; in the slow case, the `src/**` input), so its checks count as queued under the new key. `slowTier.activity` was `null` in the slow case, with the run open. *verified by experiment*
- A restart was never needed. The hung variant's `RESTART=1` branch did not fire, since the file was listed at +29.3 s. A `squeal stop` of 0.1.199 lets the tier in flight finish (spec 001 D10, before 001-367). So a restart helps only by killing a run that would otherwise last its full timeout. *verified by experiment (listing); inferred (restart)*
- A named wait cannot settle while the revision is unlisted: `ready` requires `!verdict.unlisted` (`status-wait-paths.ts:200,207`). *read in source code*

## Other reported symptoms

- `run --slow --wait 60000` timed out with 92 slow files queued. The slow slot is per user and host (004 D2). During this research a cezar worktree daemon (0.1.199, pid 2981344) held it with 91 browser files pending, and a fixture's slow files waited "for the slow slot another worktree's slow tier holds" for over a minute (`logs/host-slow-slot.txt`). With `maxWorkers: 1`, 92 serial browser files cannot fit in 60 s on any host. This is designed behaviour, with a status note. *verified by experiment (slot); inferred (the issue's case)*
- A revision-6 failure kept showing until its file re-ran. That is D6's stale state; the reporter read it correctly. Not reproduced, and no defect is claimed. *inferred*
- The 7-minute fork, the 6,816 queued checks and the restart at revision 55 are the reporter's observations. They were not reproduced on cezarion.

## Recommendation for Squeal

Three findings are new and reproducible, each a decision for the human, not a fix chosen here:

1. Spec 005 D2 and the code disagree on a test-file path. Decide whether a test-file path selects only itself, or itself and its dependents (the code now). Either way, the line could report the named file's own state apart from its dependents.
2. An unlisted revision says neither why nor until when. `runnerPartPending` is all an agent sees, for up to `runner.timeoutMs` + 66 s (11 min in cezarion). The run it waits for, and that bound, are known to the daemon.
3. Status shows `running 0` while a re-keyed file's run is open. The issue's "zero running" reading followed from this.

The issue's "prioritize explicitly requested targets" conflicts with the human's 2026-10-13 decision on 005-11 (no reordering). Edit-behind-edit-tier waiting extends 001-381's question beyond backlog tiers.

## Open questions, and the evidence that decides them

- Did cezarion's stall come from a recreate behind a fast run? To decide it, read the cezar store for that worktree, read-only (with the coordinator's permission): the `revisions` changes for revisions 7 to 54 (a config, lockfile or setup path, or a same-bytes rewrite such as a build output or formatter), the `runs` rows open at the time with their `end_state` (`timed-out` at 600 s), and the daemon notes. Retention is 7 days (`store.retentionDays`), so the rows expire about 2026-10-23.
- What held the run for 7 minutes: a hung test, or a run waiting on the per-user capacity pool (001-376)? Not determined, because no cezarion run log was read.
- Whether "new matching files had no listed checks" ever lasted past one run's timeout. Not determined. The fixture never needed a restart.

## Sources

- hearsay-tools/squeal#17 (body; no comments), read 2026-10-16 with `gh issue view 17 --comments`.
- hearsay-tools/cezarion PR 1185 (open, head `7d64316e`), `gh pr view`/`gh pr diff --name-only`; cezarion `squeal.config.json` on main via `gh api`.
- Source at `d189f659`: `src/cli/run.ts`, `src/cli/status-wait-paths.ts`, `src/cli/verdict.ts`, `src/core/keys/closure.ts`, `src/core/scheduler/{scheduler,runner-work,runner-work-bound}.ts`, `src/runners/vitest/{adapter,gate,run}.ts`, `src/core/daemon/slow-instance.ts`; spec 005 D2; board rows 001-150, 001-159, 001-186, 001-191, 001-217, 001-228, 001-381, 004-11, 004-30, 004-60, 005-11, 006-55.
- Probes and logs: `probes/issue-17/` (`README.md` has the replay).
