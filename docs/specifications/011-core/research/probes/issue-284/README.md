# Issue 284 probe

Throwaway research fixture, not a product regression test. Run from the repository root:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-284/reproduce.mts
```

It checks `/proc/loadavg` against the CPU count, creates temporary main and lint stores, registers a consumer, inserts a completed config keying with no findings, and calls the real Codex Stop handler. The test inventory and lint result are synthetic passes. The daemon heartbeat and ensure result are synthetic too; it starts no daemon, linter or test runner. It removes its temporary directory in `finally` and needs only the repository's existing dependencies. Do not commit `node_modules`.

On Squeal 0.1.636, commit `13e3a35bd04d3796f8082764e6bdcad140fd8e3f`, Node v26.13.0, load 0.91 on 16 CPUs: exit 0. First Stop returned `decision: block`, `Lint config changed: 0 files with findings now`, and `Known failures: 0`. The continuation and next ordinary Stop returned `null`.

This proves the stored-summary delivery mechanism, not the issue's original branch switch or its unspecified harness. See [findings](../../issue-284.md) for normative rules, source seams and limits.
