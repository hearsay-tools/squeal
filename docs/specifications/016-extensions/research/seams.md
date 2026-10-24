# 016-01 Squeal's seams today

Brief: `seams-brief.md`. Researcher: Claude Opus 5.5, 2026-10-24. Examined: this repository at `0822a4440` (`package.json` 0.1.296). Probes: `probes/seams/` (a static import and name scan, and a minimal adapter typecheck). Line counts are `wc -l` of non-test product files.

## Questions answered

| # | Question | Answer in one line | Tag |
|---|---|---|---|
| 1 | Runner contract | `RunnerAdapter` has 10 required and 11 optional members. The daemon also hands each adapter a second, uncontracted interface (options, an observed-path store, scheduling hints). There is no load point for an adapter the daemon does not name. 14 imports and about 430 code lines in core and CLI name a runner; the "Known seams" list misses 9 groups. | verified by experiment, read in source code |
| 2 | Shared machinery | Shared: keys, closure assembly, the composite, the recovering wrapper, focus texts, the run summary. Each runner built its own graph, enumeration, reporter and process model. node:test's folder is a de facto toolkit that Vitest, pytest and the recorder import. | read in source code |
| 3 | Check types | Complexity is a parallel path: its own id, store, pass, `Counter` and delta field. A linter or `tsc` fits neither path without new identity, keying and per-location diagnostics. | read in source code |
| 4 | Harness contract | Each adapter maps its events onto `src/harness/shared`, which opens the store in the hook process and calls about 30 core modules. The CLI has no register, boundary or end-turn command, so a fifth adapter cannot reach parity outside the repository. OpenCode's bridge is the nearest thing to a process protocol. | read in source code, inferred |
| 5 | Keys | Keys hash `KEY_FORMAT_VERSION`, `adapterVersion`, the runner version, the resolved config and the environment files. The alarm in `test/keys/key-format.test.ts` compares bundles at the last release tag, so it cannot guard code outside this repository. | read in source code |
| 6 | Size | Ten seams. The files that would change hold about 6,600 product lines, plus the 7,541-line key alarm. Highest risk: the daemon's runner wiring and the injected observed store. Lowest: per-harness CLI lines and file moves. | inferred from counts |

## Findings

### 1. Runner contract

**F1.1 Members** (read in source code, `src/core/types/runner.ts:127-149`). Required: `name`, `adapterVersion`, `invalidate`, `affected`, `closure`, `enumerate`, `testFiles`, `environment`, `run`, `close`. Optional: `recheck`, `omittedTestFiles`, `slowWidth`, `tierWidth`, `tierPart`, `besideBacklog`, `backlogSlot`, `focuses`, `focusesFile`, `lane`, `releaseLane`. `RunReport` has 6 required and 9 optional fields (`:96-112`). The probe `minimal-adapter.ts` implements only the required members and typechecks (verified by experiment, tsc 7.0.2, exit 0).

**F1.2 What the core assumes beyond the type** (read in source code):

- A check is a test: `CheckId` is `test | file | setup`, each keyed by `(project, testPath)` (`src/core/types/check.ts`). There is no other check kind for a runner to report.
- `RunnerClosure.packages` and `RunnerEnvironment.packages` use Node's vocabulary (`PackageImport`, `builtins`). The core keys installed Node packages from them (`src/core/scheduler/keying.ts:227-245`, C11).
- The daemon, not the adapter, sets the scheduling hints. pytest's `tierWidth`, `besideBacklog`, `backlogSlot` and `focuses` are set by the wrapper in `src/core/daemon/pytest-runners.ts:150-190`. Vitest's `focuses: true` is set in `daemon.ts:546`.
- Observed paths reach the store two ways. Vitest returns them in `RunReport.observed` (`src/core/scheduler/observed.ts:47`). node:test and pytest get an `ObservedStore` from the daemon, which writes `meta` rows and the stored closures of every worktree in one transaction (`src/core/daemon/node-test-runners.ts:32-60`). That second path is not in the contract and writes the shared store directly.
- The scheduler treats node:test projects as runners of their own (`src/core/scheduler/slow-tier.ts:629`), and pytest projects not.
- C14 says node:test honours focused texts through 003 D5. At HEAD no node:test runner sets `focuses` (grep over `src/runners/node-test` and `node-test-runners.ts`), and 003's spec line 28 says whole files run. node:test runs focused files whole.

