FAIL 29ef2f05303be1ab83ab89a9e34420e8514c2709

Four proven blockers, zero should-fix items, three proven notes.

Candidate: `cand/0.1.240`, pinned to `29ef2f05303be1ab83ab89a9e34420e8514c2709`.
Range: `63c6cd37e..29ef2f053`. Row 014-13 reviews wave 2 against amended spec 014 D1, D7, D8 and D10 and `tasks/wave-2.md`. No product code changed. The review uses the last three wave 2 amendment lines in `status.md`.

## Verification output

Checks and fixture probes ran at the pinned candidate. The tracked tree was clean throughout product verification. Only this report was added afterward. No `squeal ps` probe used the real HOME, process table, daemon or socket. Each probe used a disposable fixture directory, which it removed.

```text
$ git rev-parse HEAD
29ef2f05303be1ab83ab89a9e34420e8514c2709
$ git status --short
(no output)

$ npm ci
added 196 packages, and audited 197 packages in 12s
1 high severity vulnerability
(exit 0)

$ npm run lint
> squeal@0.1.240 lint
> biome check .
Checked 1638 files in 869ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.240 typecheck
> tsc --noEmit
(exit 0)
```

`npm run build` was not run, as the dispatch requires. Local build and bundle drift are **unverified**, not a finding against the candidate. CI run `39618356847` is supplied context; it does not replace this review's independent run.

### Independent full run

The run held the shared host lock. UTC times and load were captured inside the lock, before and after Vitest.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4

2026-10-21 14:57:41 UTC: start load 30.17 37.27 38.06
Test Files  4 failed | 809 passed | 1 skipped (814)
     Tests  6 failed | 7067 passed | 10 skipped (7083)
  Duration  1114.26s
