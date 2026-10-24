# Specifications

One folder per feature or subsystem. Folder name is `NNN-short-title`, numbered in the order work started.

Each folder contains:

- `spec.md`: the agreed design. Written before implementation, kept current after.
- `status.md`: stage (`draft`, `approved`, `in-progress`, `shipped`, `superseded`), linked issues and PRs, open questions.
- `lessons.md` (optional): what we learned once it shipped.
- `attachments/` (optional): preserved snapshots, sample payloads, logs.

Use `TEMPLATE.md` for a new spec. Reference code by commit hash or PR number; do not paste code that will drift.

## Index

| # | Feature | Stage |
|---|---------|-------|
| 001 | Core validation loop (watcher, revisions, Vitest adapter, state, events, status) | shipped; frozen 2026-10-17 as history, split into 011, 012, 013 (`001-core-loop/split-proposal.md`) |
| 002 | Codex adapter (second harness: hooks, delivery, install) | shipped |
| 003 | node:test runner (second runner: closure, affected selection, results) | shipped |
| 004 | Slow suites by policy (e2e and integration suites at checkpoints) | shipped |
| 005 | Agent adoption (getting agents to rely on Squeal instead of their own test runs) | in-progress |
| 006 | Model evals (a recurring baseline of how models use Squeal) | shipped |
| 007 | pytest runner (third runner: environment, Python module graph, results) | shipped |
| 008 | OpenCode adapter | shipped |
| 009 | Pi adapter (in-process extension: delivery, wake, install) | shipped |
| 010 | CI cost (triggers, docs-only skip, one full Node in shards) | in-progress |
| 011 | Core (observation, keys, scheduling, state, status, store, daemon, policy, adapter contracts; from 001) | shipped |
| 012 | Claude Code adapter (hook events, idle waiter, packaging; from 001 D9) | shipped |
| 013 | Vitest runner adapter (instance, invalidation, closure, runs, gate; from 001 D4) | shipped |
| 014 | squeal ps (every daemon and test process with CPU and memory, the host totals, what should not be up) | shipped |
| 015 | The code squeals (complexity, coverage and CRAP per function, shared between worktrees; opt-in) | approved |
| 016 | Extensions, narrowed: one correctness kit for every runner and the three repeat seams (runner per check, one observed-path write, runner names out of `harness/shared`); public half decided later | draft |