**F1.3 No load point** (read in source code). The daemon imports each runner by path: `import("../../runners/vitest/index.js")` (`src/core/daemon/daemon.ts:486`), `node-test-runners.ts:6`, `pytest-runners.ts:8-9`. `Policy` has one member per runner (`src/core/types/policy.ts:89-110`) and no key names a module. An adapter written elsewhere has no way in.

**F1.4 Imports into core and CLI** (verified by experiment, `scan.mjs` section A, 14 edges):

- core to runners: `daemon/daemon.ts:486`, `daemon/node-test-runners.ts:6`, `daemon/pytest-runners.ts:8,9`, `code/count/parser.ts:2` (complexity loads tree-sitter through `runners/pytest/graph/parse.js`).
- cli to runners: `pytest-seed.ts:4-7`, `status-wait-focus.ts:23`, `status-wait-focus-answer.ts:4` (`runners/focus.js`).
- cli to harness: `status-command.ts:3` (`harness/codex/command`), `opencode/status.ts:5` (`harness/opencode/host`), `start.ts:17` (`harness/shared/version-copies`).
- harness to runners (section B): `harness/shared/deny.ts:21` (`runners/pytest/environment/discover`).

**F1.5 Names by string** (verified by experiment, section D). Code lines naming a runner: core 219 in 34 files, CLI 214 in 18, `harness/shared` 96 in 9. Naming a harness: core 12 in 4, CLI 231 in 23, `harness/shared` 7 in 1. Full list in `probes/seams/scan-output.txt`.

**F1.6 "Known seams" at HEAD** (read in source code). Every listed code seam still holds: `daemon.ts:486,527-582`; `runner.ts:164,175`; `own-edit.ts:19` parses `moved.ts`'s reason; `stop-wait.ts:58`; the Vitest adapter's imports (`adapter.ts:2,5,6`, `startup.ts:3`, `reporter.ts:3`, `config-stamps.ts:4`); `run-log.ts:40-41`; `optimizer-note.ts:14`; `snapshot.ts:2,235-245`; `status-command.ts:3`. One line does not match the code: C10's strip list of harness session variables is not implemented. Board row 001-391 is still `planned`, and no product file names `CODEX_THREAD_ID` or `CLAUDECODE`.

The list misses these 9 groups:

1. Complexity depends on the pytest runner: `core/code/count/parser.ts:2`.
2. Runner meta keys in the core types: `types/runner.ts:624-660` (`nodeTest.observed.*`, `pytest.observed.*`). They are read in `daemon/lifecycle.ts:346` and `scheduler/growth.ts:18`.
3. The policy has one member per runner, and its consumers read them: `slow/classify.ts:15,29`, `state/slow.ts:40`, `scheduler/slow.ts:18`, `scheduler/slow-tier.ts:629`, `delivery/attribution.ts:307`, `status/standing.ts:340-342`.
4. Status text and payload: `status/test-frame.ts:27` (`PYTEST_ENTRY`), `text.ts:104`, `format-status.ts:131-136`, `why-unknown.ts:97-104`, `format-why.ts:308-329`, and the `"not-vitest" | "node-test"` log state in `types/status.ts:1027`, which is a versioned payload.
5. `squeal ps` classifies runner processes by argv (`ps/processes.ts:142-165`) and harness installs by path (`ps/discover.ts:29-31`, `ps/flags.ts:217`, `daemon/version.ts:83-150`).
6. `harness/shared` knows every runner. `test-command.ts`, `test-command-files.ts`, `test-command-pytest.ts` and `test-command-reason.ts` (444 lines) parse `vitest run`, npm scripts, `node --test` and `pytest` commands for the deny of 005 D8. `coverage.ts:4,57-84` and `primer.ts` name the runners.
7. The CLI reads harness session variables: `status-wait.ts:426-431` (`CLAUDE_CODE_SESSION_ID`, `CODEX_SESSION_ID`, `OPENCODE_SESSION_ID`), `main.ts:330` and `retry.ts:152` (`PI_SESSION_ID`). `main.ts` status appends `codexStatusLine`, `piStatusLine` and `opencodeStatusLine`.
8. Runners import each other (section C): `pytest/run/run.ts:17` and `batches.ts:4` use `node-test/run/process`; `observe/runtime.ts:4-5` and `vitest/observe.ts:6` use `node-test/recorders` and `node-options`.
9. Coverage for 015 D8 goes through `createVitestAdapter`'s options (`daemon.ts:510-528`, `vitest/coverage.ts:4`), not through `RunnerAdapter`.

