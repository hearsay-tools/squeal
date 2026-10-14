# 007 wave 2 briefs

007-14 and 007-15 run in parallel on disjoint seams, on 0.1.163. 007-16 reviews waves 0 and 1 at the same time (the next hub release waits on it, 005's human, 2026-10-14); 007-19 reviews wave 2 once both rows land. Workers read `docs/vision.md`, `docs/styleguide.md`, `docs/specifications/007-pytest-runner/spec.md` and `status.md` (every 2026-10-14 amendment) first. Python environments come only from `test/helpers/pytest-env.ts`. Do not run `npm run build` in your worktree and leave `plugins/*/dist` and `src/core/keys/key-format.ts` alone; the coordinator rebuilds and re-pins at integration. Running beside you on main: 001-349 (a `vitest.excludeProjects` policy key: `src/core/types/policy.ts`, `src/core/daemon/policy.ts` and Vitest construction) and 005's setup rows later; touch none of their lines, and ask before editing either file.

## 007-14 the pytest adapter in the daemon

Outcome: a repository with `pytest` projects is validated by the daemon beside its Vitest and node:test suites: baseline, inheritance into a second synced worktree, and a `PASS -> FAIL` delivered through both harnesses (spec goals 1, 2, 5, 7, 8; D2 to D7 assembled).

Read: spec D2 to D7; 003 spec D3 (observed-only paths in a `meta` key) and D7 (the composite); `src/runners/node-test/adapter*.ts` and `src/core/daemon/node-test-runners.ts` for the shape to follow; `src/runners/pytest/environment/index.ts` (`readEnvironment`), `src/runners/pytest/environment/config-values.ts`, `src/runners/pytest/graph/index.ts`, `src/runners/pytest/enumerate.ts`, `src/runners/pytest/run/run.ts`.

Shape: slice. Seam: `src/runners/pytest/adapter.ts`. First edit: `createPytestAdapter(project, deps)` implementing `RunnerAdapter` over the environment (every state but `ready` is `unknown` with its note; a changed fingerprint recreates), the graph with `config-values` wired into its inputs (`python_files`, `python_classes`, `python_functions`, `pythonpath`, the import mode from `addopts`), `enumerate` and `runPytest`. Then `src/core/daemon/pytest-runners.ts` beside `node-test-runners.ts` with the observed-only paths in a `meta` key per project, written with the stored closure in one transaction as 003 D3; the construction lines in `daemon.ts`; the pytest cache and pycache directory under Squeal's state directory, not the OS temp directory (`status.md`, open question 3); a bundled smoke test that the built CLI loads both `.wasm` files and finds `squeal_pytest.py` from `dist/pytest/` (build into a temp outdir with `buildDist`, never into `plugins/`).

Owns: `src/runners/pytest/adapter*.ts`, `src/core/daemon/pytest-runners.ts`, the pytest lines in `src/core/daemon/daemon.ts`, the pytest meta-key names in `src/core/types/`, small fixes inside `src/runners/pytest/**` that the assembly needs (name each in your report), `test/runners/pytest/adapter*.test.ts`, `test/integration/pytest*.test.ts`, `test/harness/pytest-bundle.test.ts`. Leave alone: `src/harness/**`, `src/cli/**`, skills and plugin texts (007-15).

Done when: an integration test on the `small` fixture with a Vitest suite beside it runs a baseline, inherits it into a second worktree with its own `uv sync` with zero runs, and delivers a `PASS -> FAIL` for exactly the files importing an edited module through the Claude Code and Codex hooks; an observed-only path persists, re-keys its file and blocks inheritance when changed; a worktree without `.venv` reports `unknown` with D2's note and resolves once `uv sync` runs; the bundled smoke test passes; lint, typecheck and the full suite green apart from the expected drift.

Use /worker.

## 007-15 agent surfaces and setup for pytest

Outcome: what the agent reads and what `squeal setup` writes name pytest projects where they name Vitest and node:test, and 005 D8's one-time deny recognises pytest commands narrowly (spec D8, D1's setup paragraph).

Read: spec D1 (last paragraph) and D8; 005 spec D3, D6 and D8; `src/harness/shared/test-command.ts`, `test-command-files.ts`, `deny.ts`, `primer.ts`, `coverage.ts`; `src/cli/setup/` (`candidates.ts`, `plan.ts`, `test-globs.ts`, `apply.ts`, `block.ts`); `src/cli/node-test-seed.ts`; both plugins' `skills/squeal/SKILL.md` and `references/`; `src/runners/pytest/environment/` (discovery, `config-values.ts`).

Shape: slice. Seam: `src/harness/shared/test-command.ts`. First edit: a `pytest` arm of `TestCommand` and its recognition: `pytest`, `python -m pytest`, `uv run pytest`, `<env>/bin/pytest` and `<env>/bin/python -m pytest`, with test paths and node IDs as arguments and only output flags (`-q`, `-v`, `-r...`, `--tb=...`, `-s`), run from a configured project's `cwd`; every other form, flag and environment assignment falls through. Then resolution of its files in `test-command-files.ts`, the deny text naming pytest, the primer and coverage lines; `squeal setup` seeding `pytest` entries by D1 (projects detected from a pytest config or `tests/` beside `pyproject.toml`, `include` from `testpaths` and `python_files`, a note for refused flags in `addopts`), the instruction block and both skills naming pytest.

Owns: `src/harness/shared/**`, the pytest parts of `src/cli/setup/**` and a new `src/cli/pytest-seed.ts`, `plugins/*/skills/squeal/**`, `test/harness/shared/**`, `test/cli/setup/**` (pytest cases), `test/cli/pytest-seed.test.ts`. Leave alone: `src/runners/**`, `src/core/**` (007-14), the Vitest and node:test recognition (change no existing case; existing tests stay untouched and green).

Done when: recognition tests cover every recognised pytest form and the fall-through list (chains, `-k`, `-x`, `--lf`, `-n`, a `cd`, an assignment, another `cwd`); the deny resolves a recognised pytest command to the project's files and names them; setup seeds both projects of a two-project fixture and notes a refused `addopts` flag; skill texts name pytest; lint, typecheck and the full suite green apart from the expected drift.

Use /worker.

## 007-16 review of waves 0 and 1

Shape: review. `/reviewer` over `638fb159..a67407f8` (0.1.161 and 0.1.163), including `0ba56c76`'s refactor of `src/core/daemon/policy-node-test.ts`, which is live for every `nodeTest` config (005 flagged it; the next hub release waits on this review). Nothing in `src/runners/pytest/` is wired into the daemon yet, so judge it as a library against the spec. Focus:
- Whether the refactor is behaviour-preserving for `nodeTest`: messages, defaults, the duplicate-name rule.
- Keys: closure hashes equal across synced worktrees and with and without `.venv`; D4's amended candidate rule; the environment hash's `<worktree>` rewrite.
- D2's refusal states: no environment, an editable install outside the worktree, a sync during a run.
- D6's completion rule: a killed batch keeps only completed files; a passed call before a killed teardown is not complete.
- The refused-flag checks, both the static one and the runtime one.

Write `docs/specifications/007-pytest-runner/reviews/wave-1.md`. Done when it is committed.

Use /reviewer.

## 007-19 review of wave 2

Shape: review. `/reviewer` over the landings of 007-14 and 007-15 and any 007-16 repair. Focus: the adapter's assembly, inheritance across synced worktrees, the observed-only `meta` key, and the deny's fall-through. Write `reviews/wave-2.md`.

Use /reviewer.
