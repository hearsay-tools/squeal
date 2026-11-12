# Issue 203 selection probe

Throwaway research fixture, not a product test. Run from the repository root:

```sh
node docs/specifications/020-quality-gate/research/probes/issue-203/run.mjs narrow default
node docs/specifications/020-quality-gate/research/probes/issue-203/run.mjs narrow test
node docs/specifications/020-quality-gate/research/probes/issue-203/run.mjs narrow group
node docs/specifications/020-quality-gate/research/probes/issue-203/run.mjs shared default
node docs/specifications/020-quality-gate/research/probes/issue-203/run.mjs shared test
node docs/specifications/020-quality-gate/research/probes/issue-203/run.mjs shared group
```

Each invocation checks one-minute load against CPU count and exits 77 without
running a fixture when load is higher. It creates a fresh Git repository under
ignored `out/`, links the installed repository dependencies, and runs the installed
0.1.457 CLI at its absolute version path. There is no installation, daemon or
browser. The project named `browser` uses ordinary Vitest tests, one worker.

`narrow` changes the target test callback and one unit test callback. `shared`
also changes a helper imported by all four files. `default`, `test` and `group`
respectively use no extra flag, `--test e2e/target.test.ts`, and `--group browser`.
Every case gets independent Git-backed stores. Test bodies write markers, so
the probe checks actual execution and exit status, and prints report selection
for comparison.
The CLI has a 20-second budget; the parent stops it after 40 seconds.

Generated reports, stderr, markers, nested repositories and `node_modules` are
ignored. Do not commit them. The findings table preserves the observed results.