### 2. Shared machinery

| Machinery | Where | Shared or alone | Reusable as a toolkit by |
|---|---|---|---|
| Check key, environment hash, closure assembly, declared inputs | `core/keys` (check-key 91, environment 335, closure 198 lines) | Shared by all three | any runner (read in source code) |
| Installed Node packages (npm, pnpm, hidden lockfile) | `core/keys/{packages,pnpm-*,hidden-lockfile,dependencies}` | Core, but driven by `RunnerClosure.packages` | JS runners only: Jest, Mocha (read in source code) |
| Module graph | Vitest: Vite's graph (`vitest/graph.ts`, `sources.ts`). node:test: own static TS/JS resolver (`node-test/graph/*`, 11 files). pytest: tree-sitter Python graph (`pytest/graph/*`). | Each alone | node:test's resolver for a Jest or Mocha runner (inferred); none for Go |
| Runtime-input recorder | `runners/observe` (`.cjs` preload, 1,370 lines) | Vitest and node:test. pytest has its own Python hooks (`pytest/runtime/squeal_pytest.py`, `sitecustomize.py`). | any Node runner (read in source code) |
| Warm instance | Vitest only: one `createVitest` kept open (`vitest/adapter.ts:193-212`), plus a second for the slow tier (`daemon/slow-instance.ts`). node:test spawns one process per file, pytest one per batch. | Vitest alone | none: no generic warm-process wrapper (read in source code) |
| Process groups, low priority | `node-test/run/process.ts` (`startGroup`) | node:test and pytest | any spawned runner, once moved out of node-test (read in source code) |
| Focus texts | `runners/focus.ts` (55 lines) | Vitest and pytest | any runner with a name filter (read in source code) |
| Slow lanes | Lane by name in the composite (`composite-runner.ts`), per project for node:test (`slow-tier.ts:629`), second instance for Vitest | Mixed | lane by name only (read in source code) |
| Recovery after a broken config | `daemon/runner.ts:59` `createRecoveringRunner` | All three | any runner (read in source code) |

### 3. Check types

**F3.1 Complexity is a parallel path** (read in source code and official docs, 015 D2 and D4). 015 D2: "Code checks are their own kind beside `CheckId`, never a member of it. They have no run, re-run, retry, held failure, inherited confirmation or checkpoint, and they share none of the scheduler's paths". At HEAD it has its own id (`CodeCheckId`, `types/code.ts:30`), its own store (`code.sqlite`), its own pass outside the lanes (`daemon.ts:635-655`), its own provider type (`Counter`, `code/pass/types.ts:10-14`), and its own delta field (`Delta.code`, `types/delivery.ts:254`). Its delivery reuses the transition rules and the consumer views.

**F3.2 What `Counter` gives** (read in source code). `count(text, language)` is per file and depends on the text only. A count is keyed by `(blob, language, COUNTER_VERSION)`. Nothing else enters the key: no config, no installed package, no other file.

**F3.3 What a linter or type checker needs that neither path has** (inferred from F1.2, F3.1, F3.2):