2026-10-21 15:16:16 UTC: end load 15.36 21.20 27.70
(exit 1)
```

The failed files and errors were:

- `test/cli/ps.test.ts`: the outside-repository case expected exit 2 and got 0. Its fixture directory is inside the real repository in this worker's environment. N3 records the test assumption.
- `test/scheduler/slow-slot-fair.test.ts`: a teardown hook exceeded 10,000 ms, then the next case observed 445 probes instead of 431. This is a named load-sensitive file in the dispatch.
- `test/scheduler/backlog-slots-overhead.test.ts`: 20,499.38 ms exceeded its ratio bound of 20,474.85 ms. This is also a named load-sensitive file.
- `test/e2e/shipped-plugin.test.ts`: the Claude Code and Codex cases both timed out waiting for a passing baseline.

All other files, including the flag, snapshot, cost, render and Darwin tests, passed or had the reported skip. The full run remains failed. Isolated recovery does not change that result.

### Every failed file rerun alone

I kept the shared host lock for the sequential reruns. Each command selected exactly one failed file with `--maxWorkers=4`. The following are the exact summaries, with start/end one-, five- and fifteen-minute load:

| Command | UTC start to end | Load start to end | Output | Exit |
| --- | --- | --- | --- | --- |
| `npx vitest run test/cli/ps.test.ts --maxWorkers=4` | 15:18:43 to 15:18:46 | `10.36 16.91 25.14` to `9.61 16.64 25.01` | `Test Files 1 failed (1)`; `Tests 1 failed \| 19 passed (20)`; `Duration 2.13s` | 1 |
| `npx vitest run test/scheduler/slow-slot-fair.test.ts --maxWorkers=4` | 15:18:46 to 15:18:50 | `9.61 16.64 25.01` to `10.04 16.62 24.96` | `Test Files 1 passed (1)`; `Tests 4 passed (4)`; `Duration 2.84s` | 0 |
| `npx vitest run test/e2e/shipped-plugin.test.ts --maxWorkers=4` | 15:18:50 to 15:20:56 | `10.04 16.62 24.96` to `14.49 15.71 23.54` | `Test Files 1 failed (1)`; `Tests 2 failed \| 5 passed \| 1 skipped (8)`; `Duration 125.73s` | 1 |
| `npx vitest run test/scheduler/backlog-slots-overhead.test.ts --maxWorkers=4` | 15:20:56 to 15:22:31 | `14.49 15.71 23.54` to `12.04 14.84 22.49` | `Test Files 1 passed (1)`; `Tests 1 passed (1)`; `Duration 94.56s` | 0 |
| `TMPDIR=/tmp npx vitest run test/cli/ps.test.ts --maxWorkers=4` | 15:22:31 to 15:22:34 | `12.04 14.84 22.49` to `11.23 14.63 22.38` | `Test Files 1 passed (1)`; `Tests 20 passed (20)`; `Duration 2.19s` | 0 |

The two named scheduler files passed alone at lower load. The CLI result is an environment-dependent fixture failure, confirmed by changing only TMPDIR to a directory outside the repository. The e2e file failed alone with the same two passing-baseline timeouts. Its cause and attribution to this range are **unverified**. It is not called a load flake or a passing check. This review makes no successful shipped-plugin integration claim.

The fixture probes used `npx tsx` to call the production stages and CLI with injected sources, paths and waits. They completed with exit 0 and printed the reproduced failures below. Scratch scripts were removed before the report commit.

## Blockers

### B1. Blocker / proven: the reduced second table breaks the host-wide flag rules

Locations: `src/core/ps/snapshot.ts:75`, `src/core/ps/snapshot.ts:130`, `src/core/ps/flags-files.ts:217`, `src/core/ps/flags-processes.ts:81`.

D7 requires `leftover-temp` to exclude directories used by any process, and requires an orphan `waiter.mjs` to be flagged. `followed()` keeps daemons, attributed test processes and descendants, unowned marked processes and consumer harnesses. Ordinary processes and unmarked waiters are not followed. Both file-use detection and waiter detection then treat this limited CPU table as the host table.

A probe used production `createProcSource`, `takeSnapshot`, `flag` and `psCommand` over a fixture `/proc`. Pid 700 was a live shell with its cwd in an old `squeal-e2e-in-use` directory. Pid 701 was an unmarked Node waiter whose parent 999 was absent. Both were present in the first host table. The second table was empty. The snapshot listed the shell's directory as a leftover and listed no orphan. The real CLI flag path, without a flag stub, returned:

```text
real ProcSource snapshot: {"leftovers":["<fixture>/tmp/squeal-e2e-in-use"],"orphans":[]}
real flags CLI --leftovers: {"code":0,"stdout":"<fixture>/tmp/squeal-e2e-in-use\n"}
```

A control using the full model table correctly protected the directory and produced `orphan-waiter` for pid 701. Thus this is a stage integration failure, not an unavailable platform read. The printed cleanup pipeline would delete a directory the rule explicitly excludes.

**Fix, one snapshot repair:** preserve host process coverage for flag-only reads independently of the CPU measurement subset. Include waiter candidates and enough parent identity to distinguish a live parent from a missing one. Give leftover-use checks all relevant user processes. Keep the bounded measurement read, or remeasure its budget if the strategy changes. Add assembled-snapshot and real-flag CLI regressions for a live ordinary cwd, an argv reference, a genuinely unused directory, a gone-parent waiter and a live-parent waiter. Do not weaken the D7 unit rules to fit the subset.

### B2. Blocker / proven: live paths with spaces, quotes or equals become leftovers

Location: `src/core/ps/flags-files.ts:225`.

This remains wrong even with a full process table, so B1 alone does not repair it. `cwds()` and Linux `cmdline()` already return path strings and individual arguments. `usedPaths()` tokenizes them again with a regex that stops at whitespace, quotes, `=` and `:`. These are valid characters in directory names.

A full-table fixture probe made each directory older than an hour and set a live shell's cwd to that exact directory. Results:

```text
squeal-e2e-a b       flagged as leftover: true
squeal-e2e-it's      flagged as leftover: true
squeal-e2e-a=b       flagged as leftover: true
squeal-e2e-normal    flagged as leftover: false
```

D7 excludes a directory used as a cwd or in an argument. Correct shell quoting in the printed command cannot repair an incorrect classification: the newline-delimited cleanup command can remove these directories intact.

**Fix, one file-use parser repair:** preserve cwd and argv boundaries. Match candidate paths and their descendants without parsing a path as shell text; account for option prefixes without treating delimiters inside a directory name as boundaries. Keep the no-newline rule. Add cwd and argv cases with spaces, both quotes, equals and colon, plus prefix neighbors, for top-level fixture directories and key directories. Retain the 3,500-directory cost check.

### B3. Blocker / proven: unknown worker CPU, memory and swap print as zero

Locations: `src/core/ps/render.ts:188`, `src/core/ps/render-units.ts:17`, `src/core/ps/snapshot-shape.ts:64`.

D8 says an unread value is `null`, is named in `unknown`, and never reads as zero. The row brief explicitly requires: "a `null` prints as unknown, never 0."

An empty descendant list legitimately sums to zero. `processLines()` combines that zero with each nullable worker value using `known()`, which drops nulls. A real fixture worker that vanished during the snapshot had:

```json
{"pid":801,"cpuPct":null,"privateBytes":null,"swapBytes":null,
 "descendants":{"count":0,"cpuPct":0,"privateBytes":0,"swapBytes":0}}
