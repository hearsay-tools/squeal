# 007 pytest runner: status

Stage: approved (2026-10-14, the human); waves on `docs/board.md`, briefs under `tasks/`.
Started: 2026-10-13

## Decisions so far

- 2026-10-13, the human: start preparing pytest support. ADR 0001 named pytest the second runner; ADR 0004 moved it behind Codex and node:test because no project of ours needed it then. This spec is the third runner.
- 2026-10-13, the human: testmon may be the thing to use. 007-02 evaluates it as a component (driving `pytest-testmon` or reading its data), against goal 4 and the shared store, beside a static graph.
- 2026-10-13, the human: dispatch mixed (Astra on `pytest-runner-api`, Opus on the other two); a generic fixture, no reference project.
- The product promise holds as in ADR 0004: only the needed tests run, and only the delta reaches the agent. A design that re-runs a whole pytest invocation on every revision does not meet it and is out.
- The adapter implements `RunnerAdapter` from `src/core/types/runner.ts`. A finding that seems to need an interface change is an open question for the spec, not a decision. node:test (spec 003) is the closest precedent: no warm instance in the daemon's own runtime, a static graph checked by an observed one.
- Check keys stay computable in a fresh worktree without running anything (spec 001 goal 4). For Python this is harder than for node:test: the daemon runs on Node, the plugin is an esbuild bundle without native addons (003 status, before wave 1), and a fresh worktree often has no virtual environment yet.
- The agent-facing side is not researched here: the texts, the skill and the hooks that today name Vitest and node:test (spec 005) grow pytest commands (`pytest`, `python -m pytest`, `uv run pytest`) as one row of the spec, read from 005's code.
- Slow pytest suites (integration, e2e marked tests) take spec 004's policy; this spec makes them runnable, not scheduled.

## Amendments after approval

- 2026-10-14, at approval, the human: the spec stands as drafted. Open question 1 is not decided yet: research row 007-04 (`research/README.md`, topic `no-venv-resolution`) measures resolving a worktree without an environment from the build backend's declared layout; D2 and D4 keep `unknown` without an environment until its findings land, and the graph row (007-12) leaves room for the fallback.
- 2026-10-14, wave 0 (007-10, 007-11), 0.1.161: D2 amended by 007-04's finding, already built by 007-10: every path inside the worktree is written as `<worktree>` in the hashed `.pth` and `direct_url.json` bytes and the config path, so two worktrees synced from one lock hash equal (goal 2); a test proves it. The shared per-entry validation of `nodeTest` and `pytest` lives in `src/core/daemon/policy-node-test.ts` (agreed). Fixtures under `test/fixtures/pytest/`; `small/src/app/core.py` is the edge-case file; CI installs uv and Pythons 3.10 and 3.13; `test/helpers/pytest-env.ts` skips without uv locally and fails under `CI`.
- 2026-10-14, 007-04 (`research/no-venv-resolution.md`), coordinator, folded into D4 and D5: without an environment the resolver uses import roots derived from `pyproject.toml` (equal to what `uv sync` writes on 8 trees, 4 of them real projects); closures equalled the synced ones for 97 of 97 test files. D4's candidate rule changes for every worktree: a winner outside the worktree (stdlib, site-packages) does not end the candidate scan, and without an environment the bundled `sys.stdlib_module_names` of each supported minor stand in for the stdlib, so a synced and an unsynced worktree compute identical closure hashes. So `affected` and the closure half of a key work without an environment (row 007-12). The environment half has no stand-in: no environment stays `unknown` as D2 says. Inheriting into an unsynced worktree through a lock-to-environment record written by a synced one is open question 1, now for the human with that evidence. 007-12 must skip `TYPE_CHECKING` bodies by node id, not wrapper identity (the 007-02 probe's bug, found by 007-04).
