# Issue 156 throwaway probes

Research only. No product implementation or automated regression test. Run from the repository root:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-156/stop.mjs > docs/specifications/011-core/research/probes/issue-156/output.txt
```

`stop.mjs` calls the production policy loader, required-check resolver and Stop reason formatter. It supplies one synthetic pending ESLint check at revision 2. The four cases cover the default, a custom budget, the upper cap, and changing only the quick Stop budget. It asserts the resolved budgets and the absence of the timeout key in the resulting text. `output.txt` preserves the successful run, including runtime, source commit, host load and every result.

This does not run a Stop hook, daemon, linter, timer wait or test suite. The reported seconds are formatter inputs, not measured elapsed waits. It creates one temporary config directory and removes it in `finally`. No `node_modules` belongs in this directory or in git.

Other exact evidence commands, run from the repository root:

```sh
gh issue view 156 --repo hearsay-tools/squeal --json title,body,comments,url,updatedAt
gh issue view 154 --repo hearsay-tools/squeal --json title,body,url
git rev-parse HEAD
node --version
pnpm --version
cat /proc/loadavg
nproc
git rev-parse 'squeal--v0.1.408^{commit}'
git diff squeal--v0.1.408 HEAD -- src/harness/shared/stop-lint.ts src/harness/shared/stop-required.ts src/harness/shared/stop-slow.ts src/core/state/required.ts src/core/slow/stop-wait.ts
git diff squeal--v0.1.408 HEAD -- plugins/claude-code/skills/squeal/references/policy.md
rg -n 'lint.*timeout|timeout.*lint|slowWaitMs' plugins/claude-code/skills/squeal/references/*.md
sha256sum plugins/claude-code/skills/squeal/references/policy.md /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.414/skills/squeal/references/policy.md
pnpm exec biome check docs/specifications/011-core/research/probes/issue-156/stop.mjs
```

The report records the relevant command outputs and their interpretation. Scope excludes replaying the incident worktree, a full suite and the original two-minute wait.
