# Throwaway issue-180 probes

These are research fixtures, not product code or a regression suite.

From the repository root, with dependencies already installed:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-180/probe.ts \
  > docs/specifications/011-core/research/probes/issue-180/output.jsonl 2>&1
```

The script requires the local `squeal--v0.1.426` tag and installed runtime at
`/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.426/dist/cli/squeal.mjs`.
It extracts that tag's source to a temporary directory and uses the existing
checkout's dependencies. It performs no build or install. No `node_modules`
content is committed. Its main steps are bounded, with a 30-second startup wait
and named waits of at most 20 seconds. It checks load before live work and skips
when one-minute load exceeds the CPU count.

A private three-file node:test repository uses the default tests group. The
script calls the exact release's CLI entry point in process against the real
release daemon. This makes an immediate write/request possible without Node
process startup latency. The first race uses no injected state. The second
experiment explicitly changes only `refined.<worktree-id>` from 2 to 1 after
revision 2 has passed; it restores the marker afterwards. That second result
proves consumer disagreement under injected state, not a natural listing stall.

`output.jsonl` is the retained clean-config run. Each CLI record includes exact
arguments, exit code, milliseconds, stdout and stderr. JSON status is retained
inside stdout. The fixture's temporary paths are expected to be gone after
cleanup. The source invocation causes printed follow-up commands to name a
temporary TypeScript module; do not use those paths as installed CLI commands.

An earlier exploratory run also reproduced both symptoms, but its attempted
custom `tests` group was rejected as reserved and the default applied. The
retained run removes that entry and has no config problem.
