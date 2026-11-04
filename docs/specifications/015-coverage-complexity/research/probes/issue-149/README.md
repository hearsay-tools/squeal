# Issue 149 throwaway probe

These are research fixtures, not product code or repository tests. Run from the
Squeal worktree with installed dependencies; do not install or build anything:

```sh
node --check docs/specifications/015-coverage-complexity/research/probes/issue-149/run.mjs
node docs/specifications/015-coverage-complexity/research/probes/issue-149/run.mjs
node docs/specifications/015-coverage-complexity/research/probes/issue-149/verify.mjs
```

`run.mjs` uses the committed `plugins/claude-code/dist/cli/squeal.mjs` and the
installed Vitest. It creates four private git repositories under the session's
temporary directory. Each has private HOME, XDG config and runtime directories.
A symlink supplies the existing node_modules, which stays ignored and uncommitted.
It checks one-minute load against CPU count before each fixture and daemon start.
It starts one daemon at a time and stops only that process in `finally`.
Temporary repositories remain for inspection. No repository full suite runs.

All cases use the same one-line TypeScript expression arrow and the same fixture
path named in the issue. The separate-config and excluded cases have a node:test
parent that starts a single Vitest test through a separate config. That child
asserts the source return value and writes a marker; the parent checks its exit,
passed-test count and marker. The direct control imports and calls the source in
the node:test process. The snapshot-reader control only reads source text; it does
not model the original coverage matcher itself.

`results.json` records exact CLI argument arrays, stdout/stderr, exit codes, loads,
fixture file bytes and daemon logs. `run-output.txt` is the corrected run's stdout.
`audit.json` is the offline verifier output. `initial-invalid-config.json` preserves
the first attempt: a relative config was resolved twice under `--root`, so both
child cases failed before execution. It is not reproduction evidence. The final
probe uses an absolute config path and all four parent tests pass.

`original/` contains fetched cezarion source at merge commit
`64d58f93f851ce1be70fa5ba156dd69214cbc1e5` from PR 2574. Files without `root-` are
from `.ai/skills/check-code-quality/scripts/fixtures/expression-arrows/`, except
`metrics-excerpt.txt`, which preserves numbered lines from the parent
`scripts/metrics.test.mjs`. `root-*` files come from the repository root. These are
source snapshots, not a replay of the original incident. The source README's npm
command is historical text; this task did not run npm or install dependencies.
`issue-149.json` and `issue-144.json` preserve the issue readings.

Fetch recipe (replace PATH with the source-relative path):

```sh
gh api 'repos/hearsay-tools/cezarion/contents/PATH?ref=64d58f93f851ce1be70fa5ba156dd69214cbc1e5' --jq .content | base64 -d
gh issue view 149 --repo hearsay-tools/squeal --json title,body,url,state,labels
gh issue view 144 --repo hearsay-tools/squeal --json title,body,url,state,labels
```
