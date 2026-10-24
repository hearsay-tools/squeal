# 016 extensions: status

Stage: draft (research only; no spec yet)
Started: 2026-10-24

## Decisions so far

- 2026-10-24, the human, a big idea to research: could Squeal be reorganized as a core plus extensions? Harness adapters connect other harnesses through a clear contract they must satisfy. pytest, node:test, Vitest, complexity and CRAP become plugins or extensions. The aim is to let people extend Squeal themselves, for adoption and for an ecosystem of every kind of live feedback an agent should get: tests, quality metrics, linters. "No way I can support every language / testing framework there is on my own." Research thoroughly first, then report.
- 2026-10-24, the coordinator's assumptions, for the research to confirm or change:
  - The core keeps the promise: revision provenance, transitions, keys, the shared store and status. An extension must not be able to break it silently; a third-party check that gives a false pass costs Squeal's trust, not the extension's.
  - Extension has tiers: no code (a command and an output format), a declarative manifest, and code with the full contract (affected selection, a warm process, focus).
  - A third-party runner may be written in another language, so a process boundary is likely for at least one tier.
  - The harness contract is the smallest (vision principle 6: three operations) and the closest to ready; the runner contract is the largest.
  - Our own runners would move behind the public contract, so it is tested by real use.

## Open questions

1. In-process JavaScript modules, an out-of-process protocol, or both, and for which tier?
2. What is the minimum a check provider must give for transitions, keys and the shared store to stay trustworthy?
3. Which existing standard (Build Server Protocol, LSP diagnostics, TAP, JUnit XML, SARIF, Microsoft.Testing.Platform, `go test -json`) to adopt, and what Squeal must add to it?
4. What moves out of the core today, at what cost, and with what risk to the shipped runners and harnesses?
5. Distribution, discovery and trust of third-party extensions; whether an ecosystem can form while `package.json` says `"private": true` and `"license": "UNLICENSED"`.
6. Does extensibility drive adoption for a tool like Squeal, and what does a public API cost to keep?

## Amendment log
