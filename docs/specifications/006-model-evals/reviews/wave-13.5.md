# Wave 13.5 review: 006-62

FAIL `5640437a1c2c628e82943c3027442fc56beb51f5`: 3 proven blockers, no should-fix items, no nits.

Row 006-63, candidate `cand/006-62`, range `007f7431..5640437a`. HEAD matched the requested candidate. The tracked tree was clean during verification and the probes; this review changes only this file. Scope: `tasks/wave-13.md`, “006-62 the pilot's findings”; `tasks/006-62/notes.md`; spec 006 D3, D4, D10 and Testing. No board or product code is changed.

## Verification output

```text
$ git rev-parse HEAD
5640437a1c2c628e82943c3027442fc56beb51f5
$ git status --short
[empty]

$ npm ci --no-audit --no-fund
added 196 packages in 51s
[exit 0]

$ npm run lint
> squeal@0.1.190 lint
> biome check .
Checked 1276 files in 8s. No fixes applied.
[exit 0]

$ npm run typecheck
> squeal@0.1.190 typecheck
> tsc --noEmit
[exit 0]

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
Not run: skipped at the coordinator's request; FAIL on proven findings
```

Dependency installation, lint, typecheck and the separate probes used a scratch `HOME`, `TMPDIR` and npm cache. The requested full run was queued with the normal `HOME`, as the parent explicitly directed after confirming that the suite isolates its own fixtures. Its PATH contained scratch links to Node/npm/npx, `/usr/bin` and `/bin`, excluding real Claude and Codex binaries, as the parent permitted. Before it acquired the shared lock or printed a RUN header, the coordinator directed that it be skipped on the proven FAIL. Only this worktree's waiting flock was terminated, after matching both its cwd and exact command. No test file was observed failing under load or passing alone. The parent confirmed that the suite's existing fake-harness and temporary regrade CLI tests are permitted. No prohibited script was invoked directly, no real Claude/Codex session or eval cell was started, and no `npm run build` ran. The build is unverified by the explicit task restriction. npm also printed the `node-domexception` deprecation and six packages' install-scripts notice; installation exited 0.

## Blockers

### B1. Codex's copied launcher can select a package under the parent's home

**Proven.** `evals/lib/scratch.mjs:61-67`, called by `evals/bin/run-cell.mjs:189`; the relevant inherited variable is preserved by `cellEnv` at `scratch.mjs:34-43`. The copied format-4 launcher reads `XDG_DATA_HOME` at `plugins/codex/bin/squeal-launcher:62`.

The brief requires a bare `squeal` to resolve to the pin and the cell to stay away from the real home. Copying the pinned launcher's bytes does not pin the package it selects. `cellEnv` replaces `HOME` and `CODEX_HOME` but keeps the parent's `XDG_DATA_HOME`. Format 4 scans Pi and OpenCode packages there and selects the newest package across all harnesses. With a parent data directory under its home, the new bare Codex command reads that directory and can execute its package instead of the cell's pinned Codex package. `meta.json` nevertheless records `squealPath: "pinned"`.

**Scratch-only reproduction:** make a simulated host data directory and a fake cell. Put marker CLIs at these paths:

```text
<cell>/codex/plugins/cache/hearsay/squeal/0.1.190/dist/cli/squeal.mjs -> prints PINNED CLI
<host>/.local/share/squeal/pi/9.9.9/dist/cli/squeal.mjs             -> prints PARENT DATA CLI
```

Call `cellEnv({ HOME: <host>, XDG_DATA_HOME: <host>/.local/share, PATH: <node-dir>:/usr/bin:/bin }, cell)`, copy the candidate's real launcher with `squealBin("codex", cell, pin)`, and prepend its directory using `pathFirst`. Execute `sh -c 'squeal --version'` with that environment. Everything, including the simulated host, is under one disposable directory; no actual user home is accessed.

```text
exit: 0
stdout: PARENT DATA CLI
stderr: squeal: Codex has squeal 0.1.190 and Pi has 9.9.9; running 9.9.9. Run squeal update to bring them to one version.
```

**Worker-sized fix:** isolate the launcher's data-directory lookup in the cell, for example by overriding `XDG_DATA_HOME` to a scratch path in `cellEnv`, or otherwise guarantee the copied launcher can resolve only cell packages. Keep the intended Codex launcher condition. Extend the bare-command regression with a newer Pi/OpenCode marker package under a simulated parent's `XDG_DATA_HOME`; assert that it is not executed and the pinned package wins. Existing tests supply only `HOME` and `PATH`, so do not cover this route.

### B2. A foreign reply is charged to the first command, even when a later command was unanswered

**Proven.** `evals/lib/grade.mjs:67-84`, using `unanswered` from `evals/lib/squeal-text.mjs:27-33`.

