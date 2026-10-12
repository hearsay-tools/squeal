# Research: the primer names the suites Squeal does not cover

Board row 001-290. Read: `src/harness/shared/primer.ts` and `coverage.ts` at main `ba74d3ad` (0.1.127), the 001-283 primer at `ccdfa6b7`, spec 001 D9 and D11, 004 D8, `research/primer-skill-writing.md`, 005's `model-evals.md` and `model-evals-baseline.md`, `evals/results/TREND.md`, `src/cli/node-test-seed.ts`, `src/core/daemon/policy.ts`. Node v24.21.0, host load 9 to 11 on 24 CPUs.

Probes, throwaway and kept out of the tree because this row commits one file (published as task artifacts, see Sources): `detect.mjs`, every lens at once; `gaps.mjs`, one candidate rule that writes the sentence; `room.ts`, the primer's length per scenario through the real `primer()`. They read files only and run nothing in the target. Corpus: Squeal, `evals/ledgerline` (the T2 trap), five local repositories read in place (cezar: pnpm + Vitest projects + node:test; prime: nx + Jest, no root scripts; toolkit-dev: npm + node:test + pytest; mvp-unveiled: bun workspaces + Playwright; earwitness: Python only), and nine scratch repositories (a to i) for Playwright, Jest, Cypress, Mocha, pytest, cargo, go, a second Vitest config, node:test inside and outside `nodeTest`, and nothing at all.

## Questions answered

| # | Answer | Tag |
|---|---|---|
| 1 | Root `package.json` scripts are the one lens that is cheap and gives a runnable command; 5 of the 7 corpus repos have one. CI `run:` lines are the fallback for repos with no scripts (prime, earwitness). Runner configs give a kind, not a command; a last resort. Workspace packages' own tests cannot be told covered or not without loading the Vitest config. | verified by experiment |
| 2 | In the hook, on every primer build: 0.5 to 1.7 ms for the candidate rule, 1.4 to 7 ms median for every lens, 25 ms worst (cold, 14 workflows), against a 140 to 200 ms Node start and a 2 s timeout. No cache needed. Failure falls back to today's sentence. | verified by experiment |
| 3 | Name up to 4 commands, tests first, with their source; fold the rest into "and N more"; say nothing new when none is found. Fits the cap in every scenario measured (room 255 to 893 characters, the list adds 18 to 145). Whether naming moves the metric is not determined: needs an eval variant. | verified by experiment (length); not determined (effect) |
| 4 | Both: a policy key wins when present (an empty list says "nothing else"), detection otherwise. | inferred |
| 5 | Four rows, the eval variant first. | inferred |

## Findings

### 1. What each lens sees

**Scripts (verified by experiment).** A rule keeping scripts named `test*`, `e2e*`, `typecheck`, `lint*`, `check*`, `verify`, `validate`, `build*` gave, per repo: ledgerline `npm run test:scripts` (exactly the T2 trap); toolkit-dev `npm test` (node:test plus pytest), `lint`, `verify`, `validate`; cezar `test:unit`, `test:package` (both node:test), `test:e2e`, `typecheck`, `build`; mvp `test:e2e` (Playwright), `typecheck`, `lint`, `build`; Squeal `typecheck`, `lint`, `build`. The package manager comes from the lockfile (`pnpm-lock.yaml`, `bun.lock`, `yarn.lock`, else npm).

False positives seen, each verified in the file:
- watch scripts (`test:watch`, bare `vitest`): never exit. Dropped by name and `--watch`.
- scripts that need arguments: Squeal's `check:version` (CI passes `-- "$BASE" HEAD`), toolkit-dev's `check-versions` (ends in `--`, caught). Squeal's is not caught by any text rule.
- selection helpers: cezar's `test:changed` ("Iteration feedback only: never substitutes for the final validation gate").
- side effects: mvp's `build` is `bun run db:migrate && ...`, a migration with `.env`. Telling an agent to run it is wrong. This is the case against naming `build` scripts.
- names outside the pattern miss: scratch c's `cy` (`cypress run`). Matching the command against known runners as well catches it (`detect.mjs` does).

