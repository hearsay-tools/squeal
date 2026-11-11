# Issue 182 throwaway probe

This is a research fixture, not a product test. It creates a temporary git repo,
links this checkout's installed `node_modules`, and removes the temporary repo
when done. It does not install packages, start a daemon, server or browser, or
run the Squeal test suite. The six launcher lines are synthetic literals.

From the Squeal checkout root:

```sh
node docs/specifications/020-quality-gate/research/probes/issue-182/probe.mjs \
  /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.430/dist/cli/squeal.mjs
```

Requires Node 24.22.1, installed Vitest 5.0.3, git, and the named packaged Squeal
runtime for the recorded result. No `node_modules` is committed here. Each live
CLI invocation checks one-minute load against the smaller of `os.cpus().length`
and `nproc`, and skips when load is above that count. Each gate has a 30 s budget
and an outer 45 s timeout. The fixture limits Vitest to one worker and one test.

The three cases use identical committed configuration. `unchanged` has no diff.
`changed` replaces `1 + 1` with `2 + 0` in the test callback. `changed-quiet` keeps
that diff and sets `ISSUE182_QUIET=1`, which prevents the launcher from running.
The other cases set it to `0`. The test file is excluded from CRAP by the base
policy, but the gate still selects and runs the changed test.

`results/observations.json` records commands, environment override, load,
version, timing, exit status, parse result and report summaries. The `.stdout.txt`
and `.stderr.txt` files preserve each stream separately, including empty stderr.
Running the probe again replaces these evidence files. `root` is a deleted
scratch path, not a required input. The report's commit is the synthetic base,
not Squeal's commit.