Finding 2 requires credit only for commands Squeal answered. `unanswered` returns a count for the whole call. `gradeCell` discards that many actions from the front, assuming all foreign replies belong to the first Squeal commands. A call can use an absolute pinned CLI and a bare launcher in either order. The comment's assumption that one binary answers every Squeal command in a call does not hold for these supported command forms.

**Synthetic reproduction, through both `claudeTimeline` and `codexTimeline`:** after the requested invoice edit in a8, execute one call:

```sh
node /tmp/pin/dist/cli/squeal.mjs status --wait 60000; squeal run --slow --wait 60000
```

Give it Squeal's status output (`Revision: 1`, `Known failures: 1`, settled affected counts), followed by the host launcher's `squeal: no squeal@hearsay plugin is installed ...`, exit 1. End with `TESTS: fail`. The pinned status was answered; the bare slow run was not.

```text
claude: pulls=["run"], squealRunSlow=1, slow-through-squeal=true
codex:  pulls=["run"], squealRunSlow=1, slow-through-squeal=true
expected: pulls=["status"], squealRunSlow=0, slow-through-squeal=false
```

Thus the same false credit this row is meant to remove remains possible, and the status evidence is attached to the wrong action. The new positive mixed case uses separate tool calls, so it does not challenge the assumption within a call.

**Worker-sized fix:** retain enough command/reply association to handle mixed absolute-path and bare commands in either order. When the combined output cannot establish which action was answered, do not assign a specific slow run or wait credit by position alone. Add paired same-call regressions in both harnesses, including the reverse order. Preserve Squeal's own refusals as answered actions and every executed `squeal-run` as a retry-window invalidator.

### B3. Some of Squeal's own refusals are removed as foreign replies

**Proven.** `evals/lib/squeal-text.mjs:21-32`, applied to every executed Squeal action by `evals/lib/grade.mjs:69`.

The review brief explicitly requires Squeal's own refusals to keep counting. The worker also records that a usage error remains a pull. The new test recognizes several native replies, but `SQUEALS` is not complete: `formatWhy` emits `No check matches "<query>" in this worktree.` when a query has no match (`src/core/status/format-why.ts:23`), and `why` exits 1 (`src/cli/main.ts:179`). This text has no header or evidence, so `unanswered` discards the action. Similarly, `start --bad` returns the native `usage: squeal start [root]` with exit 2 (`src/cli/start.ts:19-21`), and is discarded.

```text
cmd: squeal why test/missing.test.ts
out: No check matches "test/missing.test.ts" in this worktree.
exit: 1
actual: squealPulls=0, squealWhy=0
expected: squealPulls=1, squealWhy=1

cmd: squeal start --bad
out: usage: squeal start [root]
exit: 2
actual: squealPulls=0
expected: squealPulls=1
```

The usage reply was also obtained directly from the committed plugin CLI with scratch HOME; no daemon or session was started. The no-match text is the exact native renderer's output, passed to the grader synthetically. Both are regressions from the baseline's command counts. Neither should provide current-result evidence, but they are still Squeal actions.

**Worker-sized fix:** recognize the native nonzero reply forms used by the graded commands, including unsuccessful `why` queries and usage-only replies, while keeping launcher failures foreign. Add reference cases in both harnesses; assert both the action counts and absence of fabricated current-result evidence.

## Should-fix

None beyond the blockers.

## Notes and what fits

