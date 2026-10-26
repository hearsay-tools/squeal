# 017-02: where a lint check enters Squeal's core

Brief: [lint-seams-brief.md](lint-seams-brief.md). Researcher: Opus 5.5, 2026-10-26. Examined: this worktree at `7e3e54bb8` (`package.json` 0.1.338). Also read: `origin/main` at `7a9047fd6` for `binding-cost.md`, and `origin/cand/0.1.341` at `678cf1ba9` for the policy default change (commit `dc88f24a6`). Probe: [probes/lint-seams/](probes/lint-seams/README.md), output in `out.txt`. No daemon, socket or live store was used. No timings and no test suite.

**Verdict:** a per-file lint check fits spec 015's code path, not the test path. It reuses the code path's pass trigger, its delivery position and its "never a known failure" rules. It needs its own table, its own key and its own policy section. On the test path the probe gave a false `FAIL -> FAIL` on an inserted line, hid a fixed finding, counted the check as a known failure, and removed the file from complexity counting.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | 015's path | Named `(path, qualifiedName, occurrence)` per measure. Counts keyed by `(blob, language, COUNTER_VERSION)` in `code.sqlite`, shared by every worktree. States, transitions and views per worktree. A pass outside the scheduler's lanes, with no test permit, nudged after each batch. Told after the test blocks in its own line form. Gated only by `complexity.blocking`. | read in source code |
| 2 | Fit | Reuses as is: the pass trigger, `CodeOutcome`, the transition kinds, the views' `told` model, the delivery slot, `CODE_LISTED_MAX`, the pure key functions. Needs new: a table for per-file results with a findings set, a key that holds config and tool version, a fingerprint column, a measure value, recount reasons, policy keys and wording. Assumes a test: 11 places, listed in F2.3. | verified by experiment, read in source code |
| 3 | Scheduling | Attach beside `createCodePass` (`daemon.ts:646`), not to the scheduler. The provider's hints have no scheduler to answer: it declares data once. Typed rules need one program segment in the key, not a per-file closure of every program file. | read in source code, inferred |
| 4 | Agent's surfaces | Code-form lines are invisible to the evals parser (P4) and to `Known failures`. On the test path the same finding reads as a test failure in the delivery, Stop, status and the evals verdict (P1). With the policy off, nothing changes if the lint store is separate and opens only when lint is on. | verified by experiment, read in source code |
| 5 | Policy | A `lint` section beside `complexity`, with its own `enabled`. It must not depend on `complexity.enabled`, because `openCodeStore` returns `off` without it (P3c). 0.1.341's default flip needed test-helper changes. | read in source code, verified by experiment |

## Findings

### Q1. 015's path at HEAD

| Part | Where | What it does |
|---|---|---|
| Name | `src/core/types/code.ts:30-42`, `:48` | `CodeCheckId` is `(path, qualifiedName, occurrence)`. `CodeMeasure` is `complexity`, `crap` or `uncovered`. A code check is never a `CheckId` (`:4-8`, 015 D2). |
| Key | `src/core/code/store/schema.ts:34-42`; `code/pass/types.ts:16-20` | A count is keyed by `(blob, language, counter_version)`. The `Counter` sees only the text. No config, package or other file enters. |
| Store | `code/store/open.ts:25`, `:46-84`; `schema.ts:28-116` | `<common-dir>/squeal/code.sqlite`, its own `user_version` (1). `open.ts:51` returns `{ reason: "off" }` while `complexity.enabled` is false. A newer `user_version` is refused (`:66-68`); the pass then logs and runs with no code features (`code/pass/index.ts:166-170`). |
| Schedule | `core/daemon/daemon.ts:646-674`, `:681`, `:711`, `:713`, `:718`; `code/pass/index.ts:79-83` | One `CodePass` per daemon, in the daemon process, outside the lanes, no test permit. Nudged after each batch, after a listing, at start, and soon after results or records. Passes never overlap. |
| Share | `schema.ts:12-27` | `counts` and `checks` are shared by every worktree. `files`, `states`, `transitions` and `views` carry `worktree_id`. |
| States and transitions | `types/code.ts:56`, `:165`; `code/store/states.ts:7-17` | `pass`, `fail`, `pending`, `unknown`. Kinds `first-seen-fail`, `pass-to-fail`, `fail-to-pass`, `removed`. The fingerprint is the measure and threshold, never the value (015 D5; `CodeViewEntry`, `types/code.ts:197-204`). |
| Told | `core/types/delivery.ts:261`; `delivery/format.ts:308`, `:343`, `:471`; `delivery/code-format.ts:43-62`, `:99-111`; `status/format-status.ts:106`, `status/code-status.ts:82-100`; `cli/main.ts:83`, `:189` | `Delta.code` is told after every test block. Registration and status give one count line. `squeal code` lists details. |
| Gated | `harness/shared/stop-code.ts:48-53`; `stop.ts:134-140`, `:247`; `deny.ts:27`, `:49` | Stop counts code only with `complexity.blocking`. The edit deny reads test `pass-to-fail` entries only. |