False negative found and fixed in the probe: a parent script hides the children it runs (cezar's `typecheck` runs four `typecheck:*`), but `npm --prefix tools/generator run test` is another package's `test`, and a naive rule hid toolkit-dev's root `test`, the repo's main uncovered suite. Only same-package `run <name>` without `--prefix`, `-w`, `--workspace`, `--filter` counts.

**What a covered suite looks like (verified by experiment).** `vitest` or `vitest run`, alone or as `npx`/`pnpm`, is covered when coverage.ts says Vitest is (scratch a, g, h; ledgerline; cezar). `vitest run --config vitest.int.config.ts` is not: Squeal loads only the root config (scratch g names it). `node --test <globs>` is covered when every glob is one of a `nodeTest` project's `include` (scratch g drops `test:scripts`, h without `nodeTest` names it). That comparison is string equality: a shell-expanded glob, a `cwd`, or `--import` flags before `--test` make a covered script look uncovered (inferred). `src/cli/node-test-seed.ts` already parses `node [flags] --test <globs>` scripts for `squeal init` (read in source code); a detector should reuse it rather than write a second parser.

**CI (verified by experiment).** GitHub Actions `run:` lines, including `run: |` blocks line by line, without a YAML parser. For repos without root scripts it is the only source: prime's 16 `pnpm nx run <project>:<target>` lines, earwitness's `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest` (complete). Noise: install, deploy, publish and bot steps (cezar has 532 `run:` lines in 14 workflows), CI-only flags (`--shard=${{ matrix.shard }}/2`, `--maxWorkers=20%`, `--coverage`), matrix expressions (dropped). Block lines are often not standalone commands. Other CI systems are seen only as files: prime also has `bitbucket-pipelines.yml`.

**Runner configs (verified by experiment).** File presence names the kind: `playwright.config.*`, `jest.config.*`, `cypress.config.*`, `.mocharc*`, `pytest.ini` or `[tool.pytest` in `pyproject.toml`, `Cargo.toml`, `go.mod`. The command must be made up (`npx jest`, `pytest`, `cargo test`, `go test ./...`); the canonical forms are from memory, not fetched (inferred). Useful only where scripts and CI say nothing (scratch b, d, e, f). mvp's Playwright config sits in `e2e/`, found only through its script.

**Workspaces (verified by experiment, coverage inferred).** cezar's four packages each have `test: vitest run`, covered because the root `vitest.config.ts` lists them as `projects`. Telling that from a hook means evaluating the config, which runs project code. The daemon has `vitest.projects` in hand (`src/runners/vitest/adapter.ts`), so only the daemon could say which package roots are covered (inferred). mvp's six packages run `bun test`, which Squeal never covers, and no root script or CI line runs them all: the root lenses miss them, and the workspace lens sees the scripts but not a command to run them from the root.

### 2. When and where

Measured in a fresh Node process per run, 15 runs per repo (verified by experiment): every lens, `detect.mjs`, median 1.7 ms (ledgerline) to 6.8 ms (cezar, 25 files read), max 25 ms (cezar's first run). The candidate rule, `gaps.mjs`: 0.5 to 1.7 ms. Reading cezar's 14 workflows (121 KB): 1.0 ms. For scale: hooks have a 2 s timeout on both harnesses (001 D9, 002 D4), a Node start is 140 to 200 ms under load (002 D4), and SessionStart already waits up to 750 ms for a heartbeat.

The primer is built only on registration: SessionStart, SubagentStart, `compact`, and the first PostToolBatch or UserPromptSubmit that registers (`session.ts`, `deliver.ts`, `prompt.ts`, read in source code). Codex goes through the same `startSession` (`src/harness/codex/handlers.ts:28`). No per-tool hook pays it.

So the hook can detect directly, beside `coverageOf`, which already reads `squeal.config.json` and stats 12 config names. A daemon-side cache would cost a store row and a stale window, and would not exist when it matters most: a repository with no store yet gets the primer from SessionStart before any daemon ran (001 D9). On failure: the hook exits 0 with no output on any internal error (001 D9), so an exception inside primer building would drop the whole registration (inferred); detection must catch its own errors and fall back to today's sentence. Bound the reads (file size, number of workflow files, workspace depth) so a large repository cannot approach the budget (inferred).

### 3. Wording and the cap

Room left under 1,500 characters, from the real `primer()` (verified by experiment):

| Scenario | main | 001-283 |
|---|---|---|
| Claude Code, Vitest | 855 | 893 |
| Claude Code, Vitest, slow | 509 | 468 |
| Claude Code, Vitest, 2 node:test projects, slow | 380 | 339 |
| Codex (82-character CLI path), Vitest | 779 | 817 |
| Codex, Vitest, 2 node:test projects, slow | 296 | 255 |
| 4,095-character path, 2 node:test projects, slow | 420 | 379 |

The closing sentence is 83 characters. With up to 4 commands shown (`gaps.mjs`'s "such as" form) it was 101 to 228 characters across the 15 repos with a command, so it adds at most 145 and fits the tightest scenario unfolded; the form proposed below differs by about 15 characters. 4 is a choice, not a limit: the longest command seen is 33 characters, so the tightest room holds about 7.

By `writing-for-agents` (001-283's levers): a command is the concrete next step (demand); the source is a context pointer for the rest ("and 3 more in package.json scripts") and provenance for a list that may be wrong; tests first, because every false pass in 005's pilot came from an uncovered test suite; the existing sentence's words stay, so nothing already decided changes. Proposed form, one per source:

> Squeal does not cover typecheck, build or any other test suite: run those yourself; package.json names `npm run test:scripts`.

> ...; package.json names `pnpm run test:unit`, `pnpm run test:package`, `pnpm run test:e2e`, `pnpm run typecheck` and 3 more.

When nothing is found, the sentence stays as it is: "found no other suite" would claim an absence the lenses cannot prove (mvp's packages).

Fold order: the uncovered list folds last, after the node:test projects and the CLI naming, and if it must fold, to "N commands in package.json scripts" with none named.

Effect, not determined: on 0.1.123 and 0.1.124, `own-run-uncovered` was met in 2 of 12 Codex GPT-6-Luna cells (T2 0/3 and 2/3, T4 0/3 and 0/3) and 6 of 6 for the other three models in each run (`TREND.md`, line d227d82bd417). Those primers already said "any other test suite". Whether naming `npm run test:scripts` moves Luna is the question an `evals/variants/*.json` text patch answers before any code: the fixture is fixed, so the variant can replace the closing sentence in `plugins/*/dist` with the literal ledgerline sentence (variants patch dist strings, `slow-step.json`, read in source code).

### 4. A policy key

Detection alone cannot remove Squeal's `check:version` or cezar's `test:changed`, and cannot see mvp's package tests. A list in `squeal.config.json` of the commands to run (or `[]` for none) is exact and is project policy (decision filter 5). Absent, detect. `squeal init` can print the detected list as a suggestion, as it does for `nodeTest` (read in source code, `init.ts`). An older daemon reads the new key as `unknown key "<name>"` and persists a note (`policy.ts:151`, read in source code): the same cost every key added since 001 had. A detected `node --test` script that `nodeTest` does not list is better closed by covering it: `init` already seeds such scripts (spec 003 D1).

## Recommendation for Squeal

Name the uncovered commands from root `package.json` scripts, with CI `run:` lines and runner configs as fallbacks, computed in the hook beside `coverageOf`, catching every error. Name only test-shaped scripts concretely, plus `typecheck` and `lint` by exact name; leave `build` to the generic word because of side effects. Put the source in the sentence. Add the policy key as the override. Measure the wording with a variant before building detection.

Rows, in the board's shape:

| Task | Status | Scope | Done when |
|---|---|---|---|
| 001-291 eval variant: the primer names the uncovered suite | planned | `evals/variants/uncovered-named.json`: patch the closing sentence in both plugins' `dist` to name `npm run test:scripts` with its source, ledgerline only. Run T2 and T4 against `p0` on Luna and Sol (and Haiku, Sonnet if the budget allows), about 24 sessions per arm (005's rule). | Results file committed; `own-run-uncovered` per model and arm in `status.md`; the coordinator decides whether 001-292 and 001-293 go ahead. |
| 001-292 detect the commands Squeal does not cover | planned, after 001-291 says yes | `src/harness/shared/uncovered.ts` and `Coverage` gains the list and its source: root scripts by name and by known runner, minus watch scripts, trailing `--`, same-package children, covered Vitest (root config, no `--config`, `--root`, `--dir`) and node:test (via `parseTestScript`, globs in a `nodeTest` include); lockfile package manager; else GitHub `run:` lines matching known checkers without `${{`; else root runner configs. Bounded reads, never throws. Fixtures: this file's scratch cases a to i, ledgerline, and the toolkit-dev `--prefix` case. | Fixture tests pass; a throwing read yields today's sentence; a timing test on the largest fixture stays under 10 ms. |
| 001-293 the primer names them | planned, after 001-292 | `primer.ts`: the closing sentence appends "<source> names" and up to 4 commands, tests first, "and N more"; unchanged when none. Folds last. Both harnesses; the cap tests with the 4,095-character path; spec 001 D9 and 004 D8 amended by the coordinator. | Primer tests for none, one, five, and the tightest scenario within 1,500. |
| 001-294 a policy key for what Squeal does not cover | planned, after 001-293 | D11 key (a list of commands, `[]` for none) that replaces detection when present; `squeal init` prints the detected list as a suggestion. | Policy and primer tests; `init` test shows the suggestion. |

## Open questions

- Does naming the command move `own-run-uncovered` for Luna? 001-291 decides; nothing here measured it.
- Should the primer say when to run them ("after you change what they test", 006's expectation)? Not asked here.
- Workspace packages' own tests (mvp's `bun test`): only the daemon's `vitest.projects` can tell covered roots, and naming per-package commands needs per-manager syntax not verified here.
- Monorepo task runners (nx, turbo) hide targets in their own config; only CI named prime's.

## Sources

- Squeal main `ba74d3ad`: `src/harness/shared/{primer,coverage,session,deliver,prompt}.ts`, `src/harness/codex/handlers.ts`, `src/cli/{init,node-test-seed}.ts`, `src/core/daemon/policy.ts`, `src/runners/vitest/adapter.ts`, `evals/variants/slow-step.json`, `evals/ledgerline/package.json`, `evals/results/TREND.md`.
- 001-283 at `ccdfa6b7`: `src/harness/shared/primer.ts`, `docs/specifications/001-core-loop/research/primer-skill-writing.md`.
- Specs: 001 D9, D11; 002 D3, D4; 004 D8; 005 `research/model-evals.md` (finding 6, recommendation 4), `research/model-evals-baseline.md`.
- Corpus, read only: `~/projects/{cezar,prime,toolkit-dev,mvp-unveiled-july26,earwitness}` as of 2026-10-12.
- Probes: `detect.mjs`, `gaps.mjs`, `room.ts`, published as task artifacts with this report.
