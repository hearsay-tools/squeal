# Verification

Research-only changes. Runtime: Node v24.21.0 for repository checks.

```text
$ node check-results.mjs
74 recorded-observation checks passed on Node 22.23.3 and 24.21.0.

$ npm run lint
> squeal@0.1.14 lint
> biome check .
Checked 367 files in 355ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.14 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> squeal@0.1.14 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.14 build:plugin
> node --experimental-strip-types --disable-warning=ExperimentalWarning src/harness/claude-code/build.ts
(exit 0)
```

`git status --short` after build shows only research additions; committed plugin
bundles did not drift. Full Vitest output is preserved in `results/vitest.log`.


```text
$ npx vitest run
 Test Files  2 failed | 132 passed (134)
      Tests  2 failed | 1043 passed | 7 skipped (1052)
   Duration  165.41s (tests 91%, transform 6%, import 2%)
(exit 1)
```

Failures (no product changes made):

- `test/daemon/scratch.test.ts:137`: expected the scratch directory to be empty,
  found one generated entry after readiness. This was not the startup timing assertion.
- `test/daemon/lifecycle.test.ts:79`: readiness timeout after the daemon had
  already exited normally for its configured 1.8-second idle deadline.

Both failures concern daemon tests outside these research files. Their cause is
not established by a research-only diff; the targeted rerun is recorded below.


```text
$ npx vitest run test/daemon/scratch.test.ts test/daemon/lifecycle.test.ts --maxWorkers=1
 Test Files  2 passed (2)
      Tests  20 passed (20)
   Duration  76.94s (tests 98%, transform 2%)
(exit 0)
```

The same failures did not reproduce with one worker. This supports a concurrency
or load sensitivity hypothesis; it does not establish the cause or turn the
original full-suite run green. Exact rerun output: `results/vitest-targeted.log`.
No product files or committed bundles changed.