- **Identity without a test name.** A diagnostic is `(path, rule, location)`. `CheckId` needs `fullName` under a test file. `CodeCheckId` needs a function. A diagnostic keyed by line moves with every edit above it. That would fire transitions on every shift unless identity drops the line, for example `(path, rule, occurrence)`.
- **Many diagnostics per location.** `CheckError` carries a location, but only as the reason for a failed check. There is no list of findings per file.
- **Config and plugins in the key.** ESLint and Ruff results depend on their config and plugin versions. `Counter` keys only the blob. The runner path keys config through `RunnerEnvironment.resolvedConfig` and `files`, so a per-file linter fits the runner path's keys better than the counter's.
- **Project-wide checks.** `tsc` or type-aware lint reads the whole program. On the runner path it would be one pseudo test file whose closure is every source file. Any edit re-runs it, and its findings land under one `testPath`. No contract member says "this check's closure is the project".

### 4. Harness contract

**F4.1 What each adapter implements** (read in source code; lines exclude tests).

| Adapter | Lines | Process model | Events mapped | Packaged as |
|---|---|---|---|---|
| Claude Code | 555 | One bundled `.mjs` per hook event, spawned by Claude Code | session-start, user-prompt-submit, pre-tool-use, post-tool-batch, stop, stop-slow, session-end, plus a `waiter` | marketplace plugin, `plugins/claude-code` (7.6 MB `dist/`) |
| Codex | 703 | Same, one `.mjs` per hook | 10 events, including subagent-start, subagent-stop, interrupt | marketplace plugin, `plugins/codex` (8.3 MB) |
| Pi | 930 | An extension in Pi's process, plus a `worker_threads` worker that runs the shared logic. Request kinds in `pi/protocol.ts`: start, shutdown, boundary, run, toolCall, settle, endTurn, wait, ping. | Pi events | npm package `squeal-pi` (5.4 MB) |
| OpenCode | 1,971 | A plugin in OpenCode's Bun process, plus one Node child per request, `dist/hooks/<kind>.mjs`, JSON on stdin and stdout (`opencode/protocol.ts`): register, prompt, before, after, stop, endTurn, wait, end, ping | OpenCode events | npm package `squeal-opencode` (7.6 MB) |

**F4.2 What `src/harness/shared` gives** (read in source code, 25 files, 3,505 lines). It gives store open and consumer (`context.ts`), ensure (`ensure.ts`), deliver, deny, primer, session start and end, stop and stop-slow, the waiter, the root per session, the harness process walk and the uncovered-edit line. It imports about 30 core modules, among them `core/store`, `core/delivery/*`, `core/daemon/{policy,version,ensure,client,runner}` and `core/status`. `HarnessDelivery` runs inside the hook process over SQLite (`context.ts:3-7`). It is not a daemon call.

**F4.3 Duplication** (read in source code):

- Edit tool sets, one per adapter: `claude-code/hooks/pre-tool-use.ts:8`, `pi/run.ts:22`, `opencode/bridge-turn.ts:19`.
- `MAIN_AGENT` and `PRIMER_CAP_CHARS` are declared again in `opencode/hooks.ts:24-26`, on purpose: "which the plugin bundle cannot import" (`:13`).
- Three CLI status hint lines of the same shape: `cli/codex/status.ts`, `cli/pi/status.ts`, `cli/opencode/status.ts`.
- Install and version detection is split: Claude Code and Codex in `core/daemon/version.ts`, Pi and OpenCode in `core/ps/discover.ts:31`.
- Every plugin bundles the whole CLI, core and every runner's runtime (`src/harness/build.ts`: node:test runtime, recorder, coverage provider, pytest runtime, both grammars).

