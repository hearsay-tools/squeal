# Issue 129 throwaway probe

This is a synthetic research fixture, not a product regression test. It fabricates
function counts and mapped coverage records, then uses the existing coverage rig,
real coverage judgement, `readCodeReport` and `formatCodeReport`. It does not run
Cezarion, a daemon, the V8 collector or the real complexity counter.

The rig creates and removes private temporary stores and a fake worktree. It does
not open the repository's shared stores. No dependencies or `node_modules` belong
in this directory. The custom config selects only this probe; the normal Squeal
test configuration does not include it.

From the repository root, check load before running:

```sh
node -p 'JSON.stringify({at:new Date().toISOString(),load1:require("node:os").loadavg()[0],cpus:require("node:os").cpus().length})'
pnpm exec vitest run --silent=false --config docs/specifications/015-coverage-complexity/research/probes/issue-129/vitest.config.ts docs/specifications/015-coverage-complexity/research/probes/issue-129/probe.test.ts > docs/specifications/015-coverage-complexity/research/probes/issue-129/result.txt 2>&1
```

Skip the run if one-minute load exceeds the CPU count. `result.txt` preserves the
2026-10-30 run: one test passed. It shows the raw internal summary, CLI report and
text before and after the skipped loader completes. See [findings](../../issue-129.md).
