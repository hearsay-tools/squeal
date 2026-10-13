# 007 pytest runner: status

Stage: research (brief in `research/README.md`; no spec yet).
Started: 2026-10-13

## Decisions so far

- 2026-10-13, the human: start preparing pytest support. ADR 0001 named pytest the second runner; ADR 0004 moved it behind Codex and node:test because no project of ours needed it then. This spec is the third runner.
- The product promise holds as in ADR 0004: only the needed tests run, and only the delta reaches the agent. A design that re-runs a whole pytest invocation on every revision does not meet it and is out.
- The adapter implements `RunnerAdapter` from `src/core/types/runner.ts`. A finding that seems to need an interface change is an open question for the spec, not a decision. node:test (spec 003) is the closest precedent: no warm instance in the daemon's own runtime, a static graph checked by an observed one.
- Check keys stay computable in a fresh worktree without running anything (spec 001 goal 4). For Python this is harder than for node:test: the daemon runs on Node, the plugin is an esbuild bundle without native addons (003 status, before wave 1), and a fresh worktree often has no virtual environment yet.
- The agent-facing side is not researched here: the texts, the skill and the hooks that today name Vitest and node:test (spec 005) grow pytest commands (`pytest`, `python -m pytest`, `uv run pytest`) as one row of the spec, read from 005's code.
- Slow pytest suites (integration, e2e marked tests) take spec 004's policy; this spec makes them runnable, not scheduled.

## Amendments after approval

None yet.
