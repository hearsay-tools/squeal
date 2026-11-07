# Issue 166: throwaway persisted-path probe

This is a throwaway research fixture, not a product test. Run from the repository root:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-166/probe.ts > docs/specifications/011-core/research/probes/issue-166/result.jsonl 2> docs/specifications/011-core/research/probes/issue-166/stderr.txt
```

It needs the installed repository dependencies, Node with `node:sqlite`, Git, and the committed Claude Code CLI bundle. It installs nothing and starts no test suite. `node_modules` is not part of this fixture.

The probe checks load before creating its fixture and before each daemon start. Above the CPU count it records a skipped reproduction. Otherwise it creates one temporary repository, one linked temporary worktree, a private runtime directory, and a private SQLite store. It persists the issue's path through `ObservedSets.add`, closes and reopens the store, and calls the source closure/keying code. It then starts the bundled daemon three times over that store: first start, restart, and the linked scratch worktree. Each must exit 1 with the path error and `testFilesListed=false`. Finally it clears only the scratch observed map for a clean-store control, which must list tests.

Each child has a 15-second kill bound. The control runs with `baseline.onStart=lookup-only`, coverage and complexity disabled. Cleanup stops the probe's child and removes only its own temporary directory. No existing repository store or worktree is read or changed. The literal `/home/agent` in the bad path is test data, not a path the probe opens.

The captured run used Squeal 0.1.414 at `b509d603f483e5b869eb11b6cfecc744b057193e`, Node v24.22.1 on Linux. It exited 0. All four daemon cases ran; none were skipped. `result.jsonl` preserves the assertions' observations; `stderr.txt` contains only Git's scratch-worktree creation notice.
