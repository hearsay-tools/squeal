# Issue 209: throwaway classifier and queue probe

This is research evidence, not a product test or a proposed implementation.
Run from the repository root with its existing pnpm dependencies:

```sh
gh issue view 209 --repo hearsay-tools/squeal --json title,body,comments,url,createdAt > docs/specifications/011-core/research/probes/issue-209/issue.json
pnpm exec tsx docs/specifications/011-core/research/probes/issue-209/probe.ts > docs/specifications/011-core/research/probes/issue-209/output.jsonl
pnpm exec biome check docs/specifications/011-core/research/probes/issue-209/probe.ts
git diff --exit-code squeal--v0.1.464 HEAD -- src/core/scheduler src/core/slow/classify.ts src/cli/status-wait.ts src/cli/status-wait-lines.ts
```

The saved output comes from commit `b5eba8432c317fa259495873e6a223d4501cf142`
(package 0.1.465). The diff command exited 0 with no output: examined source
matches reported release 0.1.464, tag commit
`ff4c9c2f1608ec88c79c77481b976ba5e5be7575`.

The probe calls the real `isCatchUp`, `priorityOf`, `RunQueue` and `slowFiles`.
It supplies a minimal listed-file/key-index view to `isCatchUp`. It assumes
all 37 queue files were reached and re-keyed, then supplies the queue flags
that `Ledger.settle` uses. It does not call `Ledger.settle` or compute keys.
The 35 edited tests have synthetic 100 ms durations; one other test has
1 ms and an e2e file has 2 ms. Those numbers prove ordering only.

Controls cover 9/10/35 keyed paths, five revisions of seven edits, unkeyed
paths, unknown durations, slow policy, promotion and an existing recent
entry. The last output line says `assertions: PASS`; a failed assertion exits
nonzero. The probe exits without running cases when one-minute load exceeds
the CPU count.

No test process, daemon, store, watcher, pool or live worktree is used. This
does not reproduce real concurrency, actual revision batching, execution
latency or the reported heartbeat lapse. Keep `node_modules` out of git;
no local install is needed.

The coordinator relocated these files into the owning spec after collection.
The commands above use the final paths; the researcher ran them at `research/probes/issue-209/`. Only relative imports changed in the probe.