### Q2. Fit for a check of one file and one tool

**F2.1 Reuses as is** (read in source code):

- The pass trigger and its loop: nudge, soon, one pass at a time, a revision's changed paths (`PassSource.changedPaths`, `lastChanges`, `movedHead`: `code/pass/types.ts:34-66`).
- The state model: `CodeOutcome`, `CodeTransitionKind` (`removed` fits a deleted file), the view's `count`, `full` and `still` (`types/code.ts:190`).
- The delivery slot and the cap: `Delta.code`, after the test blocks, at most `CODE_LISTED_MAX` (5) entries (`types/code-delivery.ts:11`), then `and N more`.
- "Never a known failure, never denies, blocks Stop only by policy" (015 D7). The probe shows why it matters (F4.1).
- The pure key functions: `environmentHash(core, runner, hashOf)` (`keys/environment.ts:57-88`) and `checkKey(env, closure, hashOf)` (`keys/check-key.ts:34-42`) take plain data. A lint key can be built from them with a `RunnerEnvironment`-shaped input: tool name and version, adapter version, the resolved config as a string, the config files.
- The worker-thread precedent: the coverage map worker (`code/coverage/map-worker.ts`, `mapper.ts:97-110`).

**F2.2 Needs a new field or kind** (read in source code; P3 verified by experiment):

- **A table, not a new measure in `states`.** `states.value` and `threshold` are `REAL` (`schema.ts:65-78`). A findings set needs a text fingerprint (016-33's a-set) and the findings themselves. 015 D4 (spec line 114) forbids a column added under an unchanged `user_version`. A new measure value in the existing tables breaks older readers: an unfiltered `states.list` threw `measure has unexpected value lint` (P3). Unfiltered readers at HEAD: `cli/code-coverage.ts:69` (`squeal code <path>`), `code/crap/walk.ts:174`, `code/pass/stage.ts:80`; views and transitions decode the measure too (`views.ts:87`, `transitions.ts:87`). A measure-filtered read was fine (P3b).
- **A result keyed like a test result, not like a count.** Lint findings depend on config, plugins and tool version (016-33 Q4). So the result is shared by key, as `results` is in the main store, not by blob as `counts` is.
- **Identity.** `CodeCheckId` needs a function name. A file check is `(path, tool)`. Putting `""` in `qualifiedName` works in the shared `checks` table (P3 wrote such a row), but every formatter calls it a function (`code-format.ts:21-25`).
- **Recount reasons.** `RecountReason` is `first`, `threshold`, `include`, `counter` (`code/pass/types.ts:74`). Lint needs a config change and a tool version change, each told as one summary line.
- **Wording.** `Complexity:` is hard-coded in the told line and the registration (`code-format.ts:210`, `:219-227`), and the title says `complexity change` unless coverage is among the entries (`code-format.ts:114`).
- **A policy section** (Q5).

**F2.3 Places that assume a test** (each one reached by a lint check sent down the test path):

| # | Place | What happens to a lint check | Tag |
|---|---|---|---|
| 1 | `types/check.ts:45`; `store/codec.ts:87` | `CheckId` is `test`, `file` or `setup`. A new kind `lint` makes an older reader throw `check_kind has unexpected value lint` (P2). | verified by experiment |
| 2 | `types/runner.ts:163-177` | `EnumeratedCheck.check` and `CheckRunResult.check` are `TestCheckId` (needs `fullName`). Only `FileLevelError` (`:212`) takes a file. | read in source code |
| 3 | `state/fingerprint.ts:169-195` | The fingerprint is the first error and its line. s2 (a line inserted) delivered `FAIL -> FAIL, failure changed`, a false notice. s3 (second finding fixed) delivered nothing, a hidden change (P1). | verified by experiment |
| 4 | `code/pass/source.ts:62`; `code/pass/included.ts:22-25` | A file a runner lists is a test file and is never counted for complexity. With `src/a.ts` listed by the lint "runner", `includedSet` returned `null` for it (P1b). | verified by experiment |
| 5 | `code/crap/loaders.ts:61` | A listed test file whose closure is unknown is "a loader of every source", so CRAP waits. | read in source code |
| 6 | `delivery/format.ts:81` | The header counts it as a test file: `1 check changed (1 test file loaded)` (P1). | verified by experiment |
| 7 | `harness/shared/text.ts:53` | Stop and status say `Known failures: 1 ([eslint] src/a.ts (file-level))` (P1a). | verified by experiment |
| 8 | `harness/shared/deny.ts:27`, `:49-53` | A test `pass-to-fail` denies the next edit. s1 recorded exactly that kind, so a new finding would deny an edit. | inferred from P1 and source |
| 9 | `evals/lib/squeal-text.mjs:470-503` | It reads `FAIL  [eslint] src/a.ts (file-level)` as a failing check, `failures: 1`, `verdict: "fail"` (P1). Past eval grades would move. | verified by experiment |
| 10 | 011 C4 steps 4-5; `scheduler/*` | Tiers, lanes, retries, held failures, `run --all` checkpoints, slow tiers and `why` all apply. 015 D2 rules these out for code checks. | read in official docs (spec) |
| 11 | `test/keys/validity/components.ts:37-74` | The key alarm names runner components. A lint key needs its own component on either path. | read in source code |

### Q3. Scheduling

- **Attach point** (read in source code). Beside `createCodePass` in the daemon's `#run` (`daemon.ts:646`), with the same nudges (`:681`, `:711`, `:713`, `:718`). Not as a `RunnerAdapter` behind the composite (`daemon.ts:474-500`), and not in a lane: 011 C4's tiers order test files by failure and duration, which has no meaning for a lint pass.
- **Hints as data** (inferred from `binding-cost.md` finding 3). On the code path there are no `lane`, `tierWidth` or `backlogSlot` calls to answer. What the core needs from the provider fits in one declaration per environment: tool name and version, adapter version, the extensions it reads, whether it reads the whole program, and its config files.
- **Its own thread** (inferred from `binding-cost.md` finding 4). The coverage mapper falls back to the main thread when its worker fails (`mapper.ts:97-110`, 015 D8). That fallback is safe for Squeal's own code. It is not safe for a project's ESLint and its plugins, which may block or throw. A lint provider that loses its worker has no result, and status says so.
- **Slicing** (inferred from 015 D4). Warm ESLint costs about 48 to 60 ms of CPU per file (`binding-cost.md` Q2). A pull of 200 files is then about 10 to 12 s of CPU in the worker. The code pass's parts (32 files, 25 ms on the main thread) bound the main thread's share; the worker's share needs its own bound or a slot from the user's pool (011 C10).
- **Typed rules** (inferred from 016-33 Q4 and `keys/check-key.ts:34-42`). The findings of every file depend on every program file. A per-file closure of all program files gives N × N key segments and reverse-index entries. This tsconfig (`include: ["src", "test", "vitest.config.ts"]`) covers up to 2,295 tracked `.ts` files, so about 5.3 million segments for each re-key. One program segment in the environment (the sorted path and blob of each program file) keeps one segment per file. Either way, any edit re-keys every file's result, and recovery needs a run over the whole program.
- **Observed sets** (read in source code, `keys/observed.ts:23-34`, `:91`; inferred for lint). The shared sets are keyed by project and test path. A lint run's reads (config imports, plugin files, for typed rules the program's source files) are per tool and environment, not per file. They fit `RunReport.environmentObserved` (per project start-up paths, `types/runner.ts:504-506`; 016 D4), recorded by the core.