- **Proven by scratch execution:** with only the simulated host PATH launcher present, both harnesses' bare commands reach the pin. Claude's wrapper executes its adjacent pinned CLI. Codex executes the copied launcher against the cell's `CODEX_HOME`. B1 identifies the additional inherited data-directory route, rather than a failure of PATH prepending itself.
- **Proven by synthetic grading:** launcher formats 3/4, command-not-found and nonzero replies without Squeal text are excluded in the ordinary single-call cases. Squeal's own `squeal run: unknown argument`, `squeal: no daemon running`, `No verdict:` and `Not retried:` replies still count. The executed run step is retained even when unanswered; R1's retry-window rule remains in place. B2 concerns association when a call mixes answered and unanswered commands.
- **Proven by in-memory library calls:** all 14 committed `.atomic.json` / `.atomic-variant.json` files, 1,047 cells, regrade with zero changed cells and identical measure objects. No results file was written, and no regrade CLI was invoked directly. This checks stored pilot records, not a fresh grade of every historical transcript; the worker's separate account of 16 a8 Claude measure corrections is not re-asserted as independently verified here.
- **Proven in source and synthetic tests:** the host-launcher boundary is inclusive at `20261014T154710Z`; only Claude is affected; `squealPath: "pinned"` resumes counting. Old-root marking remains. Flags and scoreboard exclude broken groups both as current runs and comparison history. The committed host-launcher marks are exactly Haiku in `20261014T164503Z-b3bbc5`, Haiku/Sonnet in `20261014T212723Z-dd4056`, and Haiku/Sonnet in `20261015T071439Z-65314d`. Codex remains counted. Alarms remain independent of the flag/scoreboard exclusion, as for the old-root condition.
- **Proven by a real temporary fixture, without a cell or harness:** using the committed Claude plugin CLI, `buildFixture`, the a11 knobs and `stageInherited`, the first named wait sees the calendar FAIL at high load. The staging check reads a stored failing run at 2.40 per CPU, then the load is 0.20. After applying a11's harmless reference edit, the calendar FAIL is still current at revision 1. `retry test/clock.test.ts --reason load` queues; the next named wait returns no known failures in 1.0 s. The daemon is kept throughout and stopped in cleanup. The calendar support file is unchanged. Its counter's key stays the same because a11's edit does not alter `src/clock.ts`; retaining `LEDGERLINE_CALENDAR_COLD_RUNS=2` changes no further calendar load after its two warm-up loads. Source inspection found no additional consumer view or retry request created by staging; a new consumer registers against current stored failures. Actual harness registration remains a first-pilot check.
- **Proven in source:** `CLAUDE_ALLOWED_TOOLS` and the base `evals/ledgerline` fixture do not change in this range. Only a9/a10's service knob copies the changed rates files. The failure advertises `node scripts/rates-service.mjs`, already covered by `Bash(node:*)`, and neither the start nor the port lookup needs an environment-variable expansion. The scratch-home port file is shared across the shell and daemon's different temp directories. Actual Claude approval behavior is unverified here because sessions are prohibited; confirm it in the parent's pilot.
- **Unverified, first pilot:** Claude Code's actual shell preserves the prepended PATH; actual Claude and Codex registration renders the inherited 2.40 failure as intended; Claude's bare rates-service start needs no prompt. These are not additional blockers.

## Inputs for the fix and next run

Repair B1, B2 and B3 before rerunning the pilot. Keep the 14 committed grade objects unchanged, the host-launcher boundary and pinned marker, R1's executed-run invalidation, and a11's named-wait-before-load-drop ordering. Re-review the repairs and their paired regressions on the exact new candidate; the coordinator owns integration, scoreboard regeneration and any spec/status amendment.

## Re-review 006-65

2026-10-15. PASS `fd8d37f4da580ab0c62d22c469a4d320a3070792`: no remaining blockers, no should-fix items, no nits in this narrow re-review. B1, B2 and B3 are closed.

HEAD matched the requested candidate and the tracked tree was clean during verification. Range: `90d44577..fd8d37f4`, the three repairs and worker notes. The rules in `tasks/006-62/notes.md` are the coordinator's decisions. Scope is the three blockers above, the judge invocation affected by B1, R1, the host-launcher condition, a11 staging, and the 14 committed atomic grades. This section is the only repository change; `docs/board.md` is untouched.

### Verification output

```text
$ git rev-parse HEAD
fd8d37f4da580ab0c62d22c469a4d320a3070792
$ git status --short
[empty]

$ npm ci --no-audit --no-fund
added 196 packages in 19s
[exit 0]

$ npm run lint
> squeal@0.1.190 lint
> biome check .
Checked 1271 files in 1056ms. No fixes applied.
[exit 0]

$ npm run typecheck
> squeal@0.1.190 typecheck
> tsc --noEmit
[exit 0]

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/3abc575d-cd52-4150-acae-2fb92d6a78f1

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/3abc575d-cd52-4150-acae-2fb92d6a78f1/test/fixtures/scheduler/.tmp/10da3a83-ea3e-41ee-b0b0-dcf196ad8c56/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/3abc575d-cd52-4150-acae-2fb92d6a78f1/test/fixtures/scheduler/.tmp/9c385a56-5a0f-459f-9e63-e4566b2211b3/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 4016183
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  616 passed | 1 skipped (617)
      Tests  5035 passed | 121 skipped (5156)
   Start at  10:53:27
   Duration  619.36s (tests 98%, import 2%)

    Isolate  617 workers spawned · ~123ms startup each (spawn + environment, per file)
             at least ~18.78s faster with isolate: false — reuses workers across files instead of one per file
[exit 0]

$ HOME=<scratch> node --import tsx <scratch>/probes.mts
B1: Claude and Codex, each with a newer simulated host Pi and OpenCode package: PINNED CLI, exit 0
B2: both harnesses, forward/reverse, answered slow run in either order, Node missing file, ambiguous in either order: expected pulls, waits and slow-run measures
B3: both harnesses, why no-match and start usage: one pull, no new evidence
R1: both harnesses, unanswered executed run invalidates the retry window
B3 committed CLI: start --bad exits 2 with native usage
Judge: exactly four changed environment keys; fake process receives unchanged args/stdin/cwd layout and scratch cleanup
Atomic: 14 committed files, 1047 cells, zero changed cells; cell and measure objects identical
[exit 0]

$ HOME=<scratch> node <scratch>/regressions.mjs
a11: named calendar wait at 2.40 precedes drop to 0.20; cold=2; daemon retained; stored load checked
Host-launcher condition: inclusive boundary, Claude-only, pinned escape and old-root marking retained
[exit 0]
```

