# Issue 14 throwaway probe

Research only. This is not part of the product or its test suite. Requires Node 22.13+ and this checkout's installed dependencies (`npm ci`). Run from the repository root:

```sh
node --disable-warning=ExperimentalWarning docs/specifications/001-core-loop/research/probes/issue-14/probe.mjs /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs > docs/specifications/001-core-loop/research/probes/issue-14/0.1.199.ndjson 2>&1
node --disable-warning=ExperimentalWarning docs/specifications/001-core-loop/research/probes/issue-14/probe.mjs plugins/claude-code/dist/cli/squeal.mjs > docs/specifications/001-core-loop/research/probes/issue-14/0.1.200.ndjson 2>&1
```

The first CLI path is the installed 0.1.199 plugin on this host; substitute another copy of that release elsewhere. An optional third argument names the dependency directory, default `./node_modules`.

The probe creates a temporary Git repository and separate control directory. It symlinks the installed dependencies. It starts the selected real bundled CLI and daemon with baseline misses, one file per tier, one Vitest worker and runtime observation disabled. Three independent tests are ordered `a-running`, `b-background`, `z-selected`; their durations are initially unknown. The first two tests wait on external control files, and the selected test only asserts `1 + 1 === 2`. All tests append timestamped events outside the fixture. No product imports, mocks, source edits during the run, shared fixture store, or forced runs are used.

Once A starts, a 60-second named wait stays active across both tier boundaries. A concurrent one-second named wait times out; the probe releases A, observes B running with the selected file still queued, and makes another one-second named wait. It releases B, awaits the long wait's current verdict, then repeats a named wait and asserts no test ran again. Read-only SQLite snapshots establish `running` versus `queued`; CLI output alone reports selected pending counts. Gate files keep ordering deterministic; timings depend on host load. The fixture asserts the observed current behavior, so a future promotion implementation is expected to fail its order assertion.

Cleanup releases both gates, calls `squeal stop`, and removes the fixture only after stop exits 0. A failed stop leaves the fixture path in the error for inspection. It does not stop any other daemon. `node_modules` and generated fixtures are not committed.

Preserved evidence, 2026-10-16 UTC:

- `issue.json`: `gh issue view 14 --repo hearsay-tools/squeal --json number,title,body,comments,url`.
- `0.1.199.ndjson`, `0.1.200.ndjson`: exact CLI commands, raw stdout/stderr, exit codes, queue snapshots and test-body events. Both probe processes exited 0.
- `verification.txt`: repository verification output/excerpts; the full-suite checkpoint is red on two unchanged recorder-fidelity tests, not on this probe.

Versions: Node v24.21.0, Vitest 5.0.3. Checkout `80bad645b2263aea878499f1336c28d9eef0c6c9`, Squeal 0.1.200; build produced no tracked drift. Installed 0.1.199 CLI SHA-256 `6869478e38d3233f30c3e95f3dcdadafcfc2d1520a1579606bad6c3b6f5ae31f` equals `git show squeal--v0.1.199:plugins/codex/dist/cli/squeal.mjs | sha256sum` (tag commit `9608b93f3622b635939b489d47cda75a74fe1b45`). Checkout Claude Code CLI SHA-256 `a51e35096fabcb5545afee0bea3112551729ac7c5085f3e05fe2b24d632f6f14`.