### Q4. The agent's surfaces

**F4.1 On the code path** (P4 verified by experiment; the rest read in source code):

- **Delivered lines.** A line in the code form (`FAIL lint: ...`, one space) after the test blocks. The evals parser read the same checks with and without it (P4). Row 015-65's test (`test/evals/code-lines.test.ts` on `cand/0.1.341`) already pins that rule for code lines.
- **Status.** One line in `codeStatusLines` style (`status/code-status.ts:82-100`). `--json` has `code: { v: 1, ... }` (`types/code-delivery.ts:150-169`); a lint field there or beside it is a new versioned shape.
- **Blocked write.** None: `deny.ts` reads test entries only.
- **End of turn.** None unless a lint blocking key is on, as `codeStopReason` does for complexity (`stop-code.ts:48-53`).
- **`squeal code`.** It reads complexity states only (`cli/code-report.ts:306`) and lists functions. A file with findings has no function, so it needs its own listing.

**F4.2 On the test path** (verified by experiment, P1): the lint finding is a `FAIL  [eslint] src/a.ts (file-level)` block, counts as a known failure, and moves the evals verdict to `fail`.

**F4.3 A project that does not turn it on** (verified by experiment, P3c; read in source code). Nothing changes if the lint table lives in a store that opens only when lint is on, and the delivery, status and Stop add nothing while it is off. This is 015 goal 1's rule. A new table in `code.sqlite` raises its `user_version` to 2. Every older daemon of the repository would then refuse the code store and lose complexity and coverage, with one log line (`open.ts:66-68`, `pass/index.ts:166-170`). A separate file such as `lint.sqlite` avoids that.

### Q5. Policy

