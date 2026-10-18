# Research: what the slow tier is for, and when its results can reach the agent

Row 004-74. Brief: `slow-tier-role-brief.md`. Researcher, 2026-10-18, Opus 5.5. Examined: Squeal at `b08779a8` (0.1.215), cezarion at `51190d494` (2026-10-18), Node 24.21.0, Vitest 5.0.3, TypeScript 7 in cezarion, Linux 6.8 on 24 CPUs. Probes: `probes/slow-tier-role/` (throwaway; scratch clones under `/tmp`, scratch HOME, XDG and package caches, explicit git identity; run only at a 1-minute load of 7 to 20). Eval cells under `/tmp/squeal-evals-1001/` were read only.

## Questions answered

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | What the slow suites test | Three kinds. **Build output:** Squeal's `test/e2e` (17 files, the committed `plugins/*/dist`) and cezarion's `test:package` (13 files, the gitignored `packages/cezar/dist` and `web/dist`). **Self-preparing:** cezarion's 77 browser specs, which install, build their own bundle from the current sources into an ignored mirror and boot one server and one Chrome in `globalSetup`. **Only slow:** the eval fixture's `test/slow`, which needs nothing and tests the sources live. None runs a dev server. This repository declares no slow tier today. | read in source code |
| 2 | When agents build | Rarely, and at the end. 0 builds in 816 eval cells (the fixture has none). In dogfooding, 5 of 9 sessions rebuilt: 4 because the prompt said so, 1 (sq1) because this repository's instructions say the committed bundles must match the build. Here, 6 of the last 98 `src/` commits carry rebuilt bundles; the bundles land in 23 separate `build: bundles for 0.1.x` commits at candidate time. Cezarion sessions in fresh worktrees never built (#3, #35). On 0.1.199's wording, 39 of 40 a2-slow sessions ended with the slow file current. On 0.1.215's, 13 of 19 did. | verified by experiment (tallies), read in source code |
| 3 | What a rebuild invalidates | Keys are content hashes, so a rebuild that reproduces the bytes re-runs nothing (both repositories). A real edit re-keys today every file that declares the artifact (17 of 17 here, 13 of 13 in cezarion). Keying each spec by the files it actually opened would re-key 13, 12 and 5 of 17 here (98%, 97% and 37% of e2e time) and 8 of 13 in cezarion (about 87% of time). The bundles and the CLI entry each load nearly all the code. | verified by experiment |
| 4 | Mid-turn cost to the fast lane | An edit's tier needs no permit (001 D11), so a slow lane never queues it. CPU contention alone left the median unchanged, within 5%, at loads 9 to 10 and 14 to 16. The tail grew: p90 +6% to +11%, maximum +7% to +59%, on one 4-file tier. | verified by experiment, read in spec |
| 5 | The options | Recommend **(a)**: keep the idle and explicit triggers and the name `slow`, and change the text to say what a build-output tier has and has not tested. (b) adds cost and buys about nothing, because builds come at the end. (c) loses the only push path, the idle drain, which half the agents depend on under today's wording. (d) puts 90 cezarion files back into the fast lane, or leaves them uncovered. | inferred from 1 to 4 |

## Findings

### 1. What each slow suite needs and tests (read in source code)