```

Its text row printed `0%`, memory `0` and swap `0`, although the shape retained all three nulls. A macOS worker with no descendants similarly prints swap `0` although the source cannot read per-process swap. The existing null-render test covers a daemon without test processes, so it misses this path.

**Fix, one render repair:** when there are no descendants, render the worker's own values directly. Define how a row with descendants signals a partial sum, without presenting an entirely unread worker value as a measured zero. Add render regressions for a vanished worker and an RSS worker with null swap, both with zero descendants. Leave the reviewed measurement module's sum contract unchanged unless the coordinator approves a separate type or contract change.

### B4. Blocker / proven: a failed macOS process scan reports a successful empty host

Location: `src/core/ps/darwin.ts:193`.

The runner returns null when `env ... ps` fails, is absent or times out. `#read()` substitutes an empty string and returns an empty table. The snapshot cannot distinguish this from a host with no daemon. D8 and D10 require unavailable data to be named as unknown; vision principle 2 forbids an unread state posing as known. D1 already gives a failed snapshot exit 3.

A fixture-only probe injected a runner that returned null for `ps` and used normal finite OS values. Production `psCommand(["--json"], ...)`, with the real flag function, returned:

```json
{"code":0,"stderr":"","squeal":{"daemons":0,"testProcesses":0,
 "cpuPct":0,"privateBytes":0,"swapBytes":0},"psCalls":1}
```

`unknown` listed the expected unavailable macOS lock, mark and host fields. It contained no process-table failure. A text call would assert `No Squeal daemon runs.` The existing failed-command unit test explicitly expects an empty table and does not test the CLI consequence.

**Fix, one macOS failure repair:** preserve failure of the process enumeration. Either propagate a contextual failure to D1's exit-3 path, or introduce an approved explicit unavailable-scan result that cannot be mistaken for zero daemons. Test a failed first and second `ps` call through the snapshot/CLI, and keep a successful empty table distinct. Do not make all partial host-field failures fatal.

## Should-fix

None beyond the bounded repairs above.

## Notes

### N1. Note / proven: two duration policies appear in one output

Locations: `src/core/ps/flags-text.ts:24`, `src/core/ps/render-units.ts:67`.

The reason formatter uses `45 s`, `119m`, `2h 05m`; the column formatter uses `45s`, `1h`, `2h`. Thus the same age can look different between a row and its reason. This does not break the spec, which leaves column layout to the worker. Prefer one duration policy with an explicit compact-column option if this is later unified. No formatter repair is needed to resolve this review's blockers.

### N2. Note / proven: the pinned board still shows the implementation running and this review planned

Location: `docs/board.md:941`.

Rows 014-10 to 014-12 say `running`; row 014-13 says `planned`. The candidate contains their implementation and this review is dispatched. The coordinator should update these rows when it records the verdict. The reviewer did not edit the board.

### N3. Note / proven: the outside-repository CLI fixture depends on TMPDIR

Location: `test/cli/ps.test.ts:131`.

The test creates `nowhere` below `snapshotHost()`'s `os.tmpdir()` directory. In this Cez worker, `os.tmpdir()` is `/home/agent/projects/squeal/.ai/cezar/t/2976ee91`, which is inside `/home/agent/projects/squeal`. Production root discovery correctly finds that enclosing repository. The test therefore expects exit 2 for a directory that is inside a repository. It fails alone in the inherited environment and all 20 CLI tests pass with `TMPDIR=/tmp`.

Use an explicitly outside-Git fixture for this case, such as the existing `outsideGit()` helper in `test/harness/bundle-helpers.ts`. The current failure is test placement, not proof that `--repo` accepts a directory outside a repository.

## What fits, and the coordinator's six questions

