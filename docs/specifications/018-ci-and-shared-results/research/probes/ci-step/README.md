# Probes for topic ci-step (row 018-13)

Throwaway. These scripts and outputs back `../../ci-step.md` and are not product code. Run them only in a scratch directory under `$TMPDIR`, never in a checkout.

Setup used (2026-11-09, Node v24.22.1): two directories `v4` and `v5`, each with `package.json` `{"type":"module","devDependencies":{"vitest":"<4.1.10|5.0.3>"}}`, `npm install --ignore-scripts`, then `npm install @vitest/browser-preview@<same version>`, and the files of `fixture/` copied in. `node_modules` is not kept.

- `isci.mjs <dir>`: prints std-env's `isCI`, `provider` and `isAgent` for the current environment.
- `dump.mjs <dir> [squeal|plain] [json options]`: `createVitest('test', …)` and prints every project's `serializedConfig` plus the root's `reporters`, `watch`, `open`, `ui`. `squeal` passes the options Squeal's daemon passes (`src/runners/vitest/adapter.ts` `#start`: `watch: false`, `update: "none"`, `includeTaskLocation: true`, a reporter, `fsModuleCache: false`, coverage off). The third argument adds options (`{"shard":"1/4"}`).
- `diff.mjs a.json b.json`: leaf paths whose values differ.
- `fixture/`: one node project and one browser-mode project (`@vitest/browser-preview`); `node/only.test.js` (a `test.only`), `node/snap.test.js` (a missing snapshot).
- Runs: `env -i PATH=$PATH HOME=$HOME [CI=true] [GITHUB_ACTIONS=true] [CLAUDECODE=1] node dump.mjs $PWD/v5 squeal`. TTY case through `script -qc`.
- `out/config-diffs.txt`: every diff the findings cite (`sequence.seed` removed).
- `out/merge-group-runs.tsv`, `out/main-commits.tsv`: cezarion `ci.yml` merge-group runs and the last 100 main commits, from `gh api` (read only), 2026-11-09 13:00Z.
- `out/mgjobs.tsv`: per merge-group run on a main SHA: run id, SHA, created, Vitest shard conclusions, PR-reuse job conclusion, shard job seconds.
- `out/teststep.txt`: seconds of the step "Run server and cockpit unit suites" in 80 shard jobs of 20 merge-group runs.
- `out/nodever.tsv`: `node: v…` from setup-node's log in each test job of 10 merge-group runs.
