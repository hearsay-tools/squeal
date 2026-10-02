# 0001. V1 stack: TypeScript, Vitest first, Claude Code first

Date: 2026-10-02
Status: accepted

## Context

Squeal v1 has to prove the interaction model (push transitions, pull state) with one test ecosystem and one harness adapter. The vision keeps the core independent of any runner or harness, so the first choices are about speed of proof, not permanent commitment.

## Decision

- Squeal is written in TypeScript on Node.
- The first runner adapter targets Vitest.
- The first harness adapter targets Claude Code hooks.

## Alternatives considered

- Python with pytest first. Matches the vision's example output and pytest's plugin system is mature. Rejected for v1 because harness adapters would need a runtime shim and affected-test selection needs third-party plugins.
- Go or Rust. Single binary and a fast watcher. Rejected for v1 because iteration is slower and there is no native test-runner API to lean on.
- Jest first. Widest install base. Rejected because Vitest offers a programmatic API, built-in related-file selection and warm watch mode.
- Pi or Codex as first harness. Pi matches the mega.dev operating model and Codex has the larger user base. Rejected for v1 because Claude Code already exposes hook points at tool-result, turn and stop boundaries, which is exactly where Squeal injects.

## Consequences

- Affected-test execution reuses Vitest's own file graph; Squeal does not build dependency analysis in v1.
- The Claude Code adapter can be a dependency-free Node script invoked by hooks.
- pytest is the second adapter and the test that the runner boundary generalises.
