# Issue 248 throwaway probes

`probe.mjs` creates and deletes its own Git repository, store, socket and four
Vitest test files. It links the checkout's installed Vitest; it installs nothing
and runs no repository suite. `SQUEAL_PROBE_CLI` can override the pinned installed
0.1.565 CLI. Its load check skips daemon startup if one-minute load exceeds CPU
count. All daemon processes are stopped in `finally` before fixture deletion.

Run from the Squeal checkout root:

```sh
node --check docs/specifications/011-core/research/probes/issue-248/probe.mjs
node docs/specifications/011-core/research/probes/issue-248/probe.mjs > docs/specifications/011-core/research/probes/issue-248/result.jsonl 2>&1
node --check docs/specifications/011-core/research/probes/issue-248/transforms.mjs
node docs/specifications/011-core/research/probes/issue-248/transforms.mjs > docs/specifications/011-core/research/probes/issue-248/transforms.jsonl 2>&1
```

Both executed probes exit 0. The fixture's behavior control produces one current
failure and status code 1 intentionally. The first attempt, retained in
`initial-attempt.txt`, timed out because a declared-input-only file was queued as
catch-up. The corrected probe captures its changed key and queued state first,
then promotes the named test files with `status --json --wait 10000`. This is
selection and invalidation evidence, not a natural-throughput benchmark.

`transforms.mjs` uses Vite 8.3.2's `transformWithOxc` and Node 26.13.0's
`stripTypeScriptTypes`. It compares emitted code and source-map mappings; it
does not run a project-specific plugin pipeline. `issue.json` is the fetched
GitHub report. Output replaces the home directory with `~`.
