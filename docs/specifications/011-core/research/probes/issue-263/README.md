# Issue 263 probe (throwaway)

This is a synthetic research fixture, not a product regression test. It extracts
Squeal 0.1.591 source and five existing fixture helpers from the local release
tag into ignored `.runtime/source/`, then calls that release's Claude Code hook
entry point against temporary SQLite stores. No daemon or Claude process starts.
The stand-in daemon reports alive; result batches are inserted directly through
the state sink. The Write body is synthetic, 16,384 ASCII bytes. No Write executes.

From the repository root, with dependencies already installed:

```sh
bash docs/specifications/011-core/research/probes/issue-263/run.sh
```

The script refuses to run with one-minute load above the CPU count (exit 75).
One Vitest worker runs only `batches.probe.ts`. This probe is outside the regular
Squeal test selection; the research brief explicitly authorizes its direct run.
Its config pins the product version to 0.1.591. Dependencies come from the parent
checkout's existing installation; the observed Vitest version was 5.0.3, Node
v26.13.0. This is not a clean release dependency installation or a bundled-hook
subprocess test.

`output.txt` preserves the synthetic result lines and environment metadata from
the single successful run, with the absolute checkout banner omitted. It contains
no agent transcript. `.runtime/` contains only disposable extracted sources,
caches and fixture directories; the store helper removes its fixtures after each
case. Remove `.runtime/` when no longer needed.
