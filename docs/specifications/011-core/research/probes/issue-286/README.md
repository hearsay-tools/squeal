# Issue 286 throwaway probe

Research evidence, not a product test. `probe.py` makes one dependency-free
node:test project in the ignored `.runtime/` directory beside itself. It refuses
to reuse an existing fixture and skips when the one-minute load exceeds the CPU
count. Do not add `node_modules` or `.runtime` to Git.

Run from the checkout root:

```sh
python3 docs/specifications/011-core/research/probes/issue-286/probe.py > docs/specifications/011-core/research/probes/issue-286/output.jsonl
```

It uses the installed launcher at
`~/.codex/plugins/data/squeal-hearsay/bin/squeal`: version, start, checks, a
60000 ms named wait to seed a pass, one failing assertion edit, two more identical
named waits, and stop. Each command has a 70 s subprocess bound. No full suite,
dependency install, CPU load or artificial daemon stall is involved. Cleanup
stops only the fixture daemon before removing the fixture; if stop fails, it
retains the directory. Review and clean up a retained fixture before rerunning.

The preserved 2026-11-26 run used Squeal 0.1.640 and Node 26.13.0 on 16 CPUs,
load 0.249 at start. Both post-edit waits returned the current revision 1 failure
(1.378 s and 0.377 s), so the incident's timeout was not reproduced. The fixture
daemon stopped successfully. Home paths in `output.jsonl` are normalized to `~`.
