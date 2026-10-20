# Issue 60 throwaway probe

This fixture is research evidence, not a product regression test. It creates a private Git repository under `.runtime/`, runs one foreground Squeal daemon, and stops only that daemon. It leaves the fixture and its store for inspection. `.runtime/` and all `node_modules` are out of Git. No browser, Cezar server or other worktree is started or stopped.

The fixture's global setup prepares an ignored HTML asset from `src/ui.txt`, starts an HTTP server on an allocated loopback port, and returns its teardown. The Node test fetches that asset and compares it with the declared source. The input changes between two full-suite requests. A setup-file edit is the positive control in the same daemon. Assertions require PASS, FAIL, PASS and the expected setup/teardown sequence. Exit 0 means the defect reproduced, not that it is fixed.

Commands run from the Squeal checkout on 2026-10-20 UTC:

```sh
mkdir -p docs/specifications/013-vitest-runner/research/probes/issue-60/.runtime
npm install --prefix docs/specifications/013-vitest-runner/research/probes/issue-60/.runtime --no-audit --no-fund --ignore-scripts vitest@5.0.3
node docs/specifications/013-vitest-runner/research/probes/issue-60/probe.mjs /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.233/dist/cli/squeal.mjs > docs/specifications/013-vitest-runner/research/probes/issue-60/output.txt 2>&1
```

The install resolved Vitest 5.0.3 and Vite 8.3.4. To pin both for a later replay, add `vite@8.3.4` to the install command. Use an absolute installed Squeal CLI path as the script argument. The script refuses live reproduction when the one-minute load exceeds the CPU count. It prints each CLI command; they run from the private fixture. Source edits, fixture creation, Git commands and cleanup are explicit in `probe.mjs`.

`output.txt` is the complete captured run (trailing whitespace removed), including status and result keys. `source-evidence.txt` holds short fetched source extracts. The test uses `observe.runtimeInputs: false` to isolate declared-input behavior. It uses Node HTTP rather than a browser and does not test parallel worktrees or slow-lane scheduling.
