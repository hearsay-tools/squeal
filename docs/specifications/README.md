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
| 001 | Core validation loop (watcher, revisions, Vitest adapter, state, events, status) | shipped |
| 002 | Codex adapter (second harness: hooks, delivery, install) | shipped |
| 003 | node:test runner (second runner: closure, affected selection, results) | approved |
| 004 | Slow suites by policy (e2e and integration suites at checkpoints) | approved |
| 005 | Agent adoption (getting agents to rely on Squeal instead of their own test runs) | approved |
| 006 | Model evals (a recurring baseline of how models use Squeal) | draft |
| 007 | pytest runner (third runner: environment, Python module graph, results) | approved |
| 008 | OpenCode adapter | draft |
| 009 | Pi adapter (in-process extension: delivery, wake, install) | shipped |
| 010 | CI cost (triggers, docs-only skip, one full Node in shards) | draft |