Dependency installation, lint, typecheck and the independent probes used scratch HOME and npm cache paths. The full run used the original, unmodified HOME, with PATH restricted to scratch links for Node/npm/npx, `/usr/bin` and `/bin`; both real `claude` and `codex` were absent, including when resolved through `npx`. The suite's own temporary fake-harness tests remained enabled. No real Claude/Codex session, live eval cell, directly invoked prohibited eval CLI, or `npm run build` ran. Build verification is **unverified** by the task's explicit prohibition. The direct native CLI probe was only `start --bad`, in scratch HOME; it starts no daemon.

The independent run took 619.36 seconds. Sampled one-minute host loads during the run were 7.76 to 12.07 on 24 CPUs; the queue had earlier seen much higher load. No test file failed, so no file needed an isolated rerun and there is no fail-under-load/pass-alone file to name. The printed Git worktree-repair, stale-process cleanup and experimental type-testing notices did not fail the run.

### Previously blocking findings

- **B1, closed, proven.** `evals/lib/scratch.mjs` overrides all four XDG base directories with defaults under the cell's scratch HOME. Repeating the earlier marker-package probe for both harnesses, with both Pi and OpenCode at simulated host version 9.9.9, executes only the pin. The copied Codex launcher and Claude's adjacent-CLI wrapper are preserved. All environment inputs and marker packages were disposable scratch files.
- **B2, closed, proven.** `commands.mjs` retains each command's CLI identity; `squeal-text.mjs` associates foreign replies with matching identities and returns unknown for ambiguous matches. `grade.mjs` follows those per-command decisions. Through both harness timeline parsers, pinned status then unanswered bare slow run, and the reverse, yield only a status pull, one wait and no slow credit. An answered pinned slow run beside an unanswered bare status, in either order, yields only run credit. Node's missing-module reply is charged to the named CLI. In the ambiguous bare/path-launcher case, in either order, there are no pulls, waits, waits-after-edit or slow-run credits. The Squeal evidence survives once as a run's evidence, as the coordinator decided. Every executed run still contributes its `squeal-run` invalidator.
- **B3, closed, proven.** Native no-match `why` and usage-only `start` refusals count once in both harnesses and introduce no current evidence beyond the opening registration. The committed CLI independently confirms the usage text and exit 2. The repair also covers multiple-match `why`, unavailable status and other native usage replies; the launcher's missing-Node refusal is explicitly foreign. The paired committed tests exercise these forms in both harnesses.

### Named regression boundaries

- **Judge invocation, proven.** Against `90d44577`, a synthetic parent environment passed through the old `cellEnv` and the current `judgeEnv` differs at exactly `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME` and `XDG_CACHE_HOME`. `judge.mjs` itself has no diff. Running `claudeRunner` with Node as a fake command confirms unchanged argument order, stdin, scratch working-directory layout and removal. No judge session ran.
- **R1, proven.** Both harnesses still miss `claim-after-retry` after an unanswered executed `squeal run` intervenes between a queued retry and settled passing status. Mixed and ambiguous calls retain the executed-run step too. Additional end-to-end synthetic grades in both harnesses and both ambiguous command orders still miss `claim-after-retry` after that run.
- **Host-launcher condition, proven.** The inclusive `20261014T154710Z` boundary, Claude-only mark, `squealPath: "pinned"` escape and earlier old-root mark all hold. This repair changes none of the condition implementation.
- **a11 staging, proven in source and injected library calls.** The staging and run-cell code are unchanged by the repair. The named calendar wait runs at 2.40 before the load drops to 0.20 and the all-files run; cold count stays 2, the stored failing load is checked, and no stop or second start occurs. The earlier review's real-fixture staging proof is not reopened by the XDG-only environment change.
- **Atomic grades, proven in memory.** `regradeAtomic` reports zero changed cells across all 14 committed `.atomic.json` and `.atomic-variant.json` files, 1,047 cells. Every returned cell object and scenario declaration equals its committed counterpart, including every measure. Regrade provenance metadata is not a grade and can be added by the library. No result file was written and no regrade CLI was directly invoked. This checks stored pilot records, not fresh grading of every historical transcript.

No new blocker or input for a repair wave. Actual harness behavior and the first-pilot confirmations listed in the original review remain outside this session's permitted scope.
