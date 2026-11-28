# Issue 310 probe (throwaway)

Run from the repository root with `pnpm exec tsx docs/specifications/011-core/research/probes/issue-310/probe.ts`.
This calls the real reconciler, installed-dependency fingerprint reader and lint
refresh classifier over a tiny synthetic pnpm layout. It creates and removes
its fixture under this directory. It does not run pnpm install, a daemon, a
runner, ESLint or a test suite. Its store is the existing in-memory test fake.

The timestamp touch, identical-byte rewrite and content-change control share
one populated stat cache. The last case deliberately drops that cache to show
why a reported lockfile path alone does not establish a timestamp-only bug.
Results are recorded in `output.json`; the owning findings file states limits.
