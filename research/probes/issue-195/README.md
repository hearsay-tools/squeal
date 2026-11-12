# Missing TMPDIR probe

Throwaway black-box research for issue #195. This is not a product test or a
regression suite. It calls the shipped CLI, not implementation modules.

Run from the Squeal worktree after its normal pnpm install. Python 3 and Node
must be available. No package install is performed. Check one-minute load
against the CPU count before running; skip when load is above the count.

```sh
python3 research/probes/issue-195/probe.py
python3 research/probes/issue-195/probe.py --no-base-config
ISSUE195_CLI=/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.440/dist/cli/squeal.mjs python3 research/probes/issue-195/probe.py
```

The default CLI is the installed Codex launcher. `ISSUE195_CLI` can select
another shipped launcher or `.mjs` CLI. Each invocation makes two fresh git
repositories under ignored `.runs/`. Both have one Vitest test and one node:test
test. Each test writes its own ignored marker and asserts the changed function
returns 2. The committed base returns 1; the working tree returns 2. The tests
are unchanged. `--no-base-config` leaves `squeal.config.json` out of the base and
adds it in the head. `node_modules` is an ignored symlink to the worktree's
installed dependencies. No daemon is started by this probe.

For `missing`, the script does not create the directory assigned to TMPDIR.
For `existing`, it creates that directory. Each command is
`squeal code --base HEAD --json --timeout 30`, with a 75-second subprocess
bound. Fresh repositories prevent one control's stored results from serving
another. Raw stdout, stderr and the summary stay under `.runs/`.

`results.json` preserves the three recorded pairs, including commands, exits,
marker checks, stdout and stderr. Only each generated absolute root is replaced
with `<probe-root>`; installed runtime paths remain exact. The first recording
predates the optional CLI and base-config switches; its default fixture and
command are unchanged. The findings are in
`docs/specifications/020-quality-gate/research/issue-195.md`.
