# Issue 206 probe (throwaway)

Research scaffolding for `../../issue-206.md`, not a product test. It installs nothing and keeps no `node_modules` here.

`probe.mjs` makes a disposable git repository under `$TMPDIR` with two Vitest files. `test/reads.test.ts` imports `src/helper.ts` and reads the tracked file `data/table.json` with `readFileSync` at run time (a read beyond its imports). `test/plain.test.ts` only imports the helper. The base commit is then changed in `src/helper.ts`, so the gate selects both files. It links this repository's `node_modules`. Children get a scratch HOME and TMPDIR. It runs `squeal code --base main --json --timeout 60` three times on the same bytes. It stops when the one-minute load exceeds the CPU count (checked before the start, the daemon start and each gate run). The fixture is removed at the end unless `KEEP=1`.

Cases (from the repository root):

```sh
CLI=/home/agent/.claude/plugins/cache/hearsay/squeal/0.1.463/dist/cli/squeal.mjs
OLD=/home/agent/.claude/plugins/cache/hearsay/squeal/0.1.460/dist/cli/squeal.mjs
D=docs/specifications/020-quality-gate/research/probes/issue-206
node $D/probe.mjs "$CLI" nodaemon 3                   # evidence/0.1.463-nodaemon.jsonl
node $D/probe.mjs "$OLD" nodaemon 3                   # evidence/0.1.460-nodaemon.jsonl
node $D/probe.mjs "$CLI" daemon 3                     # evidence/0.1.463-daemon.jsonl
DAEMON_RUN=1 node $D/probe.mjs "$CLI" daemon 3        # evidence/0.1.463-daemon-run.jsonl
INPUTS=1 node $D/probe.mjs "$CLI" daemon 3            # evidence/0.1.463-daemon-inputs.jsonl
```

`daemon` runs `squeal start` and `squeal status --wait 30000` in the fixture before the gate runs and `squeal stop` after them. `DAEMON_RUN=1` adds `squeal run tests test/reads.test.ts --wait 60000` between gate runs 1 and 2. `INPUTS=1` commits `squeal.config.json` with `{"inputs":{"test/reads.test.ts":["data/table.json"]}}` in the base. The first `KEEP=1` run of the 0.1.463 no-daemon case kept its fixture; it was removed by hand.

Evidence lines are JSON, one per step. The random fixture suffix is replaced by `XXXXXX`.
