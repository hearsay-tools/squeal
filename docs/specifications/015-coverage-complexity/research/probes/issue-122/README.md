# Issue 122 throwaway probe

Research only. This is not a product test or a daemon fixture. It creates a fresh
`/tmp/squeal-issue-122-*` project and deletes it after the adapter closes. It does
not install dependencies, start a daemon or change an external repository.
`node_modules` is not committed.

Run from the Squeal worktree root:

```sh
pnpm exec tsx docs/specifications/015-coverage-complexity/research/probes/issue-122/probe.ts > /tmp/issue-122-result.json
```

The probe skips execution if the one-minute load exceeds available CPUs. The
saved successful output is `result.json`; `issue.json` is the fetched issue:

```sh
gh issue view 122 --repo hearsay-tools/squeal --json title,body,comments,url
```

The fixture has one configured unit test with an unexecuted literal dynamic
import of a packaged TypeScript test. That packaged test defines `cleanup` inside
its test callback and imports `src/helper.ts`. Each helper has complexity 8.
Esbuild strips TypeScript into a temporary `dist/` tree and the probe runs
`node --test dist/test/e2e/delegation.test.mjs`. Its assertions call both helpers.

The real Squeal node:test adapter runs the unit test with coverage. Its actual
closure, results and decoded record feed `LoaderBuild`, `coverageOf` and
`judgeFiles`. Only storage/key plumbing is an in-memory seam; the probe does not
run the daemon, persist states or test notification delivery. The successful run
asserts CRAP 72 and untested for both helpers. An actual second adapter includes
the packaged source test and proves the product helper passing with CRAP 8.

Other checks call the production policy and condition functions: runner-listed
tests are not counted; explicit `test/e2e/**` coverage exclusion matches the test
file but not the product helper; discovery with no result stays pending; an
unavailable record gives unknown. These last condition inputs are synthetic.

Runtime: Squeal source 0.1.374 at `15f73a3110c4f6aaa85171ac0dffdbb8575dff5a`,
Node 24.22.1. Start time, host load, output, records and states are in `result.json`.
No repository test suite is invoked by this command.
