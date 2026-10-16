# Research: issue #3, a slow tier run without the build output it tests

Topic `issue-3-preconditions` of `README.md`. Researcher: Opus 5.5, 2026-10-16. Shipped Squeal 0.1.199 (`~/.claude/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs`, the hub release), Node v24.21.0, git 2.43.0, Linux, 1-minute load 1.05 on 24 CPUs (0.04 per CPU, calm). Probe: `probes/issue-3-preconditions/` (throwaway). No product code, board, spec or status touched.

## Questions answered

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | Does Squeal run a slow tier whose declared build output is missing? | Yes. All 3 slow files ran, 4 failures in 4 shapes, `run --all --wait` exit 1 | verified by experiment, 0.1.199 |
| 2 | With the build output present (control), does it run and pass? | Yes. 4 files run, 0 failures, exit 0; built after the failing run, the slow files re-keyed and re-ran on their own, `FAIL -> PASS` at revision 1 | verified by experiment, 0.1.199 |
| 3 | Does Squeal already know, before running, that the artifact is missing? | Yes. The spec 004 D5 note fires only in the missing case: the declared `dist/**` matched no existing file. It does not stop the run, and its advice ("declare what they test in inputs") is wrong when the declaration exists | verified by experiment; read in source code, `src/core/scheduler/slow-tier.ts:617`, `src/core/slow/inherit.ts:18` |
| 4 | Does status say what the failing run ran against? | No. The slow-tier line read "3 current against dist/** as of revision 0" while `dist/` did not exist | verified by experiment |
| 5 | Is this the original nine failures? | No. A representative reproduction: same shape (cezarion's `test:package`, node:test, `slow: true`, `dist/` gitignored and declared as input), not the same repository revision or session | inferred, from the copied cezarion tree at `82f9757` |
| 6 | How does the proposal fit vision 1, 2, 5, 8 and spec 004 goal 8 and non-goals? | The skip half fits all of them if "skipped" reads as not run. "Run a declared build step first" conflicts with goal 8 and the first non-goal | inferred, from `docs/vision.md` and `spec.md` |

## Reproduction

Fixture (`probes/issue-3-preconditions/fixture/`): one node:test package. `test:unit` imports `src/greet.mjs`. `test:package` is `slow: true` with `"inputs": {"test/e2e/*.test.mjs": ["dist/**"]}`. Its files import `dist/index.js` (`import.test.mjs`), spawn `node dist/cli.mjs` and match its stdout and exit code (`cli.test.mjs`), and check that `package.json`'s `bin` path exists (`bin.test.mjs`). `dist/` is gitignored. The policy also sets `baseline.onStart: "lookup-only"` as cezarion does, plus `slow.maxLoadPerCpu: 1000`, `maxParallel: 1` and `maxWorkers: 1`, so the load guard cannot defer on a shared host.

```sh
P=docs/specifications/004-slow-suites/research/probes/issue-3-preconditions
CLI=$HOME/.claude/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs
(cd /tmp && SQUEAL_CLI=$CLI sh $OLDPWD/$P/run.sh)                    # missing, then built
(cd /tmp && SQUEAL_CLI=$CLI MODE=built-first sh $OLDPWD/$P/run.sh)   # control
```

`run.sh` commits the fixture to a fresh repository under `/tmp/issue3-XXXXXX`. `HOME` and the `XDG_*` directories point inside that scratch directory under `env -i`, and every command is the shipped CLI by absolute path. The daemon's store is the scratch repository's `.git/squeal/store.sqlite`.

### Path 1: build output missing (verified by experiment)

`squeal start`, then `squeal run --all --wait` (exit 1):

```text
Checkpoint 1e20ab25-... completed at revision 0: 4 known failures: 3 tests, 1 test file that did not load; 4 test files, 0 already current, 4 run now
Known failures: 4 (3 tests, 1 test file that did not load)
  FAIL  [test:package] test/e2e/bin.test.mjs > every declared bin exists
        dist/cli.mjs is missing
  FAIL  [test:package] test/e2e/cli.test.mjs > the CLI exits 0
        Expected values to be strictly equal:
  FAIL  [test:package] test/e2e/cli.test.mjs > the CLI greets the named user
        The input did not match the regular expression /^hello, ada\n$/. Input:
  FAIL  [test:package] test/e2e/import.test.mjs (file-level)
        Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'dist/index.js' imported from test/e2e/import.test.mjs
Full-suite checkpoint: completed at revision 0
Slow tier: 3 test files; 3 current against dist/** as of revision 0. Squeal runs them when the agent pauses.
Notes:
  revision 0: slow files of project test:package with no declared artifact: test/e2e/bin.test.mjs, test/e2e/cli.test.mjs, test/e2e/import.test.mjs. Their key holds no build output, so a change to the code they test does not re-run them and another worktree's result never stands for them; declare what they test in squeal.config.json "inputs" (spec 004 D5, D6)
```

Squeal ran the tests: each failure has a run id, a duration (1 to 42 ms) and a log under `.git/squeal/runs/`. Two of the four summaries name `dist/`. The other two read as an exit code and an empty-input regex mismatch (`squeal why` shows `Input: ''`), the issue's "unrelated regex mismatch" shape. The failures are stored as `current` at revision 0, and the full-suite checkpoint is recorded as completed.

Then `node scripts/build.mjs` in the repository. The watcher saw `dist/` appear as revision 1, which re-keyed the slow files through the declared `dist/**`. With no consumer registered the daemon was idle, so they re-ran before the next command. `run --slow --wait 120000` printed "No slow files to run at revision 0: ... all are current" and then "Returned on quiet ... at revision 1 ...; 4 transitions". The request line names revision 0 although the daemon was at 1, a side observation not pursued. Status at revision 1 showed `Known failures: 0` and 9 checks passed. `squeal why "the CLI greets the named user"` showed `revision 0 first seen FAIL`, then `revision 1 FAIL -> PASS`. The D5 note no longer appeared at revision 1.

### Path 2: control, built before start (verified by experiment)

`MODE=built-first`: build, `squeal start`, `squeal run --all --wait` (exit 0):

```text
Checkpoint ae01215d-... completed at revision 0: no known failures; 4 test files, 0 already current, 4 run now
Known failures: 0
Affected checks: 9 passed (5 tests, 4 test files loaded), 0 running, 0 queued
Slow tier: 3 test files; 3 current against dist/** as of revision 0. Squeal runs them when the agent pauses.
```

`why` showed PASS with run id `ccee96c1-...`, so the tests ran. The D5 "no declared artifact" note was absent. The only note was the observed-closure note for `bin.test.mjs`, which reads `dist/` through `fs` and not through a load. The slow-tier line is word for word the same as in path 1.

### The signal Squeal already has (read in source code, this worktree at `1a9eb308`)

`noArtifactNote` (`src/core/scheduler/slow-tier.ts:617`) fires when `inheritsAcrossWorktrees` (`src/core/slow/inherit.ts:18`) finds no declared input file, that is no existing file selected by policy `inputs` that is neither a test file nor under a slow glob. A declared glob that matches nothing on disk, as `dist/**` does in a fresh worktree, produces the same note as no declaration at all. The scheduler emits the note and still runs the tier. The status text renders the declared glob, not the files it matched (`src/core/state/slow-text.ts:97`), so "current against dist/**" cannot tell the two cases apart.

### The original nine (inferred)

The issue (filed 2026-10-16 by wjarka, labels `enhancement` and `friction`) names no repository, revision or session. Its shape matches cezarion: in a `git clone --depth 1` copy at `82f9757`, `packages/cezar/test/e2e` has 13 `*.test.ts` files and 11 of them reference `dist/`, through static imports (`application-update.test.ts:11-15`), `dist/index.js` as a spawned CLI (`delegation.test.ts:18`, `cockpit-ownership.test.ts:12`) and dynamic imports. `dist/` is gitignored. Its `squeal.config.json` marks `test:package` `slow: true` with `packages/cezar/dist/**` declared, and CI runs `npm run build` before `npm run test:package` (`.github/workflows/ci.yml:255,258`). The nine failures were not re-run. That would need `npm ci` and a full suite in a copy, and the exact revision is unknown, so whether they were exactly these mechanisms is not determined. A static-import file fails once at file level, as `import.test.mjs` did. Spawning and file-reading tests fail per test with messages that need not name `dist`. That is how one missing directory yields many shapes.

## Assessment against the vision and spec 004 (inferred)

- **Principle 1, silence is a feature.** One missing directory became 4 "first seen FAIL" transitions here and 9 in the issue. The agent had to rule each one out. That is noise about one fact. One line naming the precondition would be one transition.
- **Principle 2, results tied to code state.** The failing run is stored as `current` and closes a full-suite checkpoint. The slow-tier line claims "current against dist/**" against an empty match. A skip must not become a pass or a "no known failures": it is the existing D8 state "not run at this revision" with a reason. Whether a skipped tier completes a `run --all` checkpoint (exit 0, 1 or 3) is open.
- **Principle 5, existing tools validate.** A file-exists precondition decides nothing about the tests and only declines to start them. A precondition command is a second thing Squeal runs.
- **Principle 8, explicit autonomy boundaries.** A command precondition, and even more a build step, is code execution beyond the runner. It needs policy as visible as `nodeTest.argv`.
- **Spec 004 goal 8 and non-goal 1.** "Squeal never builds anything: the slow tier runs against what is on disk and says so", and building the artifact is a non-goal. The issue's open half, running a declared build step, contradicts both and would need a spec amendment by the human. The skip half fits goal 8's "says so" better than today's behaviour, which runs against nothing and reports "current against dist/**".

## Uncertainty and open questions

1. Not determined: the original repository revision and session, so the nine failure texts were not reproduced.
2. Presence is not freshness. A stale `dist/` passes an existence check. D8's "sources changed since" covers part of that. Whether a precondition should look further is a design question.
3. A declared-inputs-match-nothing signal exists today (D5's note). Whether a precondition is new policy or a reading of the existing `inputs` declaration is the spec's choice. The probe only shows the signal is available before the run.
4. Not tested: a Vitest slow tier (`slow.include`), a consumer in a turn (the idle waiter, D9), `stop.requireSlowSuite`, inheritance from a built worktree (D6 forbids it when the artifact is absent, by the same test), and a partially built `dist/`.
5. A project can guard its own suite, for example with a node:test `before` hook that skips when `dist/` is absent. Inferred, not probed. It would be per-project upkeep and would make Squeal report passes or skips that the runner, not Squeal, decided.

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/3 (read with `gh issue view 3 -R hearsay-tools/squeal`, 2026-10-16; no comments).
- Shipped CLI 0.1.199: `~/.claude/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs`.
- Source, this worktree at `1a9eb308`: `src/core/slow/classify.ts`, `src/core/slow/inherit.ts`, `src/core/scheduler/slow-tier.ts:550-625`, `src/core/state/slow-text.ts:97`, `src/core/types/policy.ts:161` (`NodeTestProject`); node:test e2e shape `test/e2e/slow-node-test.test.ts`, `test/e2e/slow-shape.ts`.
- cezarion: a `git clone --depth 1 file:///home/agent/projects/cezar` copy under `/tmp` at `82f9757` (2026-10-16), deleted after reading: `squeal.config.json`, `packages/cezar/package.json:27,41`, `packages/cezar/test/e2e/*.test.ts`, `.github/workflows/ci.yml:255,258`.
- `docs/vision.md` principles 1, 2, 5, 8; `spec.md` goal 8, non-goals, D5, D6, D8.