- 015 D1's sections sit at the top level of `squeal.config.json`: `complexity`, `coverage`, `crap` (`daemon/policy-code.ts:22-33`, `types/policy.ts:139-157`). `lint` would sit beside them, with its loader shape in the same file (read in source code).
- `lint.enabled` must stand alone. At HEAD `openCodeStore` returns `off` while `complexity.enabled` is false (P3c), so a lint store inside `code.sqlite` would follow complexity's switch (verified by experiment).
- The policy loader is on the key-validity path (`policy-code.ts:7-10`). A rule between keys there needs a validity case (read in source code).
- 0.1.341's flip of `complexity.enabled` and `coverage.enabled` to `true` (commit `dc88f24a6`) changed 32 files. It needed test helpers that keep code features off unless a test is about code (`test/helpers/policy.ts`: `policyOn`, `ON`, `runMissingConfig`, `createFixtureRepo`) (read in source code). A lint default of `true` would need the same, and it would load a project's ESLint, which is code execution (vision principle 8). Default `false` keeps "nothing changes" for free. Squeal's own repository lints with Biome (`package.json:23`), so it has no ESLint config to dogfood with (read in source code).

## Recommendation for Squeal

1. **Take 015's code path, not the test path** (F2.3 rows 3, 4, 7, 8, 9). The test path's fingerprint gives the a-loc errors 016-33 found, now through Squeal's real sink. It also turns lint findings into known failures and edit denials, and removes the linted files from complexity counting.
2. **Give lint its own store file and table, opened only when `lint.enabled` holds** (F2.2, F4.3, Q5). Results keyed by a `checkKey` over the lint environment, shared by every worktree. States, transitions and views per worktree, with a text fingerprint. Do not add a measure to `code.sqlite`'s tables (P3) and do not raise its `user_version`.
3. **Reuse the pass trigger, the delivery slot and the D7 rules unchanged** (F2.1). Add only lint's wording, recount reasons and listing.
4. **Run the provider in a worker with no main-thread fallback, and bound its CPU** (Q3). The provider declares its hints once as data.
5. **Typed rules: one program segment in the environment, never a per-file closure of the program** (Q3). Say in the spec that any edit then re-keys every file.
6. **`lint.enabled` defaults to `false`, independent of `complexity`** (Q5).

Limits: a static reading at one commit plus one probe of Squeal's own modules. No ESLint ran; ESLint's behaviour comes from 016-33 and 016-34. The probe used a fabricated `file` check, not a real runner adapter. The 5.3 million figure counts tracked files, not `tsc`'s program list.

## Open questions

1. Where a finding with no file goes (a config error, ESLint's "file ignored" warning): not determined. 016-33 open question 1 still stands.
2. Whether the worker's CPU should take a slot from the user's pool (011 C10) or a bound of its own: not determined. No spec says how a code check shares capacity with test tiers.
3. Whether a lint config change should be one summary line, like 015's recount, or a transition per file: not determined. It needs the dogfood's count of files per config change.
4. Which repository dogfoods it: not determined. This one uses Biome. cezar's linter was not checked.

## Sources

- Squeal at `7e3e54bb8`: `src/core/types/{code,code-delivery,check,runner,delivery,policy}.ts`; `src/core/code/store/{schema,open,states,views,transitions}.ts`; `src/core/code/pass/{index,types,source,included}.ts`; `src/core/code/crap/loaders.ts`; `src/core/code/coverage/{mapper,map-worker}.ts`; `src/core/daemon/{daemon,policy-code}.ts`; `src/core/state/fingerprint.ts`; `src/core/store/{codec,schema}.ts`; `src/core/keys/{check-key,environment,observed}.ts`; `src/core/delivery/{format,code-format,code-coverage}.ts`; `src/core/status/{format-status,code-status}.ts`; `src/harness/shared/{deny,stop,stop-code,text}.ts`; `src/cli/{main,code-report,code-coverage}.ts`; `evals/lib/squeal-text.mjs`; `test/keys/validity/components.ts`; `tsconfig.json`; `package.json`; `squeal.config.json`.
- `origin/cand/0.1.341` at `678cf1ba9`: commit `dc88f24a6` (policy defaults), `test/evals/code-lines.test.ts`.
- Specs: [015 spec.md](../../015-coverage-complexity/spec.md) D1 to D7; [011 spec.md](../../011-core/spec.md) C3, C4, C5, C8, C14; [016 seams.md](../../016-extensions/research/seams.md) F3; [016 diagnostic-identity.md](../../016-extensions/research/diagnostic-identity.md); `binding-cost.md` (016-34, on `origin/main` at `7a9047fd6`, not yet in this worktree).
- Probe: [probes/lint-seams/surfaces.ts](probes/lint-seams/surfaces.ts), [out.txt](probes/lint-seams/out.txt).