**F4.4 Can a fifth adapter live outside the repository on the CLI and JSON alone?** Not with parity (inferred from the CLI's command table, `cli/main.ts:182-199`). The CLI offers `start`, `status [--json] [--wait]`, `run`, `why`, `failures`, `retry` and `stop`. It has no `register`, `unregister`, tool boundary, `peek`, `startTurn` or `endTurn`. `status --wait` finds a session only by the three harness variables in `status-wait.ts:426-431`. A fifth adapter could ensure a daemon and show snapshots. It would get no per-consumer silence (C5 views), no regression deny, no idle wake with news, and no handoff. Two partial routes exist. One is to import `src/harness/shared`, which is not published (`package.json`: `"private": true`, `"license": "UNLICENSED"`). The other is to spawn OpenCode's bridge entries, which are already a JSON process protocol. But they carry OpenCode's pid and tool names (`OPENCODE_EDIT_TOOLS`), and no spec calls them public.

### 5. Keys

**F5.1 What protects results today** (read in source code):

- `environmentHash` (`core/keys/environment.ts:52-83`) hashes the encoding, `KEY_FORMAT_VERSION` (20, `key-format.ts:21`), Node version, platform, arch, installed dependencies, allow-listed environment, project, `runnerName`, `runnerVersion`, `adapterVersion`, `resolvedConfig` and the hashed environment files. `checkKey` adds the test path and its closure's `(path, blob)` pairs (`check-key.ts`). So a runner's own version string re-keys only that runner.
- `test/keys/key-format.test.ts` is the alarm. It reads the last `squeal--v*` tag with `git archive` (`test/keys/validity/trees.ts:10-42`) and bundles each component's entries at both trees (`validity/entries/{global,vitest,node-test,pytest,recorder}.ts`). When the emitted code differs, it runs the case corpus (`validity/cases/`). A version may move only when a case's outputs differ. `COMPONENTS` (`validity/components.ts`) names the three runners and the recorder. The harness is 65 files and 7,541 lines.
- `KEY_FORMATS_READ_AS_ONE` keeps results across format raises that changed no stored meaning.

**F5.2 What an out-of-tree runner would have to supply** (inferred from F5.1):

- `adapterVersion` that moves when its keys' meaning moves.
- `runnerVersion`.
- `resolvedConfig` as a deterministic string.
- `files`: every environment file.
- Complete closures, with `packages` for Node.
- A declared or observed account of runtime reads.

The alarm cannot cover it, because it compares this repository's bundles at two git tags. Without an equivalent, a third-party bump discipline is trust only. A missed bump gives a stored PASS to a changed check, which is the false pass the 016 status calls Squeal's cost, not the extension's.

### 6. Size and risk

Ranked by risk to shipped behaviour, then size. Sizes are whole files that would change, unless a part is named (inferred from counts, F1 to F5).

| # | Seam | Files | Size in lines | Risk |
|---|---|---|---|---|
| S1 | Runner wiring and registry: `daemon.ts` `#run`, `runner.ts`, `node-test-runners.ts`, `pytest-runners.ts`, `policy-node-test.ts`, `policy-pytest.ts` | 6 | about 160 in `daemon.ts`; 809 in the other five | High: the start path of every runner, recovery and slow instance |
| S2 | Injected observed store and runner meta keys (F1.2, missed group 2) | 5 | about 300 | High: writes shared closures across worktrees |
| S3 | Keys alarm per component (F5.1) | `test/keys/validity` | 7,541 (tests) | High for trust; nothing shipped breaks |
| S4 | Policy members per runner and their 9 consumers (missed group 3) | 12 | about 60 lines in total | Medium: slow lanes, attribution |
| S5 | `harness/shared` runner knowledge: test-command deny, coverage, primer (missed group 6) | 6 | 1,056 | Medium: 005 D8's deny |
| S6 | Coverage through Vitest options, 015 D8 (missed group 9) | 3 | about 250 | Medium: CRAP's input |
| S7 | Status text and payload states (missed group 4, `run-log.ts`, `snapshot.ts`) | 10 | about 80 | Low to medium: `not-vitest` is a payload value |
| S8 | Build and packaging: every runtime in every plugin (`harness/build.ts`) | 1 + 4 plugins | 287 | Medium: CI checks `dist` drift |
| S9 | CLI per runner (setup, seeds, warmup) and per harness (codex `init`/`trust`/`hash`, status lines, `init`, `update`, env names) | about 20 | 1,342 in runner-only files, 1,630 in harness-only files, plus parts of `setup/{plan,block,format}.ts` | Low for validation, medium for install |
| S10 | Toolkit files in the wrong folder: `node-test/{recorders,run/node-options,run/process}`, `pytest/graph/parse`, `runners/focus` (missed groups 1, 8) | 5 | 540 | Low: moves. The recorder's alarm entries re-run. |

## Recommendation for Squeal

1. Treat the harness contract as two layers. The behavioural layer (C8) is ready: four adapters already map onto one `harness/shared` (F4.1, F4.2). The process layer is not: a fifth adapter outside the repository needs either a public, versioned form of the OpenCode bridge's request kinds, or CLI commands for register, boundary, peek and end-turn (F4.4). Of the existing code, the bridge is the smaller step.
2. Before any runner moves out, close S1 and S2 inside the repository. Add a load point that is not a path import (F1.3). Bring the observed-path write and the scheduling hints into the adapter contract (F1.2), so that the core, not the adapter, writes the shared store.
3. Do the low-risk moves first: S10 into a shared runner toolkit, then S4 and S7 behind a runner description that the adapter supplies. They change no keys and make our own runners use the boundary (status.md's last assumption).
4. Do not fold linters into `Counter` (F3.2). A per-file linter's key needs its config, as `RunnerEnvironment` has. A diagnostic needs an identity without a test name or a line (F3.3). That is a spec decision for 016, not a refactor.
5. For third-party runners, the key alarm cannot follow them (F5.2). Decide early what replaces it, for example a conformance kit run by the extension's own CI. Brief 016-06 covers it.

Limits: all of the above is a static reading at one commit. Nothing was measured, and no daemon, harness or runner was started. Counts by regex can include type names (probe README).

## Open questions

1. Is the second, uncontracted interface (the daemon's options per runner, F1.2) meant to become part of `RunnerAdapter`, or a separate "host services" object the core passes in? Not determined: no spec names it.
2. Should node:test honour focused texts as C14 says, or should C14 drop node:test (F1.2)? Not determined: 003 and 011 disagree, and the code matches 003.
3. Is the OpenCode bridge protocol stable enough to publish? Not determined: no compatibility promise is written for it, and its kinds follow OpenCode's events.
4. How large is a Jest or Go runner on this toolkit? Not determined, because no prototype was in scope (no product code, no package installs).

## Sources

All at commit `0822a4440`, 2026-10-24, read in this worktree:

- `src/core/types/runner.ts`, `check.ts`, `keys.ts`, `delivery.ts`, `policy.ts`, `code.ts`, `status.ts`
- `src/core/daemon/{daemon,runner,runner-set,composite-runner,slow-instance,node-test-runners,pytest-runners,lifecycle,version}.ts`
- `src/core/keys/{key-format,check-key,environment,closure}.ts`, `src/core/scheduler/{keying,observed,slow-tier,growth}.ts`, `src/core/code/pass/{types,counter}.ts`, `src/core/code/count/parser.ts`
- `src/core/status/{run-log,snapshot,standing,test-frame,format-status,format-why,why-unknown}.ts`, `src/core/ps/{processes,discover,flags}.ts`, `src/core/slow/stop-wait.ts`, `src/core/delivery/{own-edit,attribution}.ts`
- `src/harness/shared/*`, `src/harness/{claude-code,codex,pi,opencode}/*`, `src/harness/build.ts`, `plugins/*/package.json`
- `src/cli/{main,status-wait,status-command,retry,pytest-seed}.ts`, `src/cli/{codex,pi,opencode,setup}/*`
- `test/keys/key-format.test.ts`, `test/keys/validity/{components,trees}.ts`
- Specs: `docs/specifications/011-core/spec.md` (C3, C4, C8, C10, C12, C14, Known seams), `015-coverage-complexity/spec.md` (D1 to D5), `003-node-test-runner/spec.md` line 28; `docs/board.md` row 001-391
- Probes: `probes/seams/scan.mjs`, `scan-output.txt`, `minimal-adapter.ts`