| Suite | Needs before it runs | Tests | Ports |
| --- | --- | --- | --- |
| Squeal `test/e2e/*.test.ts`, 17 files (Vitest) | `npm run build` output committed as `plugins/*/dist`; fixture installs of Vitest, uv and pytest, OpenCode, Pi (`test/e2e/install.ts`) | the built bundles: `copyPlugin` copies the tracked plugin files, and hooks run `dist/<hook>.mjs` from the copy (`test/e2e/plugins.ts:61`, `:154`) | none fixed: unique sockets per fixture |
| cezarion `test:package`, 13 files (node:test, `slow: true`) | `npm run build` (tsc, inline-contract); `package-cli` also needs `web/dist` | the built CLI: `dist/index.js` and spawned processes (#35: "dist/ is missing; test:package runs after npm run build") | `serve-port` fixed `::1:4321`, `task-cli` check-then-bind (`slow-suite-runtime.md` 4) |
| cezarion `packages/web/e2e/*.e2e.ts`, 77 files (Vitest, `slow.include`, `maxWorkers` 1) | `globalSetup` runs `.ai/scripts/test-env-up.sh`: `pnpm install --frozen-lockfile && sh .ai/scripts/build-e2e.sh` when its source fingerprint changed, a server on preferred port 4321, agent-browser and Chrome | a production-mode bundle built from the current sources into `.ai/qa/build/cezar/` (`build-e2e.sh`, cezarion#649, #1087), served and driven through a real browser; `fileParallelism: false` | one shared server and browser session |
| eval `ledgerline/test/slow/ledger.test.ts` | nothing | sources (`inputs: {"test/slow/**": ["src/**"]}`) | none |

So the slow suites split into build-dependent ones (Squeal e2e, cezarion package) and ones that are only slow (browser, eval). The browser suite is keyed on its sources and never waits for an agent's build. Two facts about this repository, outside the brief's options: its `squeal.config.json` declares no `slow` key (dogfoods added one uncommitted), so `test/e2e` runs in the fast lane; and its `test/e2e/*.test.ts` inputs name `plugins/claude-code/**` and `plugins/codex/**` only. The traces show `pi`, `pi-update` and `opencode` opening `plugins/pi` and `plugins/opencode` files, so a rebuild of those plugins alone re-keys none of those specs (inferred from the config and the traces, not run through a daemon).

### 2. When agents build, and whether slow results were current

- **Evals** (verified by experiment, `logs/a2-tally.txt`, `logs/a2-by-run.txt`): 816 cells, no `npm run build`, `vite build` or `tsc -p` command; the `tsc` hits were `tsc --noEmit` typechecks. The a2-slow cells by run:

| Eval run | Squeal | Primer | Cells | Agent ran `run --slow` | Slow file current at the end |
| --- | --- | --- | --- | --- | --- |
| `07d7ab`, 2026-10-16 | 0.1.199 | "before you say the task is done, run ..." in every repository | 40 | 40 | 39 |
| `bcdbec`, 2026-10-18, still running | 0.1.215 | follows `stop.requireSlowSuite`, off here | 20 | 10 | 13 of 19 finished |

  The fixture has no build, so these cells measure an only-slow file, not a build.
- **Dogfooding** (read in `lessons.md` and `probes/dogfood*/prompts/`): 5 of 9 sessions rebuilt. Four prompts asked for it (cz2, sq2, dogfood2 sq1, dogfood3 sq1). The first sq1's prompt did not: the agent rebuilt mid-turn because the repository's own gate says `plugins/*/dist` must match the build. sq1 rebuilt mid-turn at r5 to r7 and ended with 10 slow files pending, never run (defect 1, since fixed by 004-29). sq2 rebuilt at its end. Its slow tier started 7 min after the turn ended, and the `policy.test.ts` failure reached the agent with the next prompt, 13 min after the turn.
- **This repository's history** (verified by experiment, the last 400 commits, 2026-10-16 to 10-18): 98 commits touch `src/`, and 6 of them touch `plugins/*/dist`. 23 commits touch only the bundles, all `build: bundles for 0.1.x`, made by the coordinator for a candidate. Workers' sessions run e2e against bundles older than their sources.
- **Cezarion** (read in #3, #35): fresh worktrees with dependencies installed and no `dist`. The slow tier ran the package files against a missing build: 38 failed checks across 10 files, and a docs-only session detoured into a build.

### 3. What a rebuild invalidates (verified by experiment)

**Squeal.** A scratch clone's `npm run build` (2.7 s) reproduced the committed 74 dist files. Each edit was rebuilt and diffed (`logs/changed.*.txt`). Each `test/e2e` spec was traced under `strace -f` for the plugin files it opened (`logs/trace-map.json`):

| Edit | Dist files changed | Re-keyed today | Re-keyed by traced closure | Their share of traced e2e time |
| --- | --- | --- | --- | --- |
| a comment in `src/core/state/slow-text.ts` | 0 | 0 | 0 | 0% |
| an unused export in `src/harness/codex/output.ts` | 0 (tree-shaken) | 0 | 0 | 0% |
| the slow-tier line's text (`slow-text.ts`) | 25: 8 claude-code, 8 codex, 7 opencode, 2 pi | 17 | 13 | 98% |
| pytest config reading (`src/runners/pytest/adapter-config.ts`) | 4: each plugin's `cli/squeal.mjs` | 17 | 12 | 97% |
| the Codex Stop decision (`src/harness/codex/output.ts:59`) | 2: codex `stop.mjs`, `stop-slow.mjs` | 17 | 5 | 37% |

The daemon is `dist/cli/squeal.mjs`, which 12 of the 17 specs start, so any core or runner edit reaches it. The narrow case is an edit inside one harness. Of the 98 recent `src/` commits, none stayed inside one harness: 62 were `src/core` only, 16 `src/cli`, 7 `src/harness/shared`, 12 several areas.

**Cezarion `test:package`.** A scratch clone's `npm run build` (3.5 s, 834 files, 267 `.js`) rebuilt twice with no change: 0 files differed. Defect 14's `.d.ts` reordering was seen across worktrees; it did not recur within one. One added export changed 3 files in a leaf module (`open-url.js`, `.js.map`, `.d.ts`). In `paths.ts` it changed 5, two of them other modules' `.d.ts`. A traced `test:package` run (`logs/rekey-cezar.txt`) found the files each spec opened:

- 239 to 267 of the 267 `.js` for `application-update`, `cockpit-ownership`, `serve-port` and `task-cli`;
- every dist file for `cursor-print`, `delegation` and `package-cli` (they copy or pack `dist`);
- 2 for `release` and `release-snapshot`;
- none for `alias-bin-exports`, `stop-child` and `tick-writer`.

Both edits re-key the same 8 of 13 specs. The 5 spared files took 21 of 161 s in the 2026-10-08 timings (`slow-suite-policy.md` 2), about 13%. The CLI entry imports nearly the whole package, so per-file keys cannot narrow below that.

**Browser specs.** These are keyed on sources and build their own bundle, so an agent's rebuild touches none of them. Every web source edit re-keys all 77, whose CI time is about 28 min (`probes/issue-4-ranking/ci-durations.json`). Whether a Vite chunk-level closure would narrow that was not determined: no browser run was possible in the scratch HOME within the budget. `issue-4-signals.md` found that every stored closure holds every source path; its token ranking is row 004-73.

**What a kept baseline buys** (inferred from the above). Under content keys a result stays valid until the bytes it loaded change. A no-op or comment rebuild and a docs-only session re-run nothing today. After a real source-changing build, 97% to 98% of Squeal's e2e time and about 87% of cezarion's package time must re-run, so a baseline saves little run time. Its value is the transition. A pass recorded against the old build turns a failure after the build into `PASS -> FAIL`, which says the change broke it. Without one, the failure is a first observation, which says nothing about cause.

### 4. Mid-turn cost (verified by experiment, read in spec)

001 D11 Capacity: "An edit's tier ... runs at `runner.tierSize` without a permit and is never resized". 004-18 gave the slow file its own lane. So a slow file running mid-turn delays an edit only through CPU, never through a queue. Measured in the scratch clone: a 4-file fast tier at nice 10, alone, then beside a slow lane of `policy` and `lifecycle` at nice 10, idle I/O, `--maxWorkers=2`, after 20 s of warm-up (`logs/fast-beside-slow.summary.txt`):

| Tier | Load | n | Alone: median / p90 / max (ms) | Beside slow: median / p90 / max (ms) |
| --- | --- | --- | --- | --- |
| `test/state` ×4, about 1 s of tests | 14 to 16 | 6 + 6 | 1686 / 1781 / 1852 | 1596 / 1973 / 2950 |
| same | 9 to 11 | 15 + 15 | 1650 / 1706 / 1877 | 1646 / 1810 / 2001 |
| `test/scheduler` ×4, about 25 s | 7 to 20 (drifted) | 12 + 12 | 26608 / 28933 / 31435 | 25192 / 32183 / 41005 |

The median is unchanged within 5%; the tails grow by 6% to 59%. The heavy tier's ambient load drifted from 16 to 7 while it ran, so that row is uncontrolled. The fast lane's latency is not the main mid-turn cost. Three other costs are inferred from the spec and the dogfood:

- an artifact run mid-turn tests a build the agent may redo before it finishes;
- D4 discards a slow run whose inputs change while it runs, and for source-keyed browser specs every web edit does that;
- the browser suite's single server and Chrome contend with an agent's own manual browser run. `lessons.md` also saw 14 fast `PASS -> FAIL` timing failures in tiers that overlapped slow files, cause not isolated.

### 5. The options

| Option | For | Against | Cost |
| --- | --- | --- | --- |
| (a) as now, idle and explicit triggers, better text | Builds come at the end (2), so the idle trigger already runs build-output files soon after the build. The machinery shipped in 0.1.85 and has been reviewed through wave 9. Missing builds are a `slow.precondition` skip (004-65, 0.1.214). | The line's "sources changed since" does not tell the agent its change is untested. Under 0.1.215, 6 of 19 sessions ended with the slow file not current (2). | wording only |
| (b) run affected slow files when their artifact changes | A strong signal when it happens. Fast-lane median unaffected (4). | Mid-turn artifact changes are rare (2), so it mostly fires just before the idle trigger would. For source-keyed browser specs every edit is an artifact change: a 28-min serial drain discarded at each edit (D4). Narrow keys do not rescue it (3). | a new trigger, more discards, +6% to +59% fast-lane tail |
| (c) on request only, never automatic, kept baseline | Matches what agents did on 0.1.199 (40 of 40 asked) and how cezarion reserves full suites for CI. | Drops the only push path: the idle drain found and delivered sq2's `policy.test.ts` failure unasked. Under 0.1.215, 10 of 20 agents did not ask. A kept baseline saves about 2% to 13% of a real rebuild's runs (3). | removes the idle trigger and the exit drain (004-29) |
| (d) drop the slow tier; Squeal covers fast tests only | The smallest Squeal. This repository already lives without one. | Cezarion's 90 slow files go back to the fast lane, where each browser run boots the environment and an edit waits behind them (goal 1; `../005-agent-adoption/lessons.md`), or they are uncovered and agents run them through npm (dogfood sq3 ran a 91.5 s e2e file itself). | deletes D1 to D10 and their tests |

**The name.** "slow" is the only one of the four that is true of every suite in 1. "build" and "artifact" are false for the browser and eval suites, which are keyed on sources. "e2e" is false for the eval's ledger test and is a test kind, not a scheduling class. The friction the name was blamed for comes from build dependence, which `slow.precondition` and D5's declared artifact already carry.

**The text an agent reads.** Today: "Slow tier: 1 test file; 1 current against src/** as of revision 1. Squeal runs them when the agent pauses." When the artifact is older than the sources, it appends ", sources changed since" (`src/core/state/slow-text.ts:114`). A proposal for the coordinator, within 004-71's rule that no message names a build command:

```text
Slow tier: 13 test files; 13 current against packages/cezar/dist/** as of revision 4; your source changes since are not in it, so these files have not tested them. Squeal runs them when the agent pauses.
```

## Recommendation for Squeal

Option (a). Keep D2's triggers (idle, `run --slow`, `run --all`) and the drain at exit. Keep the name `slow` and the declared-artifact keys.

- Do not add an artifact trigger (b). Builds are rare and come late: 0 of 816 eval cells, 6 of 98 commits, and in dogfooding only when the prompt or the repository's gate asked.
- Do not build per-spec traced keys. Measured on real rebuilds, they spare 2% to 3% of Squeal's e2e time for the edits history actually makes, and about 13% of cezarion's package time.
- Change the `Slow tier:` line's clause for an artifact older than the sources, so the agent reads that its change is untested (text above).
- Tell repositories with build-output suites to declare `slow.precondition`, as cezarion's `test:package` should.

The cost is one wording change. The tradeoff that decides it: (b) and (c) each move work, (b) earlier and (c) onto the agent, at a measurable cost and with no measured gain. (a)'s remaining gap, 6 of 19 sessions ending not current under policy-off wording, is the repository's own choice under `stop.requireSlowSuite`.

## Open questions

1. Whether this repository should declare `slow.include` for `test/e2e`, and add `plugins/pi/**` and `plugins/opencode/**` to its e2e inputs (1). Coordinator's call, not this row's.
2. Browser-spec chunk closures were not measured (3). They need agent-browser and Chrome in a scratch HOME and a full 77-spec run.
3. The 0.1.215 eval run was still in progress. Its 10-of-20 and 13-of-19 figures are provisional. Run `a2-tally.sh` again when it ends.
4. Q4 ran on a 24-CPU host at loads 7 to 20, never calm, with one slow lane of 2 workers. `slow.maxParallel` 4 when idle was not measured beside a fast tier. A smaller host was not measured either.
5. Whether a kept baseline's transition evidence (3) changes what agents do after a build was not tested. No session built after a slow baseline was current.

## Sources

- Squeal `b08779a8`: `squeal.config.json`, `vitest.config.ts`, `package.json`, `test/e2e/{plugins,install,harness,pi-fixture,opencode-fixture}.ts`, `src/core/state/slow-text.ts:114,165`, `src/harness/shared/primer.ts:221-222`; specs 001 D11 Capacity, 004 D2, D4, D5, D8, D9 and `status.md`; `lessons.md`; `research/{slow-suite-policy,slow-suite-runtime,issue-4-signals,issue-4-ranking}.md`; `probes/dogfood*/prompts/`; `evals/ledgerline/{squeal.config.json,package.json}`.
- Cezarion `51190d494`, read with `git show` from `/home/agent/projects/cezar` and run only in a scratch clone: `squeal.config.json`, `package.json`, `packages/cezar/{package.json,tsconfig.json}`, `packages/web/e2e/{vitest.config.ts,environment.ts}`, `.ai/scripts/{build-e2e.sh,e2e.sh,test-env-up.sh}`.
- Issues: https://github.com/hearsay-tools/squeal/issues/3, /4, /5, /29, /35 (read with `gh issue view`, 2026-10-18).
- Eval cells: `/tmp/squeal-evals-1001/cells/*/*/` (`out/events.jsonl`, `out/status-end.txt`), runs `20261016T061730Z-07d7ab` and `20261018T125937Z-bcdbec`.
- Probes and logs: `probes/slow-tier-role/README.md`.
