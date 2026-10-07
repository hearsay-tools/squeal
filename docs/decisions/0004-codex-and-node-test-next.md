# 0004. After the core loop: Codex adapter and node:test runner, in parallel

Date: 2026-10-07
Status: accepted

## Context

Spec 001 shipped the core loop with one runner (Vitest) and one harness (Claude Code). ADR 0001 named pytest as the second runner and left Codex, Pi and OpenCode as later harnesses. The human's own work since then runs on Cezar, whose workers run on Codex as well as Claude Code, and whose reference project keeps its unit and e2e suites in Node's built-in test runner behind npm scripts. Squeal gives those workers nothing today: a Codex worker has no adapter, and a node:test suite is invisible to the Vitest runner.

## Decision

- Spec 002 is a Codex harness adapter. Spec 003 is a node:test runner adapter. They are researched and built in parallel: disjoint seams, crossing only at `squeal init` and the policy file, which becomes one later row.
- Spec 004, after 003, is slow suites by policy: a check class that runs at checkpoints rather than on every revision, for e2e suites.
- The runner spec keeps the product promise as stated by the human: only the needed tests run, and only the delta reaches the agent. A runner that cannot select affected test files per revision does not qualify.
- pytest, Pi and OpenCode move behind these.

## Alternatives considered

- pytest second, as ADR 0001 said. Rejected for now: no project of ours needs it today, and node:test tests the runner boundary harder, since it offers no module graph and no warm instance.
- A generic command runner that runs a declared npm script and parses TAP or the exit code. Rejected as the answer to "npm unit tests": it cannot select affected tests, so every change re-runs the suite and the promise fails. It may return later as an extra check type.
- Codex first alone, or runners first. Rejected: the seams are independent, and each spec pays for itself alone, so parallel work costs only researchers, not rework.

## Consequences

- The runner boundary is proven by a runner without a module graph; closure and affected selection become Squeal's own work for the first time.
- The harness boundary is proven by a harness without an idle wake and with a sandbox; the vision's "pull at the next turn" is the fallback.
- `squeal init` grows a harness choice. ADR 0001's consequence "pytest is the second adapter" is superseded by this record; its decision stands.
