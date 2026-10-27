# Throwaway project-prefix probe

Run from the repository root with its installed dependencies:

```sh
/home/agent/.nvm/versions/node/v22.19.0/bin/node --import tsx docs/specifications/005-agent-adoption/research/probes/project-process-prefix/probe.mjs
/home/agent/.nvm/versions/node/v24.21.0/bin/node --import tsx docs/specifications/005-agent-adoption/research/probes/project-process-prefix/probe.mjs
python3 docs/specifications/005-agent-adoption/research/probes/project-process-prefix/monitor.py
```

Linux `/proc`, Git, Python 3, and `ps` are required. `tsx` loads the existing TypeScript readers without a product build. Each run creates and deletes a temporary Git repository, linked worktree and tiny plugin copies. It starts idle Node fixtures, one node:test file, and one Vitest file twice with one fork. No Squeal daemon or subject agent starts. Each command has a 20-second limit; idle fixtures have a 15-second lifetime and are killed after inspection.

Two temporary in-memory patches measure exact boundaries. One adds argv0 to the actual `ensureDaemonProcess` spawn targeting the idle fixture. Another adds argv0 to Vitest's actual fork. Both preserve the command and arguments; neither is a production implementation proposal. The actual `discover()` and `keepVersion()`/prune code run unchanged.

Recorded on 2026-10-27 against Squeal source `9a30611c3247a859b87e99461cd6e2d1484f1b0f`:

- [Node 22.19.0](result-node22.json): exit 0.
- [Node 24.21.0](result-node24.json): exit 0.
- [Installed btop 1.3.0](result-btop.json): exit 0. A three-second PTY run with a temporary configuration, 160 columns, normal process view. Only the fixture row is saved.
- Vitest 5.0.3; Python 3.12.3. Fixtures pass on both Nodes.
- Probe assertions cover argv separation, JavaScript launch state, executable identity, main/linked discovery, actual daemon spawn seam, retention before/after process exit, missing automatic runner inheritance, Vitest preserving explicit fork argv0, and Python executable divergence.

The JSON retains only fixture paths, process launch fields, and asserted outcomes. No environment values or unrelated processes are recorded. No installed runtime is changed. Product lint, typecheck, build and suites are outside this research task.

Final checks:

```text
node --check docs/specifications/005-agent-adoption/research/probes/project-process-prefix/probe.mjs
exit 0

/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/005-agent-adoption/research/project-process-prefix.md docs/specifications/005-agent-adoption/research/probes/project-process-prefix/probe.mjs
exit 3, revision 12
No verdict: no test file's closure holds either named path.
Worktree: known failures 0; not current: 1039 of 1265 test files (1039 unknown).
```

The direct probe runs supply the research evidence because Squeal has no coverage for these files. The final staged `git diff --check` exits 0. An earlier probe revision exited 13 while awaiting cleanup of the actual launcher's unreferenced child. The probe now calls `ref()` before awaiting its close. Both saved result files come from complete exit-0 runs after that correction.

The separate path wait for `monitor.py` at revision 17 also reported no covering test, with 0 known failures and 1,039 of 1,265 files unknown. Python AST parsing passed. The installed btop probe itself exited 0.