- **D1 and wiring, proven by source and fixtures:** `main.ts` routes `ps` directly to `psCommand`. The default flag function is the real `flag`; `linux` selects `createProcSource` and `darwin` selects `createDarwinSource`. Options, usage exit 2, an unsupported platform's exit 3, thrown snapshot exit 3, and exits 0/1 from the resulting flag count are covered. `--json` writes only the shape to stdout. `--repo` outside a repository is a usage error. The current repository is first; other repositories sort by sampled CPU. Host totals and the pool stay global. Stale sockets are narrowed through the current repository's lock ids; orphans, pool marks and leftovers are dropped. `userConfigPath(env)` and an unset runtime directory follow the amended contract.
- **Coordinator item 1, proven:** `leftover-temp` contributes one grouped file flag to `shape.flags`, then exit 1. The amended D7 and D8 agree. The illustrative directory count does not become thousands of flags. `--leftovers` itself has no two-second wait and exits 0 after printing the paths. B1 and B2 concern which paths qualify.
- **Coordinator item 2, proven timing feasibility; live-host behavior unverified:** the 5-second heartbeat can lie inside a 2-second sample window. For example, samples at 4 and 6 seconds see heartbeats at 0 and 5 seconds. The existing fixture uses precisely this phase, retaining the dead consumer across the beat, and the rule fires. There is no requirement for two beats inside the window. It will miss a retained consumer when the window contains no beat, and a fully hung daemon has no advancing beat; `hung` covers the latter. This follows the amended D7 rule. Source inspection shows `lifecycle.ts:292` writes the beat before the harness-drop step, contrary to the flag helper's comment that it drops first. A real failed cleanup was not induced; no live daemon was probed.
- **Coordinator item 3:** N1 records the two duration policies. They are a presentation note, not a blocker.
- **Coordinator item 4, proven coverage limit:** the CLI and most snapshot tests inject `noFlags` or made-up findings. The cost test calls real `flag`, but checks process counts, phases and budgets, not the resulting flag semantics. Unit tests give the flags full model tables. This leaves the assembled table/flag contract untested and allowed B1 through. It is insufficient as the sole evidence for the real flag path. The B1 repair needs real-flag snapshot/CLI cases now; shipped-bundle and real-daemon proof remain 014-14.
- **Coordinator item 5, proven:** the 10,000-entry size cap is an explicit D7 amendment. The size function returns null past the cap, the count and complete path list stay available, and `unknown` names `files leftover-temp bytes`. The lower-cap fixture checks this boundary. The 3,500-directory test exercises the walk; the complete snapshot cost test covers 650 processes, 25 daemons and store reads. A live whole-command cost measurement remains 014-15, not this review.
- **Coordinator item 6, proven limitation accepted in D10:** macOS splits commands at spaces. Roots and executable paths with spaces can read wrong. The spec names this limit, and the fixture asserts the split. This review does not reopen that accepted platform tradeoff. No code or test ran on a Mac.
- **D7 healthy cases, proven by test inspection:** each of the 18 flags has a flagged fixture and a healthy counterpart across `flags-daemons.test.ts`, `flags-processes.test.ts` and `flags-files.test.ts`. They include existing roots/gitdirs and bundles; a current release and a live old-version holder; short loser/successor waits and two waiters; a heartbeat that recovers; recent departure, idle and use; a consumer gone only since the last beat; a young test daemon; a mark seen only once or for less than one second; direct children and young or unmarked overdue candidates; a live waiter parent; an owned socket and an ownerless listener; a fresh pool mark; daemon-owned permits; live keys, fresh directories, cwd and argv uses. The two information states have dedicated fixtures. B1 and B2 show why isolated healthy fixtures do not prove assembled behavior.
- **Unknowns, proven coverage with B3/B4 exceptions:** missing lock state names `no-lock`, `hung`, `foreign-permit` and `stopping`; missing marks name orphan/overdue; an unread daemon token suppresses orphan claims; unread cwds suppress the leftover rule. Host load, pressure, memory, swap and CPU time, pool holders, process costs, starts, daemon identity and last use have grouped unknown entries. Structurally absent values such as a checkout harness or an unrequested descendant list are distinct from unread values. B3 concerns rendering retained nulls, and B4 concerns losing the failed scan before the shape can name it.
- **Read-only, proven by source inspection and fixture probes:** the new command and flag modules do not call a daemon starter, store writer, signal function, socket connector or an end command. The store stage remains the previously reviewed read-only SQLite reader. Darwin spawns only through its runner, without a shell. End-command paths use the shared `shellQuote`; fixtures cover a space and single quote in `stop` and `rm` paths. The cleanup pipeline excludes newline names. The live-store/listening-socket no-side-effects integration remains 014-14; no claim is made that this wave already proves it.
- **Scope, proven by range inspection:** the three workers' implementation files are disjoint. The coordinator's common shape change adds only `PsFileFlag.reason` and its shape fixture key. `source.ts`, `proc.ts`, `model.ts`, `discover.ts`, `work.ts`, `measure.ts`, `processes.ts`, `host.ts`, and the reviewed base fixtures have no delta. No daemon code changes in this range. The range also contains coordinator docs and release/version/bundle changes. No product file was edited by this reviewer.

## Inputs for the repair and wave 3

1. Repair B1 to B4 on the candidate before landing. Explain or repair the repeated shipped-plugin baseline failures before claiming that integration passes. Re-review those repairs and their integration delta. Keep the reviewed discovery, identity, measurement and store contracts intact unless a coordinator-approved seam change is necessary.
2. Add real-flag assembled tests before relying on e2e. Assert the complete snapshot's positive and healthy file/process flags, including the process table's reduced measurement path. Keep the 650-process cost check after widening any flag reads.
3. Row 014-14 must exercise the shipped bundle, real flags and isolated HOME/runtime/temp paths beside a real daemon. Cover serving identity, current test processes, stale sockets after SIGKILL, root-gone under SIGSTOP, unchanged live-store bytes/mtime and no accepted socket connection. Include the safe leftover cases from B1/B2 in the command path.
4. Row 014-15 still owns the real-host CPU/wall budget, comparison with host tools and Linux dogfood. macOS remains fixture-tested and explicitly untested on a Mac.
